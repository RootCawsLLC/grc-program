/**
 * The local warehouse: DuckDB, plus exactly enough dbt templating to run the same model files.
 *
 * WHY NOT dbt ITSELF. dbt is Python. Requiring it makes a new analyst's first task "get a working
 * Python toolchain past endpoint controls", which is where an initiative like this quietly dies.
 * On the machine this was written on there is no Python at all - `python` is a Microsoft Store
 * stub - so dbt was never a choice that was on the table. DuckDB is a prebuilt native module and
 * `npm install` is the whole setup.
 *
 * The models in models/ stay GENUINE dbt models: same files, same `ref()`, `source()`, `var()`,
 * `config()` and `is_incremental()`. Moving to real dbt against a real warehouse later is a
 * profile and a dialect pass, not a rewrite. This runner resolves the handful of constructs the
 * project actually uses and nothing else, so an unsupported expression fails loudly rather than
 * rendering into something surprising.
 *
 * SQL CONSTRUCTION. Every value crossing into SQL goes through a bound parameter, never string
 * interpolation - see insertRows(). Today the rows come from fixture JSON; tomorrow they come from
 * the AWS credential report, and an IAM user name is attacker-influencable in exactly the way that
 * makes string-built SQL a vulnerability. Identifiers (table and column names) cannot be bound, so
 * they are restricted to an allowlist drawn from src/lib/tables.mjs and checked by
 * assertIdentifier() below.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { TABLES, SNAPSHOT_TABLE, SNAPSHOT_COLUMNS } from './lib/tables.mjs';

/** Build order. Staging depends on landing, controls on staging, variance on the snapshot. */
export const LAYERS = ['staging', 'controls', 'intermediate', 'variance'];

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** ISO-8601 UTC, with or without fractional seconds. Nothing else may be interpolated into SQL. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

/**
 * Identifiers cannot be parameterized in SQL, so they are allowlisted instead. Every caller passes
 * a name that came from tables.mjs or from a .sql filename; this refuses anything else rather than
 * trusting that to stay true.
 */
function assertIdentifier(name, what = 'identifier') {
  if (typeof name !== 'string' || !IDENTIFIER.test(name)) {
    throw new Error(`unsafe ${what}: ${JSON.stringify(name)} - must match ${IDENTIFIER}`);
  }
  return name;
}

const TYPES = new Set(['TIMESTAMP', 'VARCHAR', 'BOOLEAN', 'INTEGER', 'BIGINT', 'DOUBLE', 'DATE']);
function assertType(t) {
  if (!TYPES.has(t)) throw new Error(`unsupported column type ${t}`);
  return t;
}

export class Warehouse {
  constructor(conn, instance) {
    this.conn = conn;
    this.instance = instance;
  }

  static async open(path = ':memory:') {
    const instance = await DuckDBInstance.create(path);
    return new Warehouse(await instance.connect(), instance);
  }

  async run(sql, params) {
    try {
      return params ? await this.conn.run(sql, params) : await this.conn.run(sql);
    } catch (err) {
      throw new Error(`${err.message}\n--- sql ---\n${sql}`);
    }
  }

  async all(sql, params) {
    try {
      const result = params
        ? await this.conn.runAndReadAll(sql, params)
        : await this.conn.runAndReadAll(sql);
      return result.getRowObjects().map(normaliseRow);
    } catch (err) {
      throw new Error(`${err.message}\n--- sql ---\n${sql}`);
    }
  }

  /**
   * Closes the connection AND the instance.
   *
   * Closing only the connection leaves the instance holding the database file. On a `:memory:`
   * warehouse nothing notices; on a file-backed one — which `collect` needs, because `assert` runs
   * in a separate process — Windows keeps the file locked and the next open fails with
   * "The process cannot access the file because it is being used by another process."
   *
   * Found when a second `collect` in the same process could not reopen its own warehouse. It went
   * unnoticed for as long as every caller used `:memory:`.
   */
  async close() {
    this.conn.closeSync();
    this.instance?.closeSync?.();
  }

  /** Creates every landing table declared in tables.mjs, plus the snapshot table. Empty. */
  async createTables() {
    for (const [table, def] of Object.entries(TABLES)) {
      assertIdentifier(table, 'table name');
      const cols = Object.entries(def.columns)
        .map(([c, t]) => `"${assertIdentifier(c, 'column name')}" ${assertType(t)}`)
        .join(', ');
      await this.run(`create table if not exists ${table} (${cols})`);
    }
    const snapshot = Object.entries(SNAPSHOT_COLUMNS)
      .map(([c, t]) => `"${assertIdentifier(c, 'column name')}" ${assertType(t)}`)
      .join(', ');
    await this.run(`create table if not exists ${SNAPSHOT_TABLE} (${snapshot})`);
  }

  /**
   * Lands one collection cycle. Idempotent per as_of and APPEND-ONLY across as_of values: it
   * clears only the cycle being re-loaded, so re-running the demo is deterministic while history
   * from every other cycle survives. Deleting the whole table here would be the single change
   * that turns this pipeline back into a dashboard.
   */
  async loadCycle(table, asOf, rows) {
    if (!TABLES[table]) throw new Error(`unknown landing table ${table}`);
    assertIdentifier(table, 'table name');
    await this.run(`delete from ${table} where as_of = ?`, [asOf]);
    const columns = Object.keys(TABLES[table].columns);
    return this.insertRows(table, columns, rows.map((r) => ({ ...r, as_of: asOf })));
  }

  /** Bound-parameter insert. The only path by which data reaches a table. */
  async insertRows(table, columns, rows) {
    if (rows.length === 0) return 0;
    assertIdentifier(table, 'table name');
    const cols = columns.map((c) => assertIdentifier(c, 'column name'));
    const quoted = cols.map((c) => `"${c}"`).join(', ');
    const placeholders = cols.map(() => '?').join(', ');

    // One statement per row keeps the parameter list short and points a failure at the offending
    // row. These are fixture-sized populations; a COPY would only matter at a million rows.
    for (const row of rows) {
      await this.run(
        `insert into ${table} (${quoted}) values (${placeholders})`,
        cols.map((c) => (row[c] === undefined ? null : row[c])),
      );
    }
    return rows.length;
  }

  /** Builds every .sql model in one layer as a view, for a given as_of. */
  async buildLayer(layer, { asOf, root = '.' }) {
    const dir = join(root, 'models', layer);
    if (!existsSync(dir)) return [];
    const built = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      const name = assertIdentifier(file.replace(/\.sql$/, ''), 'model name');
      const sql = render(readFileSync(join(dir, file), 'utf8'), { asOf });
      await this.run(`create or replace view ${name} as\n${sql}`);
      built.push(`${layer}/${name}`);
    }
    return built;
  }

  /**
   * Runs the control models for one cycle and appends their rows to the snapshot table.
   *
   * This is the step dbt would call a snapshot, and it is what gives variance_events.sql more than
   * one row per subject to compare. Without it each cycle would overwrite the last and the
   * transition into variance - the thing the entire risk layer is derived from - would never be
   * visible at all.
   */
  async snapshotControls(modelNames, { asOf }) {
    let written = 0;
    for (const name of modelNames) {
      assertIdentifier(name, 'model name');
      await this.run(
        `delete from ${SNAPSHOT_TABLE}
          where as_of = ? and control_id in (select distinct control_id from ${name})`,
        [asOf],
      );
      await this.run(
        `insert into ${SNAPSHOT_TABLE}
           (as_of, control_id, subject_id, passing, reason, first_observed, account_id)
         select as_of, control_id, subject_id, passing, reason, first_observed, account_id
         from ${name}`,
      );
      const [{ n }] = await this.all(`select count(*) as n from ${name}`);
      written += Number(n);
    }
    return written;
  }
}

/** DuckDB returns BIGINT as a JS BigInt and TIMESTAMP as an object. Neither survives JSON. */
function normaliseRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'bigint') out[key] = Number(value);
    else if (value !== null && typeof value === 'object' && !(value instanceof Date)) out[key] = String(value);
    else out[key] = value;
  }
  return out;
}

/**
 * Resolves the dbt constructs this project uses. Deliberately narrow - this is not a Jinja engine
 * and does not pretend to be.
 *
 *   source('a','b')  -> landing_a_b   the tables declared in tables.mjs
 *   ref('model')     -> model         views built by buildLayer
 *   var('as_of')     -> the run's as_of, passed in and NEVER read from the clock in here: the
 *                       runner's wall clock is not an evidence timestamp
 *   config(...)      -> dropped. Materialisation is this runner's decision, not the model's.
 *   is_incremental() -> false, and the guarded block is dropped with it. Every cycle is built
 *                       fresh and appended by snapshotControls(), so the incremental guard would
 *                       filter out precisely the rows the snapshot needs.
 */
export function render(sql, { asOf }) {
  if (!asOf) {
    throw new Error('render requires an as_of - a model rendered against the wall clock is not evidence');
  }
  // as_of is the ONE value in this file that reaches SQL by interpolation rather than as a bound
  // parameter, because it is substituted into the model text before the statement is prepared and
  // a placeholder cannot survive that. It therefore has to be validated instead. Today it comes
  // from a fixture file in this repo; tomorrow it comes from a scheduler or a config, and
  // `2026-01-01'; drop table control_assertions; --` would otherwise be a working exploit against
  // the system of record.
  if (!ISO_TIMESTAMP.test(asOf)) {
    throw new Error(`as_of must be an ISO-8601 UTC timestamp, got ${JSON.stringify(asOf)}`);
  }
  let out = sql;

  out = out.replace(/\{\{\s*config\([\s\S]*?\)\s*\}\}/g, '');
  out = out.replace(/\{%\s*if\s+is_incremental\(\)\s*%\}[\s\S]*?\{%\s*endif\s*%\}/g, '');
  out = out.replace(/\{\{\s*source\(\s*['"]([\w-]+)['"]\s*,\s*['"]([\w-]+)['"]\s*\)\s*\}\}/g, (_m, a, b) => `landing_${a}_${b}`);
  out = out.replace(/\{\{\s*ref\(\s*['"]([\w-]+)['"]\s*\)\s*\}\}/g, (_m, a) => a);
  out = out.replace(/\{\{\s*var\(\s*["']as_of["']\s*\)\s*\}\}/g, () => asOf);

  const leftover = out.match(/\{\{[^}]*\}\}|\{%[^%]*%\}/);
  if (leftover) {
    throw new Error(
      `unsupported dbt expression: ${leftover[0]}\n` +
      'The local runner resolves ref(), source(), var("as_of"), config() and is_incremental(). ' +
      'Anything richer needs real dbt - which these models remain compatible with.',
    );
  }
  return out;
}
