import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CONTRACT_CONFIRMED, presentReadiness, sendPresenter } from '../src/present.mjs';
import { loadEvent, runGate, handleStoredInteraction } from '../src/host.mjs';

const run = promisify(execFile);

test('CONTRACT_CONFIRMED is false — live send is a refusal, not a no-op', () => {
  assert.equal(CONTRACT_CONFIRMED, false);
});

test('dry-run returns the payload and does not send', async () => {
  const r = await sendPresenter({
    presenter: 'slack',
    payload: { text: 'fallback', blocks: [] },
    live: false,
  });
  assert.equal(r.dryRun, true);
  assert.equal(r.sent, false);
  assert.equal(r.executed, false);
});

test('live send without a confirmed contract throws before fetch', async () => {
  let called = 0;
  await assert.rejects(
    () => sendPresenter({
      presenter: 'slack',
      payload: { text: 'x' },
      live: true,
      fetchImpl: async () => { called += 1; return { ok: true, status: 200 }; },
    }),
    /contract has not been confirmed/,
  );
  assert.equal(called, 0);
});

test('even a confirmed live send with credentials leaves executed false', async () => {
  let called = 0;
  const r = await sendPresenter({
    presenter: 'slack',
    payload: { text: 'x' },
    live: true,
    contractConfirmed: true,
    env: { SLACK_BOT_TOKEN: 'x', SLACK_CHANNEL: 'C1' },
    fetchImpl: async () => { called += 1; return { ok: true, status: 200 }; },
  });
  assert.equal(called, 1);
  assert.equal(r.sent, true);
  assert.equal(r.executed, false);
});

test('live send with a confirmed contract still refuses missing credentials', async () => {
  await assert.rejects(
    () => sendPresenter({
      presenter: 'github',
      payload: { body: 'x' },
      live: true,
      contractConfirmed: true,
      env: {},
    }),
    /missing GH_TOKEN, GITHUB_REPOSITORY/,
  );
});

test('presentReadiness names each missing variable', () => {
  const r = presentReadiness('linear', {});
  assert.deepEqual(r.missing, ['LINEAR_API_KEY']);
  assert.equal(r.ready, false);
});

test('a Slack block_actions fixture decides the stored gate and does not send', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'grc-present-'));
  const store = join(dir, 'gates.json');
  const event = await loadEvent('fixtures/events/threat-intel-match.json');
  await runGate({ event, store });
  const payload = await loadEvent('fixtures/events/slack-approve.json');
  const r = await handleStoredInteraction({
    store,
    payload,
    extras: { actor: 'per.approver', at: '2026-09-04T12:00:00Z' },
  });
  assert.equal(r.ok, true);
  assert.equal(r.decision.record.status, 'consented');
  assert.equal(r.decision.record.executed, false);
  assert.equal(r.sent, false);
  await rm(dir, { recursive: true, force: true });
});

test('CLI --interaction requires a per.* actor and decides the stored row', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'grc-present-'));
  const store = join(dir, 'gates.json');
  await run('node', [
    'src/cli.mjs', 'orchestrate',
    '--event', 'fixtures/events/threat-intel-match.json',
    '--store', store,
  ]);
  await assert.rejects(
    () => run('node', ['src/cli.mjs', 'gate', '--interaction', 'fixtures/events/slack-approve.json', '--store', store]),
    (err) => {
      assert.equal(err.code, 1);
      assert.match(err.stdout, /--actor per\.\*|--map/);
      return true;
    },
  );
  const { stdout } = await run('node', [
    'src/cli.mjs', 'gate',
    '--interaction', 'fixtures/events/slack-approve.json',
    '--actor', 'per.approver',
    '--at', '2026-09-04T12:00:00Z',
    '--store', store,
  ]);
  assert.match(stdout, /status=consented/);
  assert.match(stdout, /executed=false/);
  assert.match(stdout, /sent=false/);
  await rm(dir, { recursive: true, force: true });
});
