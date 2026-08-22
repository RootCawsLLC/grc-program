import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

/**
 * Schema validation plus the guards.
 *
 * The guards are the part that matters. A schema stops malformed YAML. A guard stops a control
 * inventory from telling a comfortable lie — and a comfortable lie in a control inventory becomes
 * a material misstatement in an SSP, a trust-center claim, and eventually a customer contract.
 *
 * Every guard here is a rule this repo refuses to break, expressed as a failing exit code rather
 * than as a paragraph in a runbook nobody reads.
 */

const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));

export async function loadYamlDir(dir) {
  let files;
  try { files = (await readdir(dir)).filter((f) => /\.ya?ml$/.test(f)); }
  catch { return []; }
  return Promise.all(
    files.sort().map(async (f) => ({ _file: join(dir, f), ...parseYaml(await readFile(join(dir, f), 'utf8')) }))
  );
}

export async function loadSchema(name, root = '.') {
  return JSON.parse(await readFile(join(root, 'schemas', name), 'utf8'));
}

export async function validateAll({ root = '.' } = {}) {
  const problems = [];
  const controls   = await loadYamlDir(join(root, 'controls'));
  const exceptions = await loadYamlDir(join(root, 'exceptions'));
  const scenarios  = await loadYamlDir(join(root, 'scenarios'));

  const check = (schema, records, label) => {
    const v = ajv.compile(schema);
    for (const r of records) {
      const { _file, ...body } = r;
      if (!v(body)) {
        for (const e of v.errors) problems.push({ severity: 'error', file: _file, rule: `${label}-schema`, message: `${e.instancePath || '/'} ${e.message}` });
      }
    }
  };

  check(await loadSchema('control.schema.json',   root), controls,   'control');
  check(await loadSchema('exception.schema.json', root), exceptions, 'exception');
  check(await loadSchema('scenario.schema.json',  root), scenarios,  'scenario');

  problems.push(...guards({ controls, exceptions, scenarios }));
  return { problems, counts: { controls: controls.length, exceptions: exceptions.length, scenarios: scenarios.length } };
}

export function guards({ controls, exceptions, scenarios }) {
  const p = [];
  const scenarioIds = new Set(scenarios.map((s) => s.scenario_id));
  const controlIds  = new Set(controls.map((c) => c.control_id));
  const seen = new Set();

  for (const c of controls) {
    const at = { file: c._file, control_id: c.control_id };

    // G1 — IDs are unique and stable. A reused ID silently rewrites history in every artifact
    // an auditor already holds.
    if (seen.has(c.control_id)) p.push({ severity: 'error', ...at, rule: 'G1-duplicate-id', message: `control_id ${c.control_id} declared more than once` });
    seen.add(c.control_id);

    // G2 — Policy last. Never publish a policy for a control that does not exist. A premature
    // policy is a Defined Expectations control with no corresponding Loss Event Control: it
    // produces documented misalignment, not risk reduction.
    if (c.policy_ref && c.status !== 'operating') {
      p.push({ severity: 'error', ...at, rule: 'G2-policy-before-control', message: `policy_ref is set but status is "${c.status}". Build the control, instrument it, observe it holding, then generate the policy.` });
    }

    // G3 — Exactly one primary FAIR-CAM function. Zero means the control is unmeasurable;
    // more than one means the layer split is wrong.
    const primaries = (c.faircam ?? []).filter((f) => f.primary).length;
    if (primaries !== 1) p.push({ severity: 'error', ...at, rule: 'G3-primary-function', message: `expected exactly 1 primary FAIR-CAM function, found ${primaries}` });

    // G4 — A control with no scenario is unpriced. Either find its scenario or ask why it exists.
    if (!c.scenarios?.length) {
      p.push({ severity: 'warning', ...at, rule: 'G4-unpriced-control', message: 'no scenarios[]. This control cannot be ranked by ROSI and cannot be defended against "why this and not that".' });
    }
    for (const s of c.scenarios ?? []) {
      if (!scenarioIds.has(s)) p.push({ severity: 'error', ...at, rule: 'G4-dangling-scenario', message: `references unknown scenario ${s}` });
    }

    // G5 — Prose denominator and executable denominator must both exist. The prose is what the
    // auditor reads; the query is what produces the population. Drift between them is a finding.
    if (!c.query_ref?.endsWith('.sql')) p.push({ severity: 'error', ...at, rule: 'G5-query-ref', message: 'query_ref must point at a .sql model — the model IS the evidence' });

    // G6 — Cost is required to rank. An unpopulated cost is not zero cost; it makes ROSI
    // undefined. Warn loudly rather than compute a meaningless infinity.
    if (c.status === 'operating' && !(c.cost?.opex_annual > 0)) {
      p.push({ severity: 'warning', ...at, rule: 'G6-unpopulated-cost', message: 'status is operating but cost.opex_annual is 0/absent. ROSI is undefined, not infinite.' });
    }

    // G7 — A control claiming source-timestamp variance quality must not be a manual procedure.
    if (c.collection?.mechanism === 'manual-procedure' && c.collection?.variance_started_at_quality === 'source-timestamp') {
      p.push({ severity: 'error', ...at, rule: 'G7-impossible-variance-quality', message: 'a manual procedure cannot yield source-timestamp variance quality' });
    }
  }

  // G8 — Exceptions expire. An exception with no expiry, or a past one, is an undocumented
  // control change. This is the guard that stops the exception register becoming a graveyard.
  const today = new Date().toISOString().slice(0, 10);
  for (const ex of exceptions) {
    const at = { file: ex._file, control_id: ex.control_id };
    if (!controlIds.has(ex.control_id)) p.push({ severity: 'error', ...at, rule: 'G8-dangling-exception', message: `${ex.exception_id} references unknown control ${ex.control_id}` });
    if (ex.expires_on && ex.expires_on < today) p.push({ severity: 'error', ...at, rule: 'G8-expired-exception', message: `${ex.exception_id} expired ${ex.expires_on}. Renew it or let the subjects fail.` });
    for (const comp of ex.compensating ?? []) {
      if (!controlIds.has(comp)) p.push({ severity: 'error', ...at, rule: 'G8-dangling-compensating', message: `${ex.exception_id} names unknown compensating control ${comp}` });
    }
  }

  // G9 — Scenario parameters carry provenance. A range with no provenance and a range with six
  // sourced parameters must not look equally authoritative on a slide.
  for (const s of scenarios) {
    for (const [name, param] of Object.entries(s.parameters ?? {})) {
      if (!param.provenance?.source) {
        p.push({ severity: 'error', file: s._file, rule: 'G9-unprovenanced-parameter', message: `${s.scenario_id}.${name} has no provenance.source` });
      }
      if (param.min > param.most_likely || param.most_likely > param.max) {
        p.push({ severity: 'error', file: s._file, rule: 'G9-inverted-range', message: `${s.scenario_id}.${name} range is inverted (${param.min}/${param.most_likely}/${param.max})` });
      }
    }
  }

  return p;
}
