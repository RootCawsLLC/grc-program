/**
 * The landing layer: one table per source-system call, typed and time-indexed.
 *
 * TWO RULES GOVERN THIS FILE.
 *
 * 1. Landing mirrors the SOURCE, not the control. Columns are named after what the API returns,
 *    warts included (`password_enabled` is a three-valued string in the IAM credential report, not
 *    a boolean, because AWS emits `not_supported` for the root account). Deriving anything here
 *    would put control logic in the landing layer, where nobody would look for it. Staging is
 *    where the shape becomes ours.
 *
 * 2. EVERY table carries `as_of`, and rows are never overwritten across cycles. This is the whole
 *    reason the risk layer exists: a landing table that overwrites can answer "what is true now"
 *    but not "what was true on 14 March", and Variance Duration is unreachable without the second
 *    question. A pipeline that overwrites is a dashboard with extra steps.
 *
 * The collectors in src/collectors/ produce these shapes, so swapping fixtures for live credentials
 * is a configuration change rather than a rewrite. That is the claim B22 exists to make true.
 */

export const TABLES = {
  // iam:GetCredentialReport, per account. The single best first collector in an AWS estate:
  // unambiguous denominator, one call, and it carries native rotation timestamps.
  landing_aws_credential_report: {
    source: 'aws',
    scope: 'iam:GetCredentialReport',
    columns: {
      as_of: 'TIMESTAMP',
      account_id: 'VARCHAR',
      user_name: 'VARCHAR',
      arn: 'VARCHAR',
      user_creation_time: 'TIMESTAMP',
      password_enabled: 'VARCHAR',        // 'true' | 'false' | 'not_supported' — AWS's own tri-state
      password_last_changed: 'TIMESTAMP',
      mfa_active: 'BOOLEAN',
      access_key_1_active: 'BOOLEAN',
      access_key_2_active: 'BOOLEAN',
      access_key_1_last_rotated: 'TIMESTAMP',
      access_key_2_last_rotated: 'TIMESTAMP',
    },
  },

  // organizations:ListAccounts. Without this the control cannot say which accounts are in the
  // production organisation, and "production only" would be a comment rather than a predicate.
  landing_aws_org_accounts: {
    source: 'aws',
    scope: 'organizations:ListAccounts',
    columns: {
      as_of: 'TIMESTAMP',
      account_id: 'VARCHAR',
      account_name: 'VARCHAR',
      account_status: 'VARCHAR',          // ACTIVE | SUSPENDED
      is_production_org: 'BOOLEAN',
    },
  },

  // The ticketing system. This is the table that keeps the middle variance segment from collapsing:
  // without a first-touch timestamp, prioritisation failures hide inside implementation failures
  // and "remediate faster" gets aimed at the wrong team.
  landing_ticket_first_touch: {
    source: 'ticketing',
    scope: 'issues:read',
    columns: {
      as_of: 'TIMESTAMP',
      control_id: 'VARCHAR',
      subject_id: 'VARCHAR',
      ticket_id: 'VARCHAR',
      first_touched_at: 'TIMESTAMP',
    },
  },
};

/**
 * Where control model output accumulates. Not a landing table — it is the snapshot layer, written
 * once per collection cycle from the control models themselves.
 *
 * dbt would call this a snapshot. It is the reason `control_assertions_unioned` has more than one
 * row per subject, and therefore the reason variance_events.sql can see a transition at all.
 */
export const SNAPSHOT_TABLE = 'control_assertions';

export const SNAPSHOT_COLUMNS = {
  as_of: 'TIMESTAMP',
  control_id: 'VARCHAR',
  subject_id: 'VARCHAR',
  passing: 'BOOLEAN',
  reason: 'VARCHAR',
  first_observed: 'TIMESTAMP',
  account_id: 'VARCHAR',
};

export const columnNames = (table) => Object.keys(TABLES[table].columns);
