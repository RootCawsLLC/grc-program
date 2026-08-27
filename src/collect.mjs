/**
 * `collect` — land full source-system state, time-indexed, into the warehouse.
 *
 * THE RULE THAT SHAPES EVERY DECISION HERE: an empty collection must never look like a successful
 * one. A collector that authenticates fine and legitimately finds nothing, and a collector whose
 * token silently expired, both return zero rows. Downstream those are indistinguishable — and a
 * zero-row population makes every control's pass rate 0/0, which renders as "nothing failing".
 * That is the single most dangerous artifact this pipeline could produce, so a zero-row collection
 * is refused unless somebody says in writing that empty is the expected answer.
 *
 * TWO SOURCES, AND THE CHOICE IS ALWAYS EXPLICIT.
 *
 *   --fixture   reads fixtures/landing/*.json — stamped NOT REAL EVIDENCE, no credentials, no
 *               network. Everything it lands is marked fixture-derived and stays marked.
 *   (default)   live collection, which REFUSES without credentials rather than falling back.
 *
 * There is deliberately no automatic fallback from live to fixture. A scheduled run that quietly
 * collected fixtures when its credentials lapsed would go green having measured nothing, and the
 * first real failure would look exactly like the thirty fake successes before it.
 */

import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

import { Warehouse } from './warehouse.mjs';
import { TABLES } from './lib/tables.mjs';
import { FIXTURE_STAMP } from './lib/load.mjs';
import { COLLECTORS } from './collectors/registry.mjs';

export const DEFAULT_WAREHOUSE = '.warehouse/ccm.duckdb';

/** Credentials each live collector needs. Absent means it cannot run — not that it runs degraded. */
export const LIVE_CREDENTIALS = {
  aws: ['AWS_ACCESS_KEY_ID', 'AWS_SESSION_TOKEN'],   // set by configure-aws-credentials via OIDC
  idp: ['IDP_TOKEN'],
  github: ['GH_TOKEN'],
};

const present = (name, env) => typeof env[name] === 'string' && env[name].trim() !== '';

/**
 * Which live collectors can actually run. Reported, never silently skipped — a collector that did
 * not run leaves a control unmeasured, and unmeasured is not passing.
 */
export function liveReadiness(env = process.env) {
  return Object.entries(LIVE_CREDENTIALS).map(([name, vars]) => ({
    collector: name,
    missing: vars.filter((v) => !present(v, env)),
    ready: vars.every((v) => present(v, env)),
  }));
}

/** Reads the stamped fixture cycles. Refuses an unstamped file — see src/pipeline.mjs for why. */
export async function readFixtureCycles(dir = 'fixtures/landing') {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) throw new Error(`no fixture cycles in ${dir}`);

  const cycles = [];
  for (const file of files) {
    const cycle = JSON.parse(await readFile(join(dir, file), 'utf8'));
    if (cycle._stamp !== FIXTURE_STAMP) {
      throw new Error(
        `${file} is missing the "${FIXTURE_STAMP}" stamp. Refusing: an unstamped fixture becomes ` +
        'indistinguishable from real evidence the moment its rows are in a table.',
      );
    }
    cycles.push({ file, ...cycle });
  }
  return cycles;
}

/**
 * Lands one collection run.
 *
 * `allowEmpty` exists so "we checked and there genuinely is nothing" can be recorded — but it has
 * to be said out loud, per run, rather than being the default that hides a broken token.
 */
export async function collect({
  fixture = false,
  warehousePath = DEFAULT_WAREHOUSE,
  fixtureDir = 'fixtures/landing',
  allowEmpty = false,
  env = process.env,
  asOf = null,
} = {}) {
  if (!fixture) {
    const readiness = liveReadiness(env);
    const blocked = readiness.filter((r) => !r.ready);
    if (blocked.length) {
      throw new Error(
        `refusing to collect: ${blocked.length} of ${readiness.length} collectors have no credentials.\n` +
        blocked.map((b) => `    ${b.collector}: missing ${b.missing.join(', ')}`).join('\n') +
        '\n\n  There is no fallback to fixtures. A scheduled run that quietly collected synthetic\n' +
        '  data when its credentials lapsed would go green having measured nothing, and the first\n' +
        '  real failure would look identical to every fake success before it.\n' +
        '\n  For a credential-free run against stamped fixtures, ask for it: `collect --fixture`.',
      );
    }
    // Live collection is reachable only with credentials, and the collectors have never been
    // pointed at a live tenant (BUILD-ORDER B2/B5). Say that rather than pretending.
    throw new Error(
      'refusing to collect: live collection is not wired.\n' +
      `  Credentials are present for: ${readiness.filter((r) => r.ready).map((r) => r.collector).join(', ')}\n` +
      '  but the collectors in src/collectors/ take an INJECTED client and no live client is\n' +
      '  constructed anywhere — see BUILD-ORDER B2 (AWS, blocked on the OIDC role) and B5 (the IdP\n' +
      '  is still the placeholder <IdP>).\n' +
      '\n  This refusal is the honest state. Wiring a client that has never authenticated once, on\n' +
      '  the strength of the credentials existing, is how a pipeline reports a population it never\n' +
      '  actually read.',
    );
  }

  const cycles = await readFixtureCycles(fixtureDir);
  const selected = asOf ? cycles.filter((c) => c.as_of === asOf) : cycles;
  if (asOf && !selected.length) {
    throw new Error(`no fixture cycle with as_of ${asOf}. Available: ${cycles.map((c) => c.as_of).join(', ')}`);
  }

  await mkdir(dirname(warehousePath), { recursive: true });
  const warehouse = await Warehouse.open(warehousePath);
  await warehouse.createTables();

  const landed = [];
  let totalRows = 0;
  for (const cycle of selected) {
    let rows = 0;
    for (const [table, tableRows] of Object.entries(cycle.tables)) {
      if (!TABLES[table]) throw new Error(`${cycle.file} names unknown landing table ${table}`);
      rows += await warehouse.loadCycle(table, cycle.as_of, tableRows);
    }
    landed.push({ as_of: cycle.as_of, source: cycle.file, rows });
    totalRows += rows;
  }

  if (totalRows === 0 && !allowEmpty) {
    await warehouse.close();
    throw new Error(
      'refusing to record a zero-row collection.\n' +
      '  A collector that legitimately found nothing and one whose token silently expired both\n' +
      '  return zero rows, and downstream they are indistinguishable: every control becomes 0/0,\n' +
      '  which renders as "nothing failing".\n' +
      '\n  If empty is genuinely the expected answer, say so: --allow-empty.',
    );
  }

  const manifest = {
    schema: 'grc-program.collection/v1',
    run_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    mode: 'fixture',
    fixture: true,                       // the stamp, carried into everything derived from this run
    warehouse: warehousePath,
    cycles: landed,
    total_rows: totalRows,
    note: `${FIXTURE_STAMP}. Landed from stamped fixtures; no system was contacted.`,
  };
  await warehouse.close();
  return manifest;
}

export async function writeManifest(manifest, path = '.warehouse/last-collection.json') {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return path;
}

export const collectorNames = () => Object.keys(COLLECTORS);
