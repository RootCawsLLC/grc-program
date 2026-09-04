import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  parseIdentityMap,
  readIdentityMap,
  resolveInteractionActor,
  signSlackRequest,
  verifySlackRequest,
  signGitHubRequest,
  verifyGitHubRequest,
  SLACK_MAX_SKEW_SECONDS,
} from '../src/inbound.mjs';
import { loadEvent, runGate, handleStoredInteraction } from '../src/host.mjs';
import { FIXTURE_STAMP } from '../src/lib/load.mjs';

const run = promisify(execFile);
const SECRET = 'fixture-signing-secret-not-real';

test('a valid Slack signature inside the replay window is accepted and still not executed', () => {
  const timestamp = '1780000000';
  const rawBody = '{"type":"block_actions"}';
  const now = Number(timestamp) * 1000;
  const signature = signSlackRequest(SECRET, timestamp, rawBody);
  const r = verifySlackRequest({ signingSecret: SECRET, timestamp, rawBody, signature, now });
  assert.equal(r.ok, true);
  assert.equal(r.executed, false);
});

test('a missing signing secret is a refusal, not an unsigned pass', () => {
  const r = verifySlackRequest({
    signingSecret: '',
    timestamp: '1',
    rawBody: '{}',
    signature: 'v0=abc',
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'missing-signing-secret');
});

test('a bad HMAC is refused', () => {
  const timestamp = '1780000000';
  const r = verifySlackRequest({
    signingSecret: SECRET,
    timestamp,
    rawBody: '{"type":"block_actions"}',
    signature: 'v0=deadbeef',
    now: Number(timestamp) * 1000,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'bad-signature');
});

test('a timestamp outside the replay window is refused', () => {
  const timestamp = '1000';
  const rawBody = '{}';
  const signature = signSlackRequest(SECRET, timestamp, rawBody);
  const r = verifySlackRequest({
    signingSecret: SECRET,
    timestamp,
    rawBody,
    signature,
    now: (Number(timestamp) + SLACK_MAX_SKEW_SECONDS + 10) * 1000,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'replay-window');
});

test('a fixture identity map joins a Slack user id onto per.* and nothing else', async () => {
  const map = await readIdentityMap('fixtures/identity/slack-map.json');
  assert.equal(map.slack.U000FIXTURE, 'per.approver');
  assert.equal(map.fixture, true);
  const r = resolveInteractionActor({
    payload: { user: { id: 'U000FIXTURE', username: 'not-a-person-id' } },
    map,
  });
  assert.equal(r.ok, true);
  assert.equal(r.actor, 'per.approver');
  assert.equal(r.via, 'slack');
});

test('an unmapped Slack user is refused rather than inferred from the username', async () => {
  const map = await readIdentityMap('fixtures/identity/slack-map.json');
  const r = resolveInteractionActor({
    payload: { user: { id: 'U999UNKNOWN', username: 'per.approver' } },
    map,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'unmapped-slack-user');
});

test('a username key in the map is refused at load, so it cannot be looked up later', () => {
  assert.throws(
    () => parseIdentityMap({
      _stamp: FIXTURE_STAMP,
      slack: { 'not-a-person-id': 'per.approver' },
    }, { path: 'fixtures/identity/bad.json' }),
    /not a slack user id/i,
  );
});

test('a map target that is not per.* is refused', () => {
  assert.throws(
    () => parseIdentityMap({
      _stamp: FIXTURE_STAMP,
      slack: { U000FIXTURE: 'CISO Bot' },
    }, { path: 'fixtures/identity/bad.json' }),
    /not a per\.\* person_id/,
  );
});

test('an unstamped fixture map is refused at the door', () => {
  assert.throws(
    () => parseIdentityMap({ slack: { U000FIXTURE: 'per.approver' } }, { path: 'fixtures/identity/x.json' }),
    /unstamped fixture identity map/,
  );
});

test('a Slack user.id that looks like per.* is refused rather than trusted', () => {
  const r = resolveInteractionActor({
    payload: { user: { id: 'per.approver' } },
    actor: 'per.approver',
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'slack-id-is-not-a-person');
});

test('--actor and --map must name the same person', async () => {
  const map = await readIdentityMap('fixtures/identity/slack-map.json');
  const r = resolveInteractionActor({
    payload: { user: { id: 'U000FIXTURE' } },
    map,
    actor: 'per.other',
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'actor-mismatch');
});

test('handleStoredInteraction resolves the actor from the map and still does not execute', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'grc-inbound-'));
  const store = join(dir, 'gates.json');
  const event = await loadEvent('fixtures/events/threat-intel-match.json');
  await runGate({ event, store });
  const payload = await loadEvent('fixtures/events/slack-approve.json');
  const map = await readIdentityMap('fixtures/identity/slack-map.json');
  const r = await handleStoredInteraction({
    store,
    payload,
    map,
    extras: { at: '2026-09-04T12:00:00Z' },
  });
  assert.equal(r.ok, true);
  assert.equal(r.decision.record.decided_by, 'per.approver');
  assert.equal(r.decision.record.status, 'consented');
  assert.equal(r.decision.record.executed, false);
  assert.equal(r.sent, false);
  await rm(dir, { recursive: true, force: true });
});

test('CLI --map decides without --actor; --signed without a secret is refused', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'grc-inbound-cli-'));
  const store = join(dir, 'gates.json');
  await run('node', [
    'src/cli.mjs', 'orchestrate',
    '--event', 'fixtures/events/threat-intel-match.json',
    '--store', store,
  ]);
  const { stdout } = await run('node', [
    'src/cli.mjs', 'gate',
    '--interaction', 'fixtures/events/slack-approve.json',
    '--map', 'fixtures/identity/slack-map.json',
    '--at', '2026-09-04T12:00:00Z',
    '--store', store,
  ]);
  assert.match(stdout, /status=consented/);
  assert.match(stdout, /executed=false/);

  const body = await readFile('fixtures/events/slack-approve.json', 'utf8');
  const ts = '1780000000';
  const signature = signSlackRequest(SECRET, ts, body);
  await assert.rejects(
    () => run('node', [
      'src/cli.mjs', 'gate',
      '--interaction', 'fixtures/events/slack-approve.json',
      '--map', 'fixtures/identity/slack-map.json',
      '--signed',
      '--timestamp', ts,
      '--signature', signature,
      '--store', store,
    ], { env: { ...process.env, SLACK_SIGNING_SECRET: '' } }),
    (err) => {
      assert.equal(err.code, 1);
      assert.match(err.stdout, /SLACK_SIGNING_SECRET is absent|missing-signing-secret|signing secret/);
      return true;
    },
  );
  await rm(dir, { recursive: true, force: true });
});

test('CLI --signed with the secret verifies the raw file bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'grc-inbound-signed-'));
  const store = join(dir, 'gates.json');
  await run('node', [
    'src/cli.mjs', 'orchestrate',
    '--event', 'fixtures/events/threat-intel-match.json',
    '--store', store,
  ]);
  const body = await readFile('fixtures/events/slack-approve.json', 'utf8');
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = signSlackRequest(SECRET, ts, body);
  const payloadPath = join(dir, 'click.json');
  await writeFile(payloadPath, body);
  const { stdout } = await run('node', [
    'src/cli.mjs', 'gate',
    '--interaction', payloadPath,
    '--map', 'fixtures/identity/slack-map.json',
    '--signed',
    '--timestamp', ts,
    '--signature', signature,
    '--at', '2026-09-04T12:00:00Z',
    '--store', store,
  ], { env: { ...process.env, SLACK_SIGNING_SECRET: SECRET } });
  assert.match(stdout, /status=consented/);
  assert.match(stdout, /executed=false/);
  await rm(dir, { recursive: true, force: true });
});

test('a valid GitHub HMAC is accepted and still not executed', () => {
  const rawBody = '{"action":"created"}';
  const signature = signGitHubRequest(SECRET, rawBody);
  const r = verifyGitHubRequest({ signingSecret: SECRET, rawBody, signature });
  assert.equal(r.ok, true);
  assert.equal(r.executed, false);
});

test('a missing GitHub webhook secret is a refusal', () => {
  const r = verifyGitHubRequest({
    signingSecret: '',
    rawBody: '{}',
    signature: 'sha256=abc',
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'missing-signing-secret');
});

test('a bad GitHub HMAC is refused', () => {
  const r = verifyGitHubRequest({
    signingSecret: SECRET,
    rawBody: '{"action":"created"}',
    signature: 'sha256=deadbeef',
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'bad-signature');
});

test('a fixture identity map joins a GitHub account id onto per.* and refuses a login key', async () => {
  const map = await readIdentityMap('fixtures/identity/slack-map.json');
  assert.equal(map.github['1000001'], 'per.approver');
  const r = resolveInteractionActor({
    payload: { sender: { id: 1000001, login: 'not-a-person-id' } },
    map,
  });
  assert.equal(r.ok, true);
  assert.equal(r.actor, 'per.approver');
  assert.equal(r.via, 'github');
  assert.throws(
    () => parseIdentityMap({
      _stamp: FIXTURE_STAMP,
      github: { octocat: 'per.approver' },
    }, { path: 'fixtures/identity/bad-gh.json' }),
    /not a github user id/,
  );
});

test('an unmapped GitHub sender is refused rather than inferred from the login', async () => {
  const map = await readIdentityMap('fixtures/identity/slack-map.json');
  const r = resolveInteractionActor({
    payload: { sender: { id: 9999999, login: 'octocat' } },
    map,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'unmapped-github-user');
});

test('CLI --signed-github without a secret is refused', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'grc-inbound-gh-'));
  const store = join(dir, 'gates.json');
  await run('node', [
    'src/cli.mjs', 'orchestrate',
    '--event', 'fixtures/events/threat-intel-match.json',
    '--store', store,
  ]);
  const body = await readFile('fixtures/events/slack-approve.json', 'utf8');
  const signature = signGitHubRequest(SECRET, body);
  await assert.rejects(
    () => run('node', [
      'src/cli.mjs', 'gate',
      '--interaction', 'fixtures/events/slack-approve.json',
      '--map', 'fixtures/identity/slack-map.json',
      '--signed-github',
      '--signature', signature,
      '--store', store,
    ], { env: { ...process.env, GITHUB_WEBHOOK_SECRET: '' } }),
    (err) => {
      assert.equal(err.code, 1);
      assert.match(err.stdout, /GITHUB_WEBHOOK_SECRET is absent|missing-signing-secret|signing secret/);
      return true;
    },
  );
  await rm(dir, { recursive: true, force: true });
});
