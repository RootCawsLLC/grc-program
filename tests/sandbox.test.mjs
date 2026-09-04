import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collect, writeManifest } from '../src/collect.mjs';
import { collectSandbox } from '../src/sandbox.mjs';
import { runAssert } from '../src/assert.mjs';
import { parseCredentialReportCsv, toLandingRow } from '../src/collectors/clients/aws-credential-report.mjs';
import { parseWorkflowUses } from '../src/collectors/parse-workflow-uses.mjs';
import { createGithubFileClient } from '../src/collectors/clients/github-file.mjs';
import { restrictToSandboxRepos, sandboxRepoFilter } from '../src/collectors/clients/github-rest.mjs';
import { collectGithubRepos } from '../src/collectors/github.mjs';
import { collectIdpIdentities } from '../src/collectors/idp.mjs';
import { createIdpFileClient } from '../src/collectors/clients/idp-file.mjs';
import { FIXTURE_STAMP } from '../src/lib/load.mjs';

const tmp = () => mkdtemp(join(tmpdir(), 'sandbox-'));

const OFFICIAL = `user,arn,user_creation_time,password_enabled,password_last_used,password_last_changed,password_next_rotation,mfa_active,access_key_1_active,access_key_1_last_rotated,access_key_1_last_used_date,access_key_1_last_used_region,access_key_1_last_used_service,access_key_2_active,access_key_2_last_rotated,access_key_2_last_used_date,access_key_2_last_used_region,access_key_2_last_used_service,cert_1_active,cert_1_last_rotated,cert_2_active,cert_2_last_rotated
alice,arn:aws:iam::111122223333:user/alice,2025-02-11T00:00:00+00:00,true,N/A,2026-06-01T00:00:00+00:00,N/A,true,false,N/A,N/A,N/A,N/A,false,N/A,N/A,N/A,N/A,false,N/A,false,N/A
<root_account>,arn:aws:iam::111122223333:root,2025-01-04T00:00:00+00:00,not_supported,N/A,N/A,not_supported,true,false,N/A,N/A,N/A,N/A,false,N/A,N/A,N/A,N/A,false,N/A,false,N/A
`;

test('official IAM credential-report CSV parses into landing columns', () => {
  const rows = parseCredentialReportCsv(OFFICIAL, { accountId: '111122223333' });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].user, 'alice');
  assert.equal(rows[0].mfa_active, true);
  assert.equal(rows[0].access_key_1_active, false);
  assert.equal(rows[0].user_creation_time, '2025-02-11T00:00:00Z');
  assert.equal(rows[0].password_last_used, null);
  assert.equal(rows[1].password_enabled, 'not_supported');
  assert.equal(rows[1].user, '<root_account>');

  const landed = toLandingRow(rows[0]);
  assert.equal(landed.user_name, 'alice');
  assert.equal(landed.account_id, '111122223333');
  assert.equal(landed.mfa_active, true);
});

test('a house-format CSV is refused rather than silently remapped', () => {
  assert.throws(
    () => parseCredentialReportCsv('subject_id,passing,reason\nalice,true,\n'),
    /not the official IAM format/,
  );
});

test('workflow uses: refs are parsed, quoted or not', () => {
  const uses = parseWorkflowUses(`
jobs:
  x:
    steps:
      - uses: actions/checkout@v4
      - uses: "aquasecurity/trivy-action@master"
      - uses: aquasecurity/trivy-action@d2a0b60797ff03db6132bd4e2b293f9b37081297
`);
  assert.deepEqual(uses, [
    'actions/checkout@v4',
    'aquasecurity/trivy-action@master',
    'aquasecurity/trivy-action@d2a0b60797ff03db6132bd4e2b293f9b37081297',
  ]);
});

test('sandbox GitHub population is production-topic sandbox-uat-* only', async () => {
  const doc = JSON.parse(await readFile('fixtures/sandbox/github/org.json', 'utf8'));
  assert.equal(doc._stamp, FIXTURE_STAMP);
  const client = restrictToSandboxRepos(createGithubFileClient(doc));
  const { rows } = await collectGithubRepos({ client, org: 'RootCawsLLC' });
  const byId = Object.fromEntries(rows.map((r) => [r.subject_id, r]));

  assert.equal(rows.length, 2, 'scratch (no production topic) must be out of population');
  assert.equal(byId['RootCawsLLC/sandbox-uat-scratch'], undefined);
  assert.equal(byId['RootCawsLLC/sandbox-uat-prod-api'].passing, true);
  assert.equal(byId['RootCawsLLC/sandbox-uat-prod-app'].passing, false);
  assert.match(byId['RootCawsLLC/sandbox-uat-prod-app'].reason, /no_branch_protection/);
  assert.match(byId['RootCawsLLC/sandbox-uat-prod-app'].reason, /unpinned_third_party_actions:1/);
});

test('GitHub REST listRepos uses /users/ when the owner is a User, not /orgs/', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('/users/RootCawsLLC')) {
      return { ok: true, status: 200, json: async () => ({ login: 'RootCawsLLC', type: 'User' }) };
    }
    if (url.includes('/users/RootCawsLLC/repos')) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ name: 'sandbox-uat-prod-api', default_branch: 'main', topics: ['production'], pushed_at: '2026-09-04T00:00:00Z' }],
      };
    }
    return { ok: false, status: 404, text: async () => 'nope', json: async () => ({}) };
  };
  const { createGithubRestClient } = await import('../src/collectors/clients/github-rest.mjs');
  const client = createGithubRestClient({ token: 't', fetchImpl });
  const repos = await client.listRepos('RootCawsLLC');
  assert.equal(repos[0].name, 'sandbox-uat-prod-api');
  assert.ok(calls.some((u) => u.includes('/users/RootCawsLLC/repos')));
  assert.ok(!calls.some((u) => u.includes('/orgs/')));
});

test('sandbox REST filter cannot see a real production repo that leaked into listRepos', () => {
  const filtered = sandboxRepoFilter([
    { name: 'grc-program', topics: ['production'] },
    { name: 'sandbox-uat-prod-api', topics: ['production'] },
  ]);
  assert.deepEqual(filtered.map((r) => r.name), ['sandbox-uat-prod-api']);
});

test('IdP sandbox excludes SERVICE by type, including a human-looking login', async () => {
  const doc = JSON.parse(await readFile('fixtures/sandbox/idp/users.json', 'utf8'));
  const { rows } = await collectIdpIdentities({ client: createIdpFileClient(doc) });
  const ids = rows.map((r) => r.subject_id);
  assert.ok(!ids.includes('00uSANDBOXSVC'), 'type=SERVICE must be excluded even when login looks human');
  assert.ok(!ids.includes('00uSANDBOXINACTIVE'));
  const byId = Object.fromEntries(rows.map((r) => [r.subject_id, r]));
  assert.equal(byId['00uSANDBOXALICE'].passing, true);
  assert.equal(byId['00uSANDBOXBOB'].passing, false);
  assert.equal(byId['00uSANDBOXBOB'].reason, 'no_phishing_resistant_factor');
  assert.equal(byId['00uSANDBOXCAROL'].reason, 'no_factor_enrolled');
  assert.equal(byId['00uSANDBOXDANA'].passing, true);
});

test('--sandbox and --fixture cannot be combined', async () => {
  await assert.rejects(
    () => collect({ fixture: true, sandbox: true }),
    /cannot be combined/,
  );
});

test('live collect still refuses; sandbox is not a fallback', async () => {
  await assert.rejects(() => collect({ fixture: false, env: {} }), /no fallback to fixtures/);
  await assert.rejects(() => collect({ fixture: false, env: {} }), /collect --sandbox/);
  await assert.rejects(
    () => collect({
      fixture: false,
      env: { AWS_ACCESS_KEY_ID: 'a', AWS_SESSION_TOKEN: 'b', IDP_TOKEN: 'c', GH_TOKEN: 'd' },
    }),
    /live collection is not wired/,
  );
});

test('sandbox collect runs collectors against dummy sources without network', async () => {
  const dir = await tmp();
  try {
    const warehousePath = join(dir, 'sandbox.duckdb');
    const outDir = join(dir, 'out');
    const m = await collectSandbox({
      warehousePath,
      outDir,
      env: {},
      githubSource: 'file',
    });
    assert.equal(m.mode, 'sandbox');
    assert.equal(m.fixture, true);
    assert.match(m.note, /NOT REAL EVIDENCE/);
    assert.match(m.note, /not a fallback/);
    assert.equal(m.collectors.aws.source, 'official-csv-fixture');
    assert.equal(m.collectors.github.source, 'file-fixture');
    assert.equal(m.collectors.github.rows, 2);
    assert.equal(m.collectors.idp.rows, 4);
    assert.equal(m.collectors.hris.degraded, true);
    assert.equal(m.collectors.hris.rows, 3);
    assert.ok(m.total_rows > 0);

    const github = JSON.parse(await readFile(m.artifacts.github, 'utf8'));
    assert.equal(github._stamp, FIXTURE_STAMP);

    const manifestPath = join(dir, 'manifest.json');
    await writeManifest(m, manifestPath);
    const asserted = await runAssert({ warehousePath, manifestPath });
    const mfa = asserted.assertions.find((a) => a.control_id === 'ctl.iam.cloud-platform.mfa');
    assert.ok(mfa, 'sandbox warehouse must be assertable');
    assert.equal(mfa.fixture, true);
    assert.equal(mfa.total, 6);
    assert.ok(mfa.failing.some((f) => f.subject_id === '444455556666:erin'));
    assert.ok(!mfa.failing.some((f) => f.subject_id.includes('sandbox-sam')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('github rest without a token is skipped, not silently replaced, when source is rest', async () => {
  const dir = await tmp();
  try {
    const m = await collectSandbox({
      warehousePath: join(dir, 'w.duckdb'),
      outDir: join(dir, 'out'),
      env: {},
      githubSource: 'rest',
    });
    assert.equal(m.collectors.github.status, 'skipped');
    assert.match(m.collectors.github.note, /Not falling back/);
    assert.equal(m.collectors.github.rows, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
