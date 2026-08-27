/**
 * `assert` — turn landed state into control assertion records.
 *
 * Reads whatever `collect` put in the warehouse, runs the staging and control models over every
 * as_of present, and produces one assertion record per control per cycle. This generalises what
 * `src/pipeline.mjs` does for the demo: the demo lands and asserts in one in-memory pass, and this
 * asserts over a warehouse that already exists, which is what a scheduled run needs.
 *
 * THE STAMP IS NOT RE-DERIVED HERE. Whether the evidence is fixture-derived is decided at
 * collection and read back off the manifest. Recomputing it would let a real assertion be built
 * from fixture rows and come out unmarked — precisely the laundering `src/lib/load.mjs` refuses to
 * allow at the set level.
 *
 * A CONTROL WITH NO MODEL IS REPORTED, NOT SKIPPED. `models/controls/` holds two worked examples
 * against nine controls. Silently asserting over the two and reporting success would state a
 * measurement about a fifth of the inventory and let the rest read as fine. Unmeasured is not
 * passing, and the count comes back with the result.
 */

import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { Warehouse } from './warehouse.mjs';
import { SNAPSHOT_TABLE } from './lib/tables.mjs';
import { buildAssertion } from './lib/assertion.mjs';
import { loadYamlDir } from './validate.mjs';
import { isoish } from './pipeline.mjs';
import { DEFAULT_WAREHOUSE } from './collect.mjs';

/** Model file name for a control_id: ctl.iam.cloud-platform.mfa -> ctl_iam_cloud_platform_mfa */
export const modelNameFor = (controlId) => controlId.replace(/[.\-]/g, '_');

/** Which controls have a model in models/controls/, and which do not. */
export function modelCoverage(controls, root = '.') {
  const dir = join(root, 'models', 'controls');
  const present = existsSync(dir)
    ? new Set(readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => f.replace(/\.sql$/, '')))
    : new Set();

  const modelled = [];
  const unmodelled = [];
  for (const c of controls) {
    (present.has(modelNameFor(c.control_id)) ? modelled : unmodelled).push(c);
  }
  return { modelled, unmodelled };
}

export async function readManifest(path = '.warehouse/last-collection.json') {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(
        `no collection manifest at ${path}. Run \`collect\` first.\n` +
        '  Asserting over a warehouse nobody just wrote would report yesterday\'s state as today\'s,\n' +
        '  and an assertion carries an as_of that a reader will trust.',
      );
    }
    throw err;
  }
}

export async function runAssert({
  warehousePath = DEFAULT_WAREHOUSE,
  manifestPath = '.warehouse/last-collection.json',
  root = '.',
} = {}) {
  const manifest = await readManifest(manifestPath);
  if (!existsSync(warehousePath)) {
    throw new Error(`no warehouse at ${warehousePath}. The manifest says one was written — run \`collect\` again.`);
  }

  const controls = await loadYamlDir(join(root, 'controls'));
  const { modelled, unmodelled } = modelCoverage(controls, root);
  if (!modelled.length) {
    throw new Error('no control in the inventory has a model in models/controls/. There is nothing to assert.');
  }

  const warehouse = await Warehouse.open(warehousePath);
  const cycles = (await warehouse.all(
    `select distinct as_of from landing_aws_credential_report order by as_of`,
  )).map((r) => isoish(r.as_of));

  if (!cycles.length) {
    await warehouse.close();
    throw new Error('the warehouse holds no landed cycles. `collect` recorded a manifest but landed nothing.');
  }

  const assertions = [];
  for (const asOf of cycles) {
    await warehouse.buildLayer('staging', { asOf, root });
    await warehouse.buildLayer('controls', { asOf, root });
    await warehouse.snapshotControls(modelled.map((c) => modelNameFor(c.control_id)), { asOf });

    for (const control of modelled) {
      const rows = await warehouse.all(
        `select subject_id, passing, reason, first_observed from ${modelNameFor(control.control_id)} order by subject_id`,
      );
      const assertion = buildAssertion({
        control,
        asOf,
        rows: rows.map((r) => ({ ...r, first_observed: r.first_observed ? isoish(r.first_observed) : null })),
        // Read off the collection, never re-derived. Fixture rows can only produce a tier-3
        // assertion: empirical, but against a reference population rather than the declared one.
        confidenceTier: manifest.fixture ? 3 : 4,
      });
      if (manifest.fixture) assertion.fixture = true;
      assertions.push(assertion);
    }
  }

  const snapshotRows = Number((await warehouse.all(`select count(*) as n from ${SNAPSHOT_TABLE}`))[0].n);
  await warehouse.close();

  return {
    assertions,
    cycles,
    fixture: Boolean(manifest.fixture),
    snapshot_rows: snapshotRows,
    coverage: {
      modelled: modelled.map((c) => c.control_id),
      unmodelled: unmodelled.map((c) => c.control_id),
      note: unmodelled.length
        ? `${unmodelled.length} of ${controls.length} control(s) have no model in models/controls/. ` +
          'They are UNMEASURED by this run, which is not the same as passing.'
        : undefined,
    },
  };
}
