import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDispatch } from '../src/orchestrate.mjs';
import {
  openGate,
  presentGate,
  decideGate,
  interpretInteraction,
  slackPresenter,
  PERSON_ID,
} from '../src/gate.mjs';

const event = (over = {}) => ({
  event_id: 'evt-gate-1',
  kind: 'threat-intel.match',
  source: 'cve-feed',
  as_of: '2026-09-04T04:00:00Z',
  ...over,
});

const roster = (...people) => ({
  people: { records: people, present: true, _file: 'roster/people.yaml' },
  teams: { records: [], present: true, _file: 'roster/teams.yaml' },
});

const entitled = (over = {}) => ({
  person_id: 'per.approver',
  full_name: 'A Approver',
  role: 'Head of Security',
  authority: [
    { scope: 'exception.approve', from: '2026-01-01' },
    { scope: 'risk.accept.lt_materiality', from: '2026-01-01' },
    { scope: 'customer.security.commit', from: '2026-01-01' },
  ],
  ...over,
});

const pendingFrom = (kindOver = {}, eventOver = {}) => {
  const ev = event(eventOver);
  const plan = planDispatch(ev);
  const opened = openGate({ plan: { ...plan, gate: { ...plan.gate, ...kindOver } }, event: ev, summary: 'test summary' });
  assert.equal(opened.opened, true);
  return opened.pending;
};

test('openGate derives a stable id from the event and keeps executed false', () => {
  const plan = planDispatch(event());
  const a = openGate({ plan, event: event(), summary: 'CVE match' });
  const b = openGate({ plan, event: event(), summary: 'CVE match' });
  assert.equal(a.pending.gate_id, 'gate.evt-gate-1');
  assert.equal(a.pending.gate_id, b.pending.gate_id);
  assert.equal(a.pending.executed, false);
  assert.equal(a.pending.next_step, 'human-merges-on-github');
});

test('a plan with no gate does not open one', () => {
  const plan = planDispatch(event({ kind: 'auditor.request' }));
  assert.equal(plan.gate, null);
  assert.equal(openGate({ plan, event: event({ kind: 'auditor.request' }) }).opened, false);
});

test('consent on a PR-merge gate does not merge and names the next human step', () => {
  const pending = pendingFrom();
  const decided = decideGate(pending, {
    verdict: 'approve',
    actor: 'per.approver',
    at: '2026-09-04T12:00:00Z',
  });
  assert.equal(decided.ok, true);
  assert.equal(decided.record.status, 'consented');
  assert.equal(decided.record.executed, false);
  assert.equal(decided.record.executed_action, null);
  assert.equal(decided.record.next_step, 'human-merges-on-github');
  assert.equal(pending.status, 'pending', 'input is not mutated');
});

test('risk acceptance without expiry is refused', () => {
  const pending = pendingFrom({ kind: 'risk-acceptance', action: 'named-human-accepts-with-expiry' }, { kind: 'risk.acceptance' });
  const decided = decideGate(pending, {
    verdict: 'approve',
    actor: 'per.approver',
    at: '2026-09-04T12:00:00Z',
  });
  assert.equal(decided.ok, false);
  assert.equal(decided.code, 'missing-expiry');
  assert.equal(decided.record.executed, false);
});

test('risk acceptance with a named actor, future expiry and a live grant is consented, not executed', () => {
  const pending = pendingFrom({ kind: 'risk-acceptance', action: 'named-human-accepts-with-expiry' }, { kind: 'risk.acceptance' });
  const decided = decideGate(
    pending,
    { verdict: 'approve', actor: 'per.approver', at: '2026-09-04T12:00:00Z', expires_on: '2027-03-01' },
    { roster: roster(entitled()) },
  );
  assert.equal(decided.ok, true);
  assert.equal(decided.record.status, 'consented');
  assert.equal(decided.record.executed, false);
  assert.equal(decided.record.next_step, 'human-opens-acceptance-pr');
  assert.equal(decided.record.expires_on, '2027-03-01');
});

test('an actor who does not hold the scope on that date is refused', () => {
  const pending = pendingFrom({ kind: 'exception-approval', action: 'named-approver-and-expiry' }, { kind: 'exception.approval' });
  const decided = decideGate(
    pending,
    { verdict: 'approve', actor: 'per.approver', at: '2026-09-04T12:00:00Z', expires_on: '2027-01-01' },
    { roster: roster(entitled({ authority: [{ scope: 'exception.approve', from: '2026-01-01', until: '2026-06-01' }] })) },
  );
  assert.equal(decided.code, 'not-entitled');
  assert.equal(decided.record.executed, false);
});

test('CISO Bot and a display name are not actors', () => {
  const pending = pendingFrom();
  assert.equal(PERSON_ID.test('CISO Bot'), false);
  assert.equal(decideGate(pending, { verdict: 'approve', actor: 'CISO Bot', at: '2026-09-04T12:00:00Z' }).code, 'unnamed-actor');
  assert.equal(decideGate(pending, { verdict: 'approve', actor: 'Ada Lovelace', at: '2026-09-04T12:00:00Z' }).code, 'unnamed-actor');
});

test('cloud-write cannot be approved through the gate', () => {
  const pending = pendingFrom({ kind: 'cloud-write', presenter: 'slack', action: 'change_firewall' }, {
    kind: 'incident',
    proposed_actions: ['change_firewall'],
  });
  assert.equal(pending.kind, 'cloud-write');
  const decided = decideGate(pending, {
    verdict: 'approve',
    actor: 'per.approver',
    at: '2026-09-04T12:00:00Z',
  });
  assert.equal(decided.code, 'not-consentable');
  const ack = decideGate(pending, { verdict: 'acknowledge', at: '2026-09-04T12:00:00Z' });
  assert.equal(ack.ok, true);
  assert.equal(ack.record.executed, false);
  assert.equal(ack.record.next_step, 'human-changes-cloud');
});

test('a second decision on an already-decided gate is refused', () => {
  const pending = pendingFrom();
  const first = decideGate(pending, { verdict: 'approve', actor: 'per.approver', at: '2026-09-04T12:00:00Z' });
  const second = decideGate(first.record, { verdict: 'approve', actor: 'per.approver', at: '2026-09-04T13:00:00Z' });
  assert.equal(second.code, 'not-pending');
});

test('Slack presenter never registers a normative action_id and always says executed is false', () => {
  const pending = pendingFrom();
  const slack = slackPresenter(pending);
  assert.match(slack.text, /Executed remains false/);
  const actionIds = slack.blocks.flatMap((b) => (b.elements ?? []).map((e) => e.action_id)).filter(Boolean);
  assert.deepEqual(actionIds.sort(), ['gate.approve', 'gate.reject']);
  assert.ok(!JSON.stringify(slack).includes('merge_pr'));
  assert.ok(!JSON.stringify(slack).includes('change_firewall'));
  const cloud = slackPresenter(pendingFrom({ kind: 'cloud-write', presenter: 'slack', action: 'change_firewall' }, {
    kind: 'incident',
    proposed_actions: ['change_firewall'],
  }));
  const cloudIds = cloud.blocks.flatMap((b) => (b.elements ?? []).map((e) => e.action_id)).filter(Boolean);
  assert.deepEqual(cloudIds, ['gate.acknowledge']);
});

test('GitHub and Linear presenters carry the same executed:false contract', () => {
  const pending = pendingFrom({ presenter: 'github' });
  const gh = presentGate(pending);
  assert.match(gh.body, /Executed \| `false`/);
  assert.match(gh.body, /Recording consent is not a merge/);
  const cloud = presentGate(pendingFrom({ kind: 'cloud-write', presenter: 'github', action: 'change_firewall' }, {
    kind: 'incident',
    proposed_actions: ['change_firewall'],
  }));
  assert.match(cloud.body, /cloud write not consentable/);
  assert.ok(!cloud.body.includes('Recording consent is not a merge'));
  const lin = presentGate({ ...pending, presenter: 'linear' });
  assert.match(lin.description, /executed: false/);
  assert.match(lin.description, /does not merge/i);
});

test('interpretInteraction maps Slack action_ids and nothing else', () => {
  assert.deepEqual(interpretInteraction({ action_id: 'gate.approve', value: 'gate.evt-1' }), {
    verdict: 'approve',
    gate_id: 'gate.evt-1',
  });
  assert.deepEqual(
    interpretInteraction({
      type: 'block_actions',
      actions: [{ action_id: 'gate.approve', value: 'gate.evt-1' }],
      user: { id: 'U1' },
    }),
    { verdict: 'approve', gate_id: 'gate.evt-1' },
  );
  assert.equal(interpretInteraction({ action_id: 'merge_pr', value: 'gate.evt-1' }).verdict, null);
});
