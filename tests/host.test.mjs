import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dispatch, loadEvent, handleInteraction } from '../src/host.mjs';
import { FIXTURE_STAMP } from '../src/lib/load.mjs';

const run = promisify(execFile);

const roster = {
  people: {
    records: [{
      person_id: 'per.approver',
      full_name: 'A Approver',
      role: 'Head of Security',
      authority: [
        { scope: 'exception.approve', from: '2026-01-01' },
        { scope: 'risk.accept.lt_materiality', from: '2026-01-01' },
      ],
    }],
    present: true,
  },
};

test('a stamped fixture threat-intel event plans, presents, and never sends', async () => {
  const event = await loadEvent('fixtures/events/threat-intel-match.json');
  const r = dispatch(event);
  assert.equal(r.ok, true);
  assert.equal(r.fixture, true);
  assert.equal(r.sent, false);
  assert.equal(r.executed, false);
  assert.deepEqual(r.plan.tasks.map((t) => t.agent), ['evidence-scout', 'scenario-scoper']);
  assert.equal(r.gate.kind, 'pr-merge');
  assert.equal(r.presenter.presenter, 'github');
  assert.match(r.presenter.body, /Executed \| `false`/);
});

test('consent on that fixture still leaves executed and sent false', async () => {
  const event = await loadEvent('fixtures/events/threat-intel-match.json');
  const r = dispatch(event, {
    decision: { verdict: 'approve', actor: 'per.approver', at: '2026-09-04T12:00:00Z' },
  });
  assert.equal(r.ok, true);
  assert.equal(r.decision.record.status, 'consented');
  assert.equal(r.decision.record.executed, false);
  assert.equal(r.executed, false);
  assert.equal(r.sent, false);
});

test('risk acceptance on the fixture requires expiry; with it, still not executed', async () => {
  const event = await loadEvent('fixtures/events/risk-acceptance.json');
  const missing = dispatch(event, {
    decision: { verdict: 'approve', actor: 'per.approver', at: '2026-09-04T12:00:00Z' },
    roster,
  });
  assert.equal(missing.code, 'missing-expiry');
  const ok = dispatch(event, {
    decision: { verdict: 'approve', actor: 'per.approver', at: '2026-09-04T12:00:00Z', expires_on: '2027-03-01' },
    roster,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.decision.record.executed, false);
  assert.equal(ok.decision.record.next_step, 'human-opens-acceptance-pr');
});

test('a Slack Record-consent click goes through handleInteraction and does not merge', async () => {
  const event = await loadEvent('fixtures/events/threat-intel-match.json');
  const opened = dispatch(event);
  const clicked = handleInteraction(opened.gate, {
    action_id: 'gate.approve',
    value: opened.gate.gate_id,
  }, { actor: 'per.approver', at: '2026-09-04T12:00:00Z' });
  assert.equal(clicked.ok, true);
  assert.equal(clicked.record.executed, false);
  assert.equal(clicked.record.next_step, 'human-merges-on-github');
});

test('a merge_pr action_id is an unknown button, not a merge', async () => {
  const event = await loadEvent('fixtures/events/threat-intel-match.json');
  const opened = dispatch(event);
  const clicked = handleInteraction(opened.gate, { action_id: 'merge_pr', value: opened.gate.gate_id });
  assert.equal(clicked.code, 'unknown-action');
  assert.equal(clicked.record.executed, false);
});

test('cloud-write fixture is acknowledge-only', async () => {
  const event = await loadEvent('fixtures/events/cloud-write.json');
  const approve = dispatch(event, {
    decision: { verdict: 'approve', actor: 'per.approver', at: '2026-09-04T12:00:00Z' },
  });
  assert.equal(approve.code, 'not-consentable');
  const ack = dispatch(event, { decision: { verdict: 'acknowledge', at: '2026-09-04T12:00:00Z' } });
  assert.equal(ack.ok, true);
  assert.equal(ack.decision.record.executed, false);
  assert.equal(ack.presenter.presenter, 'github');
});

test('send:true is refused before a plan is produced', () => {
  const r = dispatch({ event_id: 'x', kind: 'auditor.request', source: 't', as_of: '2026-09-04T04:00:00Z' }, { send: true });
  assert.equal(r.code, 'send-refused');
  assert.equal(r.plan, null);
  assert.equal(r.sent, false);
});

test('an unstamped file under fixtures/ is refused', async () => {
  const { mkdir } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'grc-event-'));
  const path = join(dir, 'fixtures', 'events', 'unstamped.json');
  await mkdir(join(dir, 'fixtures', 'events'), { recursive: true });
  await writeFile(path, JSON.stringify({
    event_id: 'evt.bad',
    kind: 'auditor.request',
    source: 't',
    as_of: '2026-09-04T04:00:00Z',
  }));
  await assert.rejects(() => loadEvent(path), /unstamped fixture/);
  await rm(dir, { recursive: true, force: true });
});

test('CLI orchestrate on the fixture prints the plan and refuses --live', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'grc-store-'));
  const store = join(dir, 'gates.json');
  const { stdout } = await run('node', [
    'src/cli.mjs', 'orchestrate',
    '--event', 'fixtures/events/threat-intel-match.json',
    '--store', store,
  ]);
  assert.match(stdout, /ORCHESTRATE/);
  assert.match(stdout, /NOT REAL EVIDENCE/);
  assert.match(stdout, /evidence-scout/);
  assert.match(stdout, /executed=false/);
  assert.match(stdout, /sent=false/);
  await assert.rejects(
    () => run('node', ['src/cli.mjs', 'orchestrate', '--event', 'fixtures/events/threat-intel-match.json', '--live']),
    (err) => {
      assert.equal(err.code, 1);
      assert.match(err.stdout, /refusing --live/);
      return true;
    },
  );
  await rm(dir, { recursive: true, force: true });
});

test('CLI gate records consent without sending', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'grc-store-'));
  const store = join(dir, 'gates.json');
  const { stdout } = await run('node', [
    'src/cli.mjs', 'gate',
    '--event', 'fixtures/events/threat-intel-match.json',
    '--verdict', 'approve',
    '--actor', 'per.approver',
    '--at', '2026-09-04T12:00:00Z',
    '--store', store,
  ]);
  assert.match(stdout, /status=consented/);
  assert.match(stdout, /executed=false/);
  assert.match(stdout, new RegExp(FIXTURE_STAMP));
  await rm(dir, { recursive: true, force: true });
});
