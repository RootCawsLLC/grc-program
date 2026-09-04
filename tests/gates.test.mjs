import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadEvent, runGate, handleStoredInteraction, listStored } from '../src/host.mjs';
import { loadGateLog, latestGate, rememberOpened } from '../src/gates.mjs';

const run = promisify(execFile);

const tmpStore = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'grc-gates-'));
  return { dir, store: join(dir, 'gates.json') };
};

test('opening a fixture gate persists it; a later process decides that row', async () => {
  const { dir, store } = await tmpStore();
  const event = await loadEvent('fixtures/events/threat-intel-match.json');
  const opened = await runGate({ event, store });
  assert.equal(opened.ok, true);
  assert.equal(opened.gate.status, 'pending');
  assert.equal(opened.stored, true);

  const later = await runGate({
    store,
    gate_id: opened.gate.gate_id,
    decision: { verdict: 'approve', actor: 'per.approver', at: '2026-09-04T12:00:00Z' },
  });
  assert.equal(later.ok, true);
  assert.equal(later.decision.record.status, 'consented');
  assert.equal(later.decision.record.executed, false);
  assert.equal(later.sent, false);

  const { entries } = await loadGateLog(store);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].status, 'pending');
  assert.equal(entries[1].status, 'consented');
  assert.equal(latestGate(entries, opened.gate.gate_id).status, 'consented');
  await rm(dir, { recursive: true, force: true });
});

test('a Slack click in another process looks up the stored gate_id', async () => {
  const { dir, store } = await tmpStore();
  const event = await loadEvent('fixtures/events/threat-intel-match.json');
  const opened = await runGate({ event, store });
  const clicked = await handleStoredInteraction({
    store,
    payload: { action_id: 'gate.approve', value: opened.gate.gate_id },
    extras: { actor: 'per.approver', at: '2026-09-04T12:00:00Z' },
  });
  assert.equal(clicked.ok, true);
  assert.equal(clicked.decision.record.executed, false);
  assert.equal((await listStored(store)).length, 0);
  await rm(dir, { recursive: true, force: true });
});

test('re-opening the same event_id while pending is a reuse, not a second gate', async () => {
  const { dir, store } = await tmpStore();
  const event = await loadEvent('fixtures/events/threat-intel-match.json');
  await runGate({ event, store });
  const again = await runGate({ event, store });
  assert.equal(again.reused, true);
  const { entries } = await loadGateLog(store);
  assert.equal(entries.length, 1);
  await rm(dir, { recursive: true, force: true });
});

test('a decided gate cannot be reopened under the same event_id', async () => {
  const { dir, store } = await tmpStore();
  const event = await loadEvent('fixtures/events/threat-intel-match.json');
  await runGate({
    event,
    store,
    decision: { verdict: 'approve', actor: 'per.approver', at: '2026-09-04T12:00:00Z' },
  });
  const again = await runGate({ event, store });
  assert.equal(again.code, 'already-decided');
  assert.equal(again.gate.status, 'consented');
  await rm(dir, { recursive: true, force: true });
});

test('synthetic and real gates do not share a log', async () => {
  const { dir, store } = await tmpStore();
  const event = await loadEvent('fixtures/events/threat-intel-match.json');
  const opened = await runGate({ event, store });
  await assert.rejects(
    () => rememberOpened(store, { ...opened.gate, gate_id: 'gate.real-1' }, false),
    /mixes synthetic and real/,
  );
  await rm(dir, { recursive: true, force: true });
});

test('CLI open then CLI decide --id share the store and do not send', async () => {
  const { dir, store } = await tmpStore();
  const opened = await run('node', [
    'src/cli.mjs', 'orchestrate',
    '--event', 'fixtures/events/threat-intel-match.json',
    '--store', store,
  ]);
  assert.match(opened.stdout, /gate\.evt\.fixture\.threat-intel-leftpad/);

  const listed = await run('node', ['src/cli.mjs', 'gate', '--list', '--store', store]);
  assert.match(listed.stdout, /gate\.evt\.fixture\.threat-intel-leftpad/);

  const decided = await run('node', [
    'src/cli.mjs', 'gate',
    '--id', 'gate.evt.fixture.threat-intel-leftpad',
    '--verdict', 'approve',
    '--actor', 'per.approver',
    '--at', '2026-09-04T12:00:00Z',
    '--store', store,
  ]);
  assert.match(decided.stdout, /status=consented/);
  assert.match(decided.stdout, /executed=false/);
  assert.match(decided.stdout, /sent=false/);

  const empty = await run('node', ['src/cli.mjs', 'gate', '--list', '--store', store]);
  assert.match(empty.stdout, /0 pending/);
  await rm(dir, { recursive: true, force: true });
});
