/**
 * `orchestrate` — turn an inbound event into a dispatch plan.
 *
 * The rules live in `.claude/agents/orchestrator.md`. This module implements the
 * mechanical ones, because they do not need judgement:
 *
 *   - unknown or incomplete envelopes are refused, not guessed
 *   - an unlabelled number is rejected (guardrail 1)
 *   - a model self-score is not a derivation level
 *   - an efficacy conclusion is refused (ADR-0004)
 *   - a write that would become normative freezes and pages a human (guardrail 2)
 *   - each specialist gets a packed input, not a shared state file
 *
 * WHAT THIS DOES NOT DO: it does not call a specialist, open a PR, merge, accept
 * risk, or say whether a control is effective. It names who should run, with
 * which read/draft tools, and whether a human gate is required before anything
 * else happens. The LLM is the interface to this plan, not a substitute for it.
 */

export const DERIVATION_LEVELS = Object.freeze([
  'measured',
  'derived',
  'calibrated-estimate',
  'assumed',
]);

export const EVENT_KINDS = Object.freeze([
  'control.failing',
  'denominator.drift',
  'requirement.new',
  'crosswalk.refresh',
  'policy.generate',
  'test.author',
  'attestation.request',
  'auditor.request',
  'incident',
  'new-surface',
  'threat-intel.match',
  'risk.acceptance',
  'exception.approval',
]);

/** Keys whose values are quantities. Presence without derivation_level is fatal. */
export const QUANTIFIED_KEYS = Object.freeze([
  'total',
  'failing_count',
  'passing_count',
  'count',
  'score',
  'rate',
  'percent',
  'frequency',
  'loss',
  'ale',
  'days_failing',
  'coverage',
]);

/**
 * Actions that change the estate or the audited inventory. Drafting a PR or a
 * Linear item is not in this set — merging, accepting, or mutating cloud is.
 */
export const NORMATIVE_ACTIONS = Object.freeze([
  'merge_pr',
  'accept_risk',
  'approve_exception',
  'extend_exception',
  'close_finding',
  'write_control',
  'write_policy',
  'change_firewall',
  'isolate_resource',
  'apply_patch_to_default_branch',
]);

const SPECIALISTS = Object.freeze({
  'exception-triage': {
    tools: ['list_failing', 'get_variance', 'get_control', 'save_issue'],
    effect: 'draft',
  },
  'requirement-decomposer': {
    tools: ['list_controls', 'get_control', 'get_findings'],
    effect: 'draft',
  },
  'crosswalk-mapper': {
    tools: ['get_control', 'list_controls'],
    effect: 'draft',
  },
  'test-author': {
    tools: ['get_control', 'get_assertion_history'],
    effect: 'draft',
  },
  'policy-generator': {
    tools: ['get_control', 'list_failing'],
    effect: 'draft',
  },
  'attestation-writer': {
    tools: ['get_control', 'get_assertion_history', 'health_summary'],
    effect: 'draft',
  },
  'evidence-scout': {
    tools: ['get_control', 'get_assertion_history', 'get_variance', 'list_failing'],
    effect: 'read',
  },
  'scenario-scoper': {
    tools: ['list_controls', 'get_control', 'gap_summary'],
    effect: 'draft',
  },
});

const ROUTES = Object.freeze({
  'control.failing': {
    agents: ['exception-triage'],
    gate: null,
  },
  'denominator.drift': {
    agents: [],
    held: true,
    gate: { kind: 'human-page', presenter: 'slack', action: 'inventory-failed-before-the-control' },
  },
  'requirement.new': {
    agents: ['requirement-decomposer'],
    gate: { kind: 'pr-merge', presenter: 'github', action: 'merge-candidate-controls' },
  },
  'crosswalk.refresh': {
    agents: ['crosswalk-mapper'],
    gate: { kind: 'pr-merge', presenter: 'github', action: 'merge-crosswalk' },
  },
  'policy.generate': {
    agents: ['policy-generator'],
    gate: { kind: 'pr-merge', presenter: 'github', action: 'merge-policy' },
  },
  'test.author': {
    agents: ['test-author'],
    gate: { kind: 'pr-merge', presenter: 'github', action: 'merge-dbt-model' },
  },
  'attestation.request': {
    agents: ['attestation-writer'],
    gate: { kind: 'human-review', presenter: 'linear', action: 'review-customer-answer' },
  },
  'auditor.request': {
    agents: ['evidence-scout'],
    gate: null,
  },
  'incident': {
    agents: ['scenario-scoper', 'exception-triage'],
    gate: { kind: 'human-page', presenter: 'slack', action: 'on-call' },
  },
  'new-surface': {
    agents: ['scenario-scoper'],
    gate: { kind: 'pr-merge', presenter: 'github', action: 'merge-scenario' },
  },
  'threat-intel.match': {
    agents: ['evidence-scout', 'scenario-scoper'],
    gate: { kind: 'pr-merge', presenter: 'github', action: 'merge-remediation-if-any' },
  },
  'risk.acceptance': {
    agents: [],
    freeze: true,
    gate: { kind: 'risk-acceptance', presenter: 'github', action: 'named-human-accepts-with-expiry' },
  },
  'exception.approval': {
    agents: [],
    freeze: true,
    gate: { kind: 'exception-approval', presenter: 'github', action: 'named-approver-and-expiry' },
  },
});

function quantifiedHits(value, path = []) {
  const hits = [];
  if (value == null || typeof value !== 'object') return hits;
  for (const [key, child] of Object.entries(value)) {
    const next = [...path, key];
    if (QUANTIFIED_KEYS.includes(key) && typeof child === 'number') {
      hits.push({ key, value: child, path: next.join('.') });
    } else if (child && typeof child === 'object') {
      hits.push(...quantifiedHits(child, next));
    }
  }
  return hits;
}

function proposedActions(event) {
  const raw = event?.proposed_actions ?? event?.payload?.proposed_actions ?? [];
  return Array.isArray(raw) ? raw : [raw];
}

/**
 * The tool surface a host is allowed to expose to the orchestrator.
 * Every tool is `read` or `draft`. Normative writes are absent on purpose —
 * a missing tool cannot be called, which is stronger than a prompt saying not to.
 */
export const TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'plan_dispatch',
    effect: 'read',
    description:
      'Returns the dispatch plan for one event envelope. Mechanical: unknown kinds, ' +
      'unlabelled quantities, model self-scores, efficacy conclusions and normative ' +
      'writes are refused here. Does not invoke a specialist and does not mutate the repo.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['event_id', 'kind', 'source', 'as_of'],
      properties: {
        event_id: { type: 'string', minLength: 1 },
        kind: { type: 'string', enum: [...EVENT_KINDS] },
        source: { type: 'string', minLength: 1 },
        as_of: { type: 'string', format: 'date-time' },
        derivation_level: { type: 'string', enum: [...DERIVATION_LEVELS] },
        payload: { type: 'object' },
        proposed_actions: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
  },
  {
    name: 'get_control',
    effect: 'read',
    description:
      'One control record as committed. Describes what the control claims, not whether it is operating.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['control_id'],
      properties: { control_id: { type: 'string' } },
    },
  },
  {
    name: 'list_controls',
    effect: 'read',
    description: 'Inventory filtered by status / layer / owner. Status is a lifecycle state, not a measurement.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'list_failing',
    effect: 'read',
    description:
      'Every failing subject, fully enumerated. Unmeasured controls are a separate key, never folded into a zero.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'get_assertion_history',
    effect: 'read',
    description: 'Time series behind one control. Not an efficacy judgement.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['control_id'],
      properties: { control_id: { type: 'string' } },
    },
  },
  {
    name: 'get_variance',
    effect: 'read',
    description:
      'Variance episodes from assertion history. remediation_started_at is null unless the tracker supplied it.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['control_id'],
      properties: { control_id: { type: 'string' } },
    },
  },
  {
    name: 'get_findings',
    effect: 'read',
    description: 'Audit findings and how many map to no control.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'health_summary',
    effect: 'read',
    description: 'Control health as a classification, never a score. Bands are ordinal and do not enter arithmetic.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'gap_summary',
    effect: 'read',
    description: 'Four-direction gap assessment.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'save_issue',
    effect: 'draft',
    description:
      'Create or update a Linear work item for a routed failure. Does not close an item and does not approve an exception.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['team', 'title'],
      properties: {
        team: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        id: { type: 'string' },
      },
    },
  },
  {
    name: 'request_human_gate',
    effect: 'draft',
    description:
      'Present a pending action to a named human in Linear, GitHub or Slack. The action stays unapplied until they approve. ' +
      'Cannot merge, accept risk, or change cloud by itself.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'presenter', 'action', 'summary'],
      properties: {
        kind: {
          type: 'string',
          enum: ['pr-merge', 'risk-acceptance', 'exception-approval', 'human-review', 'human-page', 'cloud-write'],
        },
        presenter: { type: 'string', enum: ['github', 'linear', 'slack'] },
        action: { type: 'string' },
        summary: { type: 'string' },
        derivation_level: { type: 'string', enum: [...DERIVATION_LEVELS] },
      },
    },
  },
]);

export const FORBIDDEN_TOOL_NAMES = Object.freeze([...NORMATIVE_ACTIONS]);

function refuse(code, message) {
  return {
    accepted: false,
    held: false,
    freeze: true,
    reason: message,
    refusals: [{ code, message }],
    tasks: [],
    gate: { kind: 'human-page', presenter: 'slack', action: 'orchestrator-refused' },
    synthesis: { source_of_truth: 'control-repo', derivation_required: true },
  };
}

function packInput(event, agent) {
  return {
    event_id: event.event_id,
    kind: event.kind,
    as_of: event.as_of,
    source: event.source,
    derivation_level: event.derivation_level ?? null,
    payload: event.payload ?? {},
    specialist: agent,
    shared_state_file: null,
  };
}

/**
 * @param {object} event
 * @returns {object} dispatch plan
 */
export function planDispatch(event) {
  if (event == null || typeof event !== 'object') {
    return refuse('malformed', 'Event envelope is missing.');
  }
  if (!event.event_id) return refuse('missing-event-id', 'event_id is required.');
  if (!event.source) return refuse('missing-source', 'source is required.');
  if (!event.as_of) return refuse('missing-as-of', 'as_of is required. Untimed events cannot enter the warehouse.');
  if (event.state_file || event.shared_state_file) {
    return refuse(
      'shared-state',
      'Specialists do not read a shared state file. Pack the input per task; the system of record is the control repo.',
    );
  }
  if (event.kind == null || !EVENT_KINDS.includes(event.kind)) {
    return refuse('unknown-kind', `Unknown event kind ${JSON.stringify(event.kind)}.`);
  }

  if (event.payload?.concludes_efficacy === true || event.concludes_efficacy === true) {
    return refuse(
      'efficacy-conclusion',
      'No agent evaluates control efficacy. Record what a probe observed. A named human sets efficacy parameters.',
    );
  }

  if (event.payload && ('confidence' in event.payload || 'confidence_score' in event.payload)) {
    return refuse(
      'model-confidence',
      'A model self-score is not a derivation level. Use measured | derived | calibrated-estimate | assumed.',
    );
  }

  const quantities = quantifiedHits(event.payload);
  if (quantities.length && !DERIVATION_LEVELS.includes(event.derivation_level)) {
    return refuse(
      'unlabelled-number',
      `Unlabelled quantit${quantities.length === 1 ? 'y' : 'ies'} ${quantities.map((q) => q.path).join(', ')}. ` +
        'Set derivation_level on the envelope.',
    );
  }
  if (event.derivation_level != null && !DERIVATION_LEVELS.includes(event.derivation_level)) {
    return refuse('bad-derivation-level', `derivation_level ${JSON.stringify(event.derivation_level)} is not one of the four.`);
  }

  const normative = proposedActions(event).filter((a) => NORMATIVE_ACTIONS.includes(a));
  if (normative.length) {
    return {
      accepted: true,
      held: false,
      freeze: true,
      reason: `Normative action(s) ${normative.join(', ')} stop at a human gate.`,
      refusals: [],
      tasks: [],
      gate: {
        kind: normative.includes('accept_risk')
          ? 'risk-acceptance'
          : normative.includes('approve_exception') || normative.includes('extend_exception')
            ? 'exception-approval'
            : normative.some((a) => a === 'change_firewall' || a === 'isolate_resource')
              ? 'cloud-write'
              : 'pr-merge',
        presenter: 'github',
        action: normative.join(','),
      },
      synthesis: { source_of_truth: 'control-repo', derivation_required: true },
    };
  }

  const route = ROUTES[event.kind];
  const tasks = (route.agents ?? []).map((agent) => ({
    agent,
    role: 'specialist',
    effect: SPECIALISTS[agent].effect,
    tools: SPECIALISTS[agent].tools,
    input_pack: packInput(event, agent),
  }));

  return {
    accepted: true,
    held: Boolean(route.held),
    freeze: Boolean(route.freeze),
    reason: route.held
      ? 'Routing held: denominator movement outranks failure count.'
      : route.freeze
        ? 'This kind is a human decision. No specialist is invoked.'
        : null,
    refusals: [],
    tasks,
    gate: route.gate,
    synthesis: { source_of_truth: 'control-repo', derivation_required: true },
  };
}
