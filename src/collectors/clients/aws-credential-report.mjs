/**
 * IAM credential report — official CSV shape, not a house format.
 *
 * Header and sentinels match the IAM User Guide
 * (iam:GetCredentialReport / GenerateCredentialReport). The same parser is what a live
 * client would run over the decoded `Content` blob. Sandbox UAT therefore exercises the
 * real format rather than a rewritten one.
 *
 * A live GetCredentialReport against a real account is NOT wired here. That call returns
 * every principal in the account; pointing it at the operator's SSO account would land
 * real users into a stamped UAT run.
 */

import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

/** AWS IAM User Guide, "Getting credential reports". Extra trailing columns are ignored. */
export const CREDENTIAL_REPORT_HEADER = [
  'user',
  'arn',
  'user_creation_time',
  'password_enabled',
  'password_last_used',
  'password_last_changed',
  'password_next_rotation',
  'mfa_active',
  'access_key_1_active',
  'access_key_1_last_rotated',
  'access_key_1_last_used_date',
  'access_key_1_last_used_region',
  'access_key_1_last_used_service',
  'access_key_2_active',
  'access_key_2_last_rotated',
  'access_key_2_last_used_date',
  'access_key_2_last_used_region',
  'access_key_2_last_used_service',
  'cert_1_active',
  'cert_1_last_rotated',
  'cert_2_active',
  'cert_2_last_rotated',
];

const BOOL_FIELDS = new Set([
  'mfa_active',
  'access_key_1_active',
  'access_key_2_active',
  'cert_1_active',
  'cert_2_active',
]);

const TIMESTAMP_FIELDS = new Set([
  'user_creation_time',
  'password_last_used',
  'password_last_changed',
  'password_next_rotation',
  'access_key_1_last_rotated',
  'access_key_1_last_used_date',
  'access_key_2_last_rotated',
  'access_key_2_last_used_date',
  'cert_1_last_rotated',
  'cert_2_last_rotated',
]);

const NULL_SENTINELS = new Set(['', 'n/a', 'na', 'not_supported', 'no_information', 'not_applicable']);

export function splitCsvLine(line) {
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseBool(raw) {
  if (/^(true|yes|1)$/i.test(raw)) return true;
  if (/^(false|no|0)$/i.test(raw)) return false;
  throw new Error(`credential report: not a boolean: ${JSON.stringify(raw)}`);
}

function parseTimestamp(raw) {
  const v = String(raw ?? '').trim();
  if (NULL_SENTINELS.has(v.toLowerCase())) return null;
  // AWS emits +00:00; landing / DuckDB want Z.
  const normalised = v.replace(/\+00:00$/, 'Z').replace(/Z$/, 'Z');
  if (!/^\d{4}-\d{2}-\d{2}T/.test(normalised)) {
    throw new Error(`credential report: not a timestamp: ${JSON.stringify(raw)}`);
  }
  return normalised.endsWith('Z') ? normalised : `${normalised}Z`;
}

/**
 * Parse one official credential-report CSV. `user` stays `user` — that is the collector's field.
 * `password_enabled` stays the AWS tri-state string.
 */
export function parseCredentialReportCsv(text, { accountId } = {}) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('credential report is empty');

  const header = splitCsvLine(lines[0]).map((c) => c.trim());
  if (header[0] !== 'user' || !header.includes('mfa_active') || !header.includes('arn')) {
    throw new Error(
      'credential report header is not the official IAM format ' +
      '(expected columns starting with user, arn, …, mfa_active). ' +
      'Refusing a house-format CSV: the live path has to parse the same bytes.',
    );
  }

  const rows = [];
  for (const line of lines.slice(1)) {
    const values = splitCsvLine(line);
    const rec = {};
    for (let i = 0; i < header.length; i++) {
      const col = header[i];
      const raw = (values[i] ?? '').trim();
      if (BOOL_FIELDS.has(col)) rec[col] = parseBool(raw);
      else if (TIMESTAMP_FIELDS.has(col)) rec[col] = parseTimestamp(raw);
      else if (col === 'password_enabled') rec[col] = raw.toLowerCase();
      else rec[col] = raw;
    }
    if (accountId) rec.account_id = accountId;
    rows.push(rec);
  }
  return rows;
}

/** Map a parsed report row onto the landing_aws_credential_report columns (minus as_of). */
export function toLandingRow(row, accountId = row.account_id) {
  if (!accountId) throw new Error('credential report row has no account_id');
  return {
    account_id: accountId,
    user_name: row.user,
    arn: row.arn,
    user_creation_time: row.user_creation_time,
    password_enabled: row.password_enabled,
    password_last_changed: row.password_last_changed,
    mfa_active: row.mfa_active,
    access_key_1_active: row.access_key_1_active,
    access_key_2_active: row.access_key_2_active,
    access_key_1_last_rotated: row.access_key_1_last_rotated,
    access_key_2_last_rotated: row.access_key_2_last_rotated,
  };
}

const ACCOUNT_FILE = /^(\d{12})\.csv$/;

/** File client: one official CSV per account, named {account_id}.csv. */
export function createAwsCsvClient(reports) {
  const byAccount = new Map(Object.entries(reports));
  return {
    async getCredentialReport(account) {
      const rows = byAccount.get(account);
      if (!rows) throw new Error(`no credential report for account ${account}`);
      return rows;
    },
  };
}

export async function loadSandboxAwsReports(dir) {
  const files = (await readdir(dir)).filter((f) => ACCOUNT_FILE.test(f)).sort();
  if (!files.length) throw new Error(`no official credential-report CSVs (12-digit account_id.csv) in ${dir}`);

  const reports = {};
  for (const file of files) {
    const accountId = ACCOUNT_FILE.exec(file)[1];
    const text = await readFile(join(dir, file), 'utf8');
    reports[accountId] = parseCredentialReportCsv(text, { accountId });
  }
  return reports;
}

export function accountIdFromCsvName(file) {
  const m = ACCOUNT_FILE.exec(basename(file));
  return m ? m[1] : null;
}
