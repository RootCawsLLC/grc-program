/**
 * `collect --sandbox` — UAT against dummy sources. A third mode, never a fallback.
 *
 *   --fixture   pre-landed JSON cycles. No collector runs.
 *   --sandbox   collectors run against dummy systems (official IAM CSV, GitHub sandbox-uat-*
 *               repos, file IdP, HRIS inbox CSV). Everything is stamped.
 *   (default)   live, which still refuses: credentials are not a live client.
 *
 * Sandbox is not live-with-fixtures. A scheduled run that lost its credentials must still
 * refuse rather than quietly measuring these dummy sources.
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { Warehouse } from './warehouse.mjs';
import { FIXTURE_STAMP } from './lib/load.mjs';
import { collectAwsIamPrincipals } from './collectors/aws-iam.mjs';
import { collectGithubRepos } from './collectors/github.mjs';
import { collectIdpIdentities } from './collectors/idp.mjs';
import { collectCsvInbox } from './collectors/csv-inbox.mjs';
import {
  createAwsCsvClient,
  loadSandboxAwsReports,
  toLandingRow,
} from './collectors/clients/aws-credential-report.mjs';
import { createGithubFileClient } from './collectors/clients/github-file.mjs';
import { createGithubRestClient, restrictToSandboxRepos } from './collectors/clients/github-rest.mjs';
import { createIdpFileClient } from './collectors/clients/idp-file.mjs';

export const DEFAULT_SANDBOX_WAREHOUSE = '.warehouse/sandbox.duckdb';
export const DEFAULT_SANDBOX_DIR = 'fixtures/sandbox';
export const DEFAULT_SANDBOX_OUT = '.warehouse/sandbox';
export const SANDBOX_AS_OF = '2026-09-04T00:00:00Z';
export const SANDBOX_GITHUB_ORG = 'RootCawsLLC';
export const SANDBOX_GITHUB_PREFIX = 'sandbox-uat-';

const present = (name, env) => typeof env[name] === 'string' && env[name].trim() !== '';

async function readStampedJson(path) {
  const doc = JSON.parse(await readFile(path, 'utf8'));
  if (doc._stamp !== FIXTURE_STAMP) {
    throw new Error(
      `${path} is missing the "${FIXTURE_STAMP}" stamp. Refusing: an unstamped sandbox ` +
      'file becomes indistinguishable from real evidence the moment a collector reads it.',
    );
  }
  return doc;
}

function githubToken(env) {
  if (present('GH_TOKEN', env)) return env.GH_TOKEN.trim();
  if (present('GITHUB_TOKEN', env)) return env.GITHUB_TOKEN.trim();
  return '';
}

async function resolveGithubClient({ sandboxDir, env, githubClient, githubSource }) {
  if (githubClient) {
    return { client: githubClient, source: 'injected', status: 'ok' };
  }

  const mode = githubSource ?? 'auto';
  const token = githubToken(env);
  const filePath = join(sandboxDir, 'github', 'org.json');

  if (mode === 'file' || (mode === 'auto' && !token)) {
    const doc = await readStampedJson(filePath);
    return {
      client: restrictToSandboxRepos(createGithubFileClient(doc), { prefix: SANDBOX_GITHUB_PREFIX }),
      source: 'file-fixture',
      status: 'ok',
      note: token ? 'forced file client' : 'no GH_TOKEN; file fixture. Dummy GitHub repos were not contacted.',
    };
  }

  if (mode === 'rest' && !token) {
    return {
      client: null,
      source: 'rest',
      status: 'skipped',
      note: 'github source is rest but GH_TOKEN is absent. Not falling back to the file fixture.',
    };
  }

  return {
    client: restrictToSandboxRepos(createGithubRestClient({ token }), { prefix: SANDBOX_GITHUB_PREFIX }),
    source: 'github-rest',
    status: 'ok',
    note: `REST against ${SANDBOX_GITHUB_ORG}/${SANDBOX_GITHUB_PREFIX}* only. Real production repos are out of scope.`,
  };
}

export async function collectSandbox({
  sandboxDir = DEFAULT_SANDBOX_DIR,
  warehousePath = DEFAULT_SANDBOX_WAREHOUSE,
  outDir = DEFAULT_SANDBOX_OUT,
  env = process.env,
  asOf = SANDBOX_AS_OF,
  allowEmpty = false,
  githubClient = null,
  githubSource = 'auto',
} = {}) {
  const awsDir = join(sandboxDir, 'aws');
  const reports = await loadSandboxAwsReports(awsDir);
  const orgDoc = await readStampedJson(join(awsDir, 'org-accounts.json'));
  const ticketDoc = await readStampedJson(join(awsDir, 'tickets.json'));
  const idpDoc = await readStampedJson(join(sandboxDir, 'idp', 'users.json'));

  const accounts = Object.keys(reports).sort();
  const awsClient = createAwsCsvClient(reports);
  const awsIam = await collectAwsIamPrincipals({ client: awsClient, accounts });

  const landingCredential = accounts.flatMap((accountId) =>
    reports[accountId].map((row) => toLandingRow(row, accountId)),
  );
  const landingAccounts = orgDoc.accounts ?? [];
  const landingTickets = ticketDoc.tickets ?? [];
  const awsRows = landingCredential.length + landingAccounts.length + landingTickets.length;

  const github = await resolveGithubClient({ sandboxDir, env, githubClient, githubSource });
  let githubResult = { rows: [], degraded: false };
  if (github.status === 'ok') {
    githubResult = await collectGithubRepos({
      client: github.client,
      org: github.org ?? SANDBOX_GITHUB_ORG,
    });
  }

  const idpResult = await collectIdpIdentities({ client: createIdpFileClient(idpDoc) });
  const hrisResult = await collectCsvInbox({ inboxDir: sandboxDir, source: 'hris' });

  await mkdir(dirname(warehousePath), { recursive: true });
  const warehouse = await Warehouse.open(warehousePath);
  await warehouse.createTables();

  let totalRows = 0;
  totalRows += await warehouse.loadCycle('landing_aws_credential_report', asOf, landingCredential);
  totalRows += await warehouse.loadCycle('landing_aws_org_accounts', asOf, landingAccounts);
  totalRows += await warehouse.loadCycle('landing_ticket_first_touch', asOf, landingTickets);
  await warehouse.close();

  if (totalRows === 0 && !allowEmpty) {
    throw new Error(
      'refusing to record a zero-row sandbox collection.\n' +
      '  Dummy sources that yield nothing and a path that pointed at the wrong directory both\n' +
      '  return zero rows. Say --allow-empty if empty is the expected answer.',
    );
  }

  await mkdir(outDir, { recursive: true });
  const collectors = {
    aws: {
      status: 'ok',
      source: 'official-csv-fixture',
      rows: awsIam.rows.length,
      landed: awsRows,
      confidence_tier: awsIam.confidence_tier,
      note:
        'Official IAM credential-report CSV, same columns as iam:GetCredentialReport. ' +
        'A live report against the operator SSO account is refused: that call returns every ' +
        'principal in the account and would mix real users into this stamped run.',
    },
    github: {
      status: github.status,
      source: github.source,
      rows: githubResult.rows.length,
      confidence_tier: githubResult.confidence_tier ?? null,
      note: github.note ?? null,
      degraded: Boolean(githubResult.degraded),
    },
    idp: {
      status: 'ok',
      source: 'file-fixture',
      rows: idpResult.rows.length,
      confidence_tier: idpResult.confidence_tier,
      note: 'Collector-contract JSON inspired by Okta Users + Factors. Not a live IdP tenant.',
    },
    hris: {
      status: 'ok',
      source: 'csv-inbox',
      rows: hrisResult.rows.length,
      confidence_tier: hrisResult.confidence_tier,
      degraded: true,
      degraded_reason: hrisResult.degraded_reason,
      note: 'HRIS has no API collector. csv-inbox is the documented fallback and is marked degraded.',
    },
  };

  const artifacts = {
    aws: join(outDir, 'aws-iam.json'),
    github: join(outDir, 'github.json'),
    idp: join(outDir, 'idp.json'),
    hris: join(outDir, 'hris.json'),
  };
  await writeFile(artifacts.aws, `${JSON.stringify({ _stamp: FIXTURE_STAMP, ...awsIam }, null, 2)}\n`);
  await writeFile(artifacts.github, `${JSON.stringify({ _stamp: FIXTURE_STAMP, ...githubResult }, null, 2)}\n`);
  await writeFile(artifacts.idp, `${JSON.stringify({ _stamp: FIXTURE_STAMP, ...idpResult }, null, 2)}\n`);
  await writeFile(artifacts.hris, `${JSON.stringify({ _stamp: FIXTURE_STAMP, ...hrisResult }, null, 2)}\n`);

  return {
    schema: 'grc-program.collection/v1',
    run_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    mode: 'sandbox',
    fixture: true,
    warehouse: warehousePath,
    cycles: [{ as_of: asOf, source: `${sandboxDir}/aws/*.csv`, rows: totalRows }],
    total_rows: totalRows,
    collectors,
    artifacts,
    note:
      `${FIXTURE_STAMP}. Sandbox collectors ran against dummy sources. ` +
      'This is not a measurement of a live tenant and is not a fallback from live collect.',
  };
}
