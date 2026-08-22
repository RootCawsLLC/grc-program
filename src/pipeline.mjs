/**
 * The synthetic pipeline, end to end: fixture rows -> staging -> control model -> assertion record
 * -> variance.
 *
 * This lives here rather than in scripts/demo.mjs so that the tests exercise the same code the demo
 * runs. A demo whose logic is duplicated in its test suite is a demo that can pass its tests while
 * being broken, which is the failure mode this repo exists to argue against.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { Warehouse } from './warehouse.mjs';
import { buildAssertion, denominatorDrift } from './lib/assertion.mjs';
import { loadYamlDir } from './validate.mjs';
import { FIXTURE_STAMP } from './lib/load.mjs';

export const CONTROL_MODEL = 'ctl_iam_cloud_platform_mfa';
export const CONTROL_ID = 'ctl.iam.cloud-platform.mfa';

/** DuckDB stringifies timestamps without a zone; every record in this repo is UTC. */
export const isoish = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(' ', 'T');
  return s.endsWith('Z') ? s : `${s}Z`;
};

/**
 * Reads every fixture cycle, newest last.
 *
 * REFUSES an unstamped file. A fixture without the stamp is indistinguishable from real evidence
 * once its rows are in a table, and the whole point of the stamp is that it travels — so the one
 * place it must not be optional is the door.
 */
export async function loadCycles(fixtureDir = 'fixtures/landing') {
  const files = (await readdir(fixtureDir)).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) throw new Error(`no fixture cycles in ${fixtureDir}`);

  const cycles = [];
  for (const file of files) {
    const cycle = JSON.parse(await readFile(join(fixtureDir, file), 'utf8'));
    if (cycle._stamp !== FIXTURE_STAMP) {
      throw new Error(
        `${file} is missing the "${FIXTURE_STAMP}" stamp. Refusing to load it: an unstamped ` +
        'fixture becomes indistinguishable from real evidence the moment its rows are in a table.',
      );
    }
    if (!cycle.as_of) throw new Error(`${file} has no as_of`);
    cycles.push({ file, ...cycle });
  }
  return cycles;
}

/**
 * Runs the whole synthetic pipeline against an open warehouse and returns what it produced.
 *
 * `fixture: true` is set on every assertion record, which is what carries the stamp into the OSCAL
 * package downstream. It is a declared field in schemas/assertion.schema.json precisely so it can
 * be set here — that schema sets additionalProperties:false.
 */
export async function runPipeline({ fixtureDir = 'fixtures/landing', root = '.' } = {}) {
  const warehouse = await Warehouse.open(':memory:');
  await warehouse.createTables();

  const cycles = await loadCycles(fixtureDir);
  const controls = await loadYamlDir(join(root, 'controls'));
  const control = controls.find((c) => c.control_id === CONTROL_ID);
  if (!control) throw new Error(`${CONTROL_ID} is not in controls/`);

  const landed = [];
  const assertions = [];

  for (const cycle of cycles) {
    let rows = 0;
    for (const [table, tableRows] of Object.entries(cycle.tables)) {
      rows += await warehouse.loadCycle(table, cycle.as_of, tableRows);
    }
    landed.push({ as_of: cycle.as_of, rows });

    await warehouse.buildLayer('staging', { asOf: cycle.as_of, root });
    await warehouse.buildLayer('controls', { asOf: cycle.as_of, root });
    await warehouse.snapshotControls([CONTROL_MODEL], { asOf: cycle.as_of });

    const modelRows = await warehouse.all(
      `select subject_id, passing, reason, first_observed from ${CONTROL_MODEL} order by subject_id`,
    );
    const assertion = buildAssertion({
      control,
      asOf: cycle.as_of,
      rows: modelRows.map((r) => ({ ...r, first_observed: isoish(r.first_observed) })),
      confidenceTier: 4,
    });
    assertion.fixture = true;
    assertion.drift = denominatorDrift(assertions.at(-1), assertion);
    assertions.push(assertion);
  }

  // The variance layer reads the accumulated snapshot, so it is built once, after every cycle has
  // landed. Building it per cycle would work too — it is a view — but doing it here makes the
  // dependency on accumulated history explicit rather than incidental.
  await warehouse.buildLayer('intermediate', { asOf: cycles.at(-1).as_of, root });
  await warehouse.buildLayer('variance', { asOf: cycles.at(-1).as_of, root });

  const events = await warehouse.all(`
    select control_id, subject_id, variance_started_at, variance_detected_at,
           remediation_started_at, remediation_completed_at, started_at_quality, still_open
    from variance_events order by subject_id`);

  return { warehouse, controls, control, cycles, landed, assertions, events };
}

/**
 * True when a variance claims to have started before the most recent cycle in which the subject was
 * still observed passing. Not a slow detection — an impossible timestamp. See
 * docs/adr/0006-variance-quality-ladder.md.
 */
export function impossibleStart(event, cycleTimes) {
  const started = new Date(isoish(event.variance_started_at));
  const detected = new Date(isoish(event.variance_detected_at));
  const prior = cycleTimes.map((c) => new Date(c)).filter((c) => c < detected);
  return prior.length > 0 && started < prior.at(-1);
}
