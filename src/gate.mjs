/**
 * Human gate — present a pending action, record a named decision, never apply it.
 *
 * `planDispatch` names a gate. This module turns that object into presenter
 * payloads (Slack Block Kit, a GitHub review comment, a Linear issue body) and
 * records approve / reject / acknowledge. The load-bearing invariant is
 * `executed: false` on every returned record. Consent is not a merge, not a
 * risk acceptance, and not a firewall change. Those stay with a human on the
 * surface that actually performs them (GitHub merge, an exceptions/ PR, the
 * cloud console).
 *
 * Risk acceptance and exception approval further require a `per.*` actor and
 * a mandatory `expires_on`. If a roster is supplied, entitlement is checked
 * with `heldScopeOn` on the decision date — same temporal rule as G12.
 */

import { heldScopeOn } from './lib/authority.mjs';

export const GATE_KINDS = Object.freeze([
  'pr-merge',
  'risk-acceptance',
  'exception-approval',
  'human-review',
  'human-page',
  'cloud-write',
]);

export const PRESENTERS = Object.freeze(['github', 'linear', 'slack']);

export const PERSON_ID = /^per\.[a-z0-9-]+$/;

const SCOPES = Object.freeze({
  'risk-acceptance': 'risk.accept.lt_materiality',
  'exception-approval': 'exception.approve',
  'human-review': 'customer.security.commit',
});

const NEXT_STEP = Object.freeze({
  'pr-merge': 'human-merges-on-github',
  'risk-acceptance': 'human-opens-acceptance-pr',
  'exception-approval': 'human-opens-exception-pr',
  'human-review': 'human-edits-or-sends-answer',
  'human-page': 'human-acts-on-the-page',
  'cloud-write': 'human-changes-cloud',
});

function dateOnly(iso) {
  if (!iso || typeof iso !== 'string') return null;
  return iso.slice(0, 10);
}

export function requiredScope(kind, { ge_materiality = false } = {}) {
  if (kind === 'risk-acceptance') {
    return ge_materiality ? 'risk.accept.ge_materiality' : 'risk.accept.lt_materiality';
  }
  return SCOPES[kind] ?? null;
}

export function nextStepFor(kind) {
  return NEXT_STEP[kind] ?? 'human-acts';
}

function refuse(pending, code, message) {
  return {
    ok: false,
    code,
    message,
    record: {
      ...pending,
      status: pending.status,
      executed: false,
      executed_action: null,
    },
  };
}

/**
 * Open a pending gate from a dispatch plan. No presenter is contacted here.
 * `gate_id` is derived from `event_id` so a retry does not mint a second gate.
 */
export function openGate({ plan, event, summary, opened_at }) {
  if (!plan?.gate) {
    return { opened: false, reason: 'no-gate', pending: null };
  }
  if (!event?.event_id) {
    return { opened: false, reason: 'missing-event-id', pending: null };
  }
  const kind = plan.gate.kind;
  if (!GATE_KINDS.includes(kind)) {
    return { opened: false, reason: 'unknown-kind', pending: null };
  }
  const presenter = plan.gate.presenter;
  if (!PRESENTERS.includes(presenter)) {
    return { opened: false, reason: 'unknown-presenter', pending: null };
  }

  return {
    opened: true,
    reason: null,
    pending: {
      gate_id: `gate.${event.event_id}`,
      event_id: event.event_id,
      kind,
      presenter,
      action: plan.gate.action,
      summary: summary ?? plan.reason ?? plan.gate.action,
      status: 'pending',
      freeze: Boolean(plan.freeze || plan.held),
      derivation_level: event.derivation_level ?? null,
      opened_at: opened_at ?? event.as_of,
      executed: false,
      executed_action: null,
      next_step: nextStepFor(kind),
      required_scope: requiredScope(kind),
    },
  };
}

function plain(text) {
  return { type: 'plain_text', text };
}

function mrkdwn(text) {
  return { type: 'mrkdwn', text };
}

function confirmDoesNotApply() {
  return {
    title: plain('This does not apply the change'),
    text: plain('Consent is recorded. Merge, risk acceptance, and cloud writes stay with a named human on a PR or in the console.'),
    confirm: plain('Record consent'),
    deny: plain('Cancel'),
  };
}

/**
 * Slack message payload. Buttons post an interaction; the host must call
 * `decideGate`. Clicking Record consent does not merge or mutate cloud.
 */
export function slackPresenter(pending) {
  const consentable = pending.kind === 'pr-merge'
    || pending.kind === 'risk-acceptance'
    || pending.kind === 'exception-approval'
    || pending.kind === 'human-review';

  const fields = [
    mrkdwn(`*Kind*\n${pending.kind}`),
    mrkdwn(`*Action*\n\`${pending.action}\``),
    mrkdwn(`*Next step*\n${pending.next_step}`),
    mrkdwn(`*Executed*\nfalse — this box cannot apply the change`),
  ];
  if (pending.derivation_level) {
    fields.push(mrkdwn(`*Derivation*\n${pending.derivation_level}`));
  }
  if (pending.required_scope) {
    fields.push(mrkdwn(`*Scope*\n\`${pending.required_scope}\``));
  }

  const elements = [];
  if (consentable) {
    elements.push({
      type: 'button',
      text: plain('Record consent'),
      style: 'primary',
      action_id: 'gate.approve',
      value: pending.gate_id,
      confirm: confirmDoesNotApply(),
      accessibility_label: 'Record consent. Does not merge, accept risk, or change cloud.',
    });
  }
  elements.push({
    type: 'button',
    text: plain(consentable ? 'Reject' : 'Acknowledge'),
    style: consentable ? 'danger' : undefined,
    action_id: consentable ? 'gate.reject' : 'gate.acknowledge',
    value: pending.gate_id,
    accessibility_label: consentable
      ? 'Reject this pending action'
      : 'Acknowledge the page. Does not change the estate.',
  });

  const headerText = consentable
    ? 'Human gate — consent only'
    : pending.kind === 'cloud-write'
      ? 'Human gate — cloud write not consentable'
      : 'Human gate — page';

  return {
    presenter: 'slack',
    text: `${headerText}: ${pending.summary}. Executed remains false.`,
    blocks: [
      {
        type: 'header',
        block_id: `gate.header.${pending.gate_id}`,
        text: plain(headerText),
      },
      {
        type: 'section',
        block_id: `gate.summary.${pending.gate_id}`,
        text: mrkdwn(pending.summary),
      },
      {
        type: 'section',
        block_id: `gate.fields.${pending.gate_id}`,
        fields,
      },
      { type: 'divider', block_id: `gate.div.${pending.gate_id}` },
      {
        type: 'context',
        block_id: `gate.ctx.${pending.gate_id}`,
        elements: [
          mrkdwn('A missing tool cannot merge. This button cannot either. `executed` stays false.'),
        ],
      },
      {
        type: 'actions',
        block_id: `gate.actions.${pending.gate_id}`,
        elements,
      },
    ],
  };
}

export function githubPresenter(pending) {
  const consentable = pending.kind === 'pr-merge'
    || pending.kind === 'risk-acceptance'
    || pending.kind === 'exception-approval'
    || pending.kind === 'human-review';
  const heading = pending.kind === 'cloud-write'
    ? 'Human gate — cloud write not consentable'
    : consentable
      ? 'Human gate — consent only'
      : 'Human gate — page';
  const closer = pending.kind === 'cloud-write'
    ? 'Cloud writes are not consentable here. Change the estate yourself.'
    : consentable
      ? 'Recording consent is not a merge. Merge the PR yourself, or open the\nacceptance / exception PR with a named `per.*` actor and an `expires_on`.\n\n- [ ] Named human recorded (`per.*`)'
      : 'Acknowledge the page. This comment does not change the estate.';

  const lines = [
    `## ${heading}`,
    '',
    pending.summary,
    '',
    `| | |`,
    `|---|---|`,
    `| Gate | \`${pending.gate_id}\` |`,
    `| Kind | \`${pending.kind}\` |`,
    `| Action | \`${pending.action}\` |`,
    `| Next step | \`${pending.next_step}\` |`,
    `| Executed | \`false\` — this comment cannot apply the change |`,
    pending.derivation_level ? `| Derivation | \`${pending.derivation_level}\` |` : null,
    pending.required_scope ? `| Required scope | \`${pending.required_scope}\` |` : null,
    '',
    closer,
  ].filter((x) => x !== null);

  return {
    presenter: 'github',
    event: 'COMMENT',
    body: lines.join('\n'),
  };
}

export function linearPresenter(pending) {
  return {
    presenter: 'linear',
    title: `[gate] ${pending.kind}: ${pending.action}`,
    description: [
      pending.summary,
      '',
      `gate_id: ${pending.gate_id}`,
      `next_step: ${pending.next_step}`,
      'executed: false',
      pending.required_scope ? `required_scope: ${pending.required_scope}` : null,
      '',
      'This issue records a pending human decision. It does not merge, accept',
      'risk, approve an exception, or change cloud.',
    ].filter(Boolean).join('\n'),
    label: 'gate:pending',
  };
}

export function presentGate(pending) {
  if (!pending) return { presenter: null, error: 'missing-pending' };
  if (pending.presenter === 'slack') return slackPresenter(pending);
  if (pending.presenter === 'github') return githubPresenter(pending);
  if (pending.presenter === 'linear') return linearPresenter(pending);
  return { presenter: pending.presenter, error: 'unknown-presenter' };
}

/**
 * Record a human decision. Never sets `executed` true. Never returns a
 * normative tool name to invoke.
 */
export function decideGate(pending, decision = {}, { roster } = {}) {
  if (!pending || pending.status !== 'pending') {
    return refuse(pending ?? { status: 'absent' }, 'not-pending', 'Gate is not pending.');
  }

  const verdict = decision.verdict;
  if (!['approve', 'reject', 'acknowledge'].includes(verdict)) {
    return refuse(pending, 'bad-verdict', `verdict ${JSON.stringify(verdict)} is not approve|reject|acknowledge.`);
  }

  const at = decision.at;
  if (!at) return refuse(pending, 'missing-at', 'Decision time is required. Untimed approvals are not reconstructable.');
  const onDate = dateOnly(at);

  if (verdict === 'acknowledge') {
    return {
      ok: true,
      code: null,
      message: null,
      record: {
        ...pending,
        status: 'acknowledged',
        decided_by: decision.actor ?? null,
        decided_at: at,
        executed: false,
        executed_action: null,
        next_step: pending.next_step,
      },
    };
  }

  if (verdict === 'reject') {
    if (!decision.actor || !PERSON_ID.test(decision.actor)) {
      return refuse(pending, 'unnamed-actor', 'Reject still needs a named per.* actor.');
    }
    return {
      ok: true,
      code: null,
      message: null,
      record: {
        ...pending,
        status: 'rejected',
        decided_by: decision.actor,
        decided_at: at,
        executed: false,
        executed_action: null,
        next_step: 'none',
      },
    };
  }

  // approve
  if (pending.kind === 'cloud-write' || pending.kind === 'human-page') {
    return refuse(
      pending,
      'not-consentable',
      `${pending.kind} is not consentable through this gate. Acknowledge, then act on the estate yourself.`,
    );
  }

  if (!decision.actor || !PERSON_ID.test(decision.actor)) {
    return refuse(pending, 'unnamed-actor', 'Approve requires a named per.* actor. Bots and display names are refused.');
  }

  if (pending.kind === 'risk-acceptance' || pending.kind === 'exception-approval') {
    if (!decision.expires_on) {
      return refuse(pending, 'missing-expiry', 'Risk acceptance and exception approval require expires_on.');
    }
    if (decision.expires_on <= onDate) {
      return refuse(pending, 'expiry-not-future', 'expires_on must be after the decision date.');
    }
  }

  const scope = requiredScope(pending.kind, { ge_materiality: Boolean(decision.ge_materiality) });
  if (scope && roster) {
    const people = roster.people?.records ?? [];
    const person = people.find((p) => p.person_id === decision.actor);
    const held = heldScopeOn(person, scope, onDate);
    if (!held.held) {
      return refuse(
        pending,
        'not-entitled',
        `${decision.actor} did not hold ${scope} on ${onDate}${held.reason ? ` (${held.reason})` : ''}.`,
      );
    }
  }

  return {
    ok: true,
    code: null,
    message: null,
    record: {
      ...pending,
      status: 'consented',
      decided_by: decision.actor,
      decided_at: at,
      expires_on: decision.expires_on ?? null,
      required_scope: scope,
      executed: false,
      executed_action: null,
      next_step: pending.next_step,
    },
  };
}

/**
 * Flatten our payload or Slack's `block_actions` shape. Slack's `user.id` is
 * not a `per.*` actor — the host still has to pass one.
 */
export function normalizeInteraction(payload) {
  if (!payload || typeof payload !== 'object') return { action_id: null, value: null };
  if (payload.action_id) return { action_id: payload.action_id, value: payload.value ?? null };
  const action = Array.isArray(payload.actions) ? payload.actions[0] : null;
  if (action?.action_id) return { action_id: action.action_id, value: action.value ?? null };
  return { action_id: null, value: null };
}

/**
 * Map a Slack interaction payload onto `decideGate`. The host still supplies
 * the pending record, the actor, and any expiry — Slack only names the button.
 */
export function interpretInteraction(payload) {
  const { action_id, value } = normalizeInteraction(payload);
  const verdict = action_id === 'gate.approve'
    ? 'approve'
    : action_id === 'gate.reject'
      ? 'reject'
      : action_id === 'gate.acknowledge'
        ? 'acknowledge'
        : null;
  return { verdict, gate_id: value ?? null };
}
