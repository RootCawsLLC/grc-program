import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planDispatch,
  TOOL_DEFINITIONS,
  FORBIDDEN_TOOL_NAMES,
  EVENT_KINDS,
  NORMATIVE_ACTIONS,
} from '../src/orchestrate.mjs';

const event = (over = {}) => ({
  event_id: 'evt-1',
  kind: 'control.failing',
  source: 'pipeline.route',
  as_of: '2026-09-04T04:00:00Z',
  ...over,
});

test('a failing subject routes to exception-triage as a draft, with no shared state file', () => {
  const plan = planDispatch(event({
    derivation_level: 'measured',
    payload: { control_id: 'ctl.iam.cloud-platform.mfa', failing_count: 2 },
  }));
  assert.equal(plan.accepted, true);
  assert.equal(plan.freeze, false);
  assert.equal(plan.gate, null);
  assert.deepEqual(plan.tasks.map((t) => t.agent), ['exception-triage']);
  assert.equal(plan.tasks[0].effect, 'draft');
  assert.equal(plan.tasks[0].input_pack.shared_state_file, null);
  assert.ok(plan.tasks[0].tools.includes('save_issue'));
});

test('a threat-intel match packs evidence-scout and scenario-scoper and still requires a PR merge gate', () => {
  const plan = planDispatch(event({
    kind: 'threat-intel.match',
    source: 'cve-feed',
    payload: { cve: 'CVE-2026-0001', component: 'leftpad' },
  }));
  assert.equal(plan.accepted, true);
  assert.deepEqual(plan.tasks.map((t) => t.agent), ['evidence-scout', 'scenario-scoper']);
  assert.equal(plan.gate.kind, 'pr-merge');
  assert.equal(plan.gate.presenter, 'github');
  assert.ok(!plan.tasks.some((t) => t.tools.includes('merge_pr')));
});

test('denominator drift holds routing and pages a human before any ticket is opened', () => {
  const plan = planDispatch(event({ kind: 'denominator.drift', source: 'pipeline.drift' }));
  assert.equal(plan.held, true);
  assert.deepEqual(plan.tasks, []);
  assert.equal(plan.gate.kind, 'human-page');
});

test('risk acceptance and exception approval freeze with no specialist', () => {
  for (const kind of ['risk.acceptance', 'exception.approval']) {
    const plan = planDispatch(event({ kind }));
    assert.equal(plan.freeze, true, kind);
    assert.deepEqual(plan.tasks, [], kind);
    assert.ok(['risk-acceptance', 'exception-approval'].includes(plan.gate.kind), kind);
  }
});

test('an unlabelled quantity is refused rather than planned', () => {
  const plan = planDispatch(event({
    payload: { control_id: 'ctl.a.b.c', failing_count: 4 },
  }));
  assert.equal(plan.accepted, false);
  assert.equal(plan.refusals[0].code, 'unlabelled-number');
});

test('a model self-score is refused even when a derivation_level is present', () => {
  const plan = planDispatch(event({
    derivation_level: 'assumed',
    payload: { confidence: 0.85, control_id: 'ctl.a.b.c' },
  }));
  assert.equal(plan.accepted, false);
  assert.equal(plan.refusals[0].code, 'model-confidence');
});

test('an efficacy conclusion is refused', () => {
  const plan = planDispatch(event({
    payload: { concludes_efficacy: true },
  }));
  assert.equal(plan.refusals[0].code, 'efficacy-conclusion');
});

test('a proposed merge freezes and does not dispatch a specialist', () => {
  const plan = planDispatch(event({
    kind: 'threat-intel.match',
    proposed_actions: ['apply_patch_to_default_branch', 'merge_pr'],
  }));
  assert.equal(plan.accepted, true);
  assert.equal(plan.freeze, true);
  assert.deepEqual(plan.tasks, []);
  assert.equal(plan.gate.kind, 'pr-merge');
});

test('a proposed cloud write uses the cloud-write gate', () => {
  const plan = planDispatch(event({
    kind: 'incident',
    proposed_actions: ['change_firewall'],
  }));
  assert.equal(plan.freeze, true);
  assert.equal(plan.gate.kind, 'cloud-write');
});

test('a shared state file is refused — context is packed per task', () => {
  const plan = planDispatch(event({ state_file: '.agents/state.json' }));
  assert.equal(plan.refusals[0].code, 'shared-state');
});

test('unknown kind, missing as_of and a missing envelope are refused', () => {
  assert.equal(planDispatch(event({ kind: 'ciso.directive' })).refusals[0].code, 'unknown-kind');
  assert.equal(planDispatch(event({ as_of: undefined })).refusals[0].code, 'missing-as-of');
  assert.equal(planDispatch(null).refusals[0].code, 'malformed');
});

test('every registered tool is read or draft, and no normative name is registered', () => {
  for (const tool of TOOL_DEFINITIONS) {
    assert.ok(['read', 'draft'].includes(tool.effect), tool.name);
    assert.ok(!FORBIDDEN_TOOL_NAMES.includes(tool.name), tool.name);
  }
  const names = new Set(TOOL_DEFINITIONS.map((t) => t.name));
  for (const forbidden of NORMATIVE_ACTIONS) {
    assert.equal(names.has(forbidden), false, forbidden);
  }
});

test('plan_dispatch schema enum matches EVENT_KINDS', () => {
  const tool = TOOL_DEFINITIONS.find((t) => t.name === 'plan_dispatch');
  assert.deepEqual(tool.inputSchema.properties.kind.enum, [...EVENT_KINDS]);
});
