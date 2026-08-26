import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { loadRoster, authorityScopes, heldScopeOn, uncoveredScopes } from './lib/authority.mjs';

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
  const roster     = await loadRoster(root);
  const scopes     = await authorityScopes(root);

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

  // The roster files are single documents, not a directory of records, so they are checked here
  // rather than through check(). An absent file is not a schema failure — G10/G11/G12 report it.
  for (const [key, schemaName] of [['people', 'person.schema.json'], ['teams', 'team.schema.json']]) {
    if (!roster[key].present) continue;
    const v = ajv.compile(await loadSchema(schemaName, root));
    if (!v({ [key]: roster[key].records })) {
      for (const e of v.errors) problems.push({ severity: 'error', file: roster[key]._file, rule: `${key}-schema`, message: `${e.instancePath || '/'} ${e.message}` });
    }
  }

  problems.push(...guards({ controls, exceptions, scenarios, roster, scopes }));
  return { problems, counts: { controls: controls.length, exceptions: exceptions.length, scenarios: scenarios.length, people: roster.people.records.length, teams: roster.teams.records.length } };
}

export function guards({ controls, exceptions, scenarios, roster, scopes }) {
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


  // ---- Authority model (G10-G12) --------------------------------------------------------
  // Skipped entirely when no roster is passed, which is the unit-test path. validateAll always
  // passes one, so a real build always runs these — including when the files are absent.
  if (roster) {
    const teams  = roster.teams.records ?? [];
    const people = roster.people.records ?? [];
    const liveTeams = new Set(teams.filter((t) => !t.dissolved_on).map((t) => t.team_id));

    // G10 - control.owner resolves to a team that exists. Until now the slug pointed at nothing:
    // "owner: ml-platform" validated whether or not such a team had ever existed, so a team
    // reorganised out from under its controls left them orphaned with no signal anywhere.
    if (roster.teams.present) {
      for (const c of controls) {
        if (!c.owner) continue;
        if (!liveTeams.has(c.owner)) {
          p.push({ severity: 'error', file: c._file, control_id: c.control_id, rule: 'G10-unknown-owner',
            message: `owner "${c.owner}" is not a live team in roster/teams.yaml. An orphaned control has accountability on paper and none in fact.` });
        }
      }
    } else {
      p.push({ severity: 'warning', file: roster.teams._file, rule: 'G10-no-team-roster',
        message: 'roster/teams.yaml is absent — every control owner is currently unverifiable.' });
    }

    // G11 - every authority scope has an eligible non-principal approver. A scope that only the
    // principal can approve is an undelegated control: it will be approved by whoever is available
    // rather than whoever is entitled, and that is invisible until someone audits the approvals.
    // Warning rather than error because early in a programme it is TRUE and blocking the build
    // over an unfinished delegation would just teach people to skip validation.
    if (scopes?.length) {
      const uncovered = uncoveredScopes(people, scopes, today);
      if (uncovered.length) {
        p.push({ severity: 'warning', file: roster.people._file, rule: 'G11-undelegated-scope',
          message: `${uncovered.length} of ${scopes.length - 1} authority scopes have no non-principal approver as of ${today}: ${uncovered.join(', ')}` });
      }
    }

    // G12 - the approver on an exception was entitled to approve it ON THE DAY THEY DID.
    // This is the guard that catches EX-0001. "approved_by" has always been required, but nothing
    // resolved it, so a placeholder string passed CI. Entitlement is checked against approved_on
    // rather than today because authority is a fact about a moment - an approval signed before a
    // delegation began, or after the approver left, was never authorised, and that stops being
    // reconstructable the moment the org chart is overwritten.
    const REASON = {
      'unknown-person': () => 'no such person_id in roster/people.yaml',
      'departed': (v) => `that person had already left (${v.detail})`,
      'no-grant': () => 'that person holds no exception.approve grant',
      'grant-not-yet-effective': (v) => `the delegation did not exist yet (${v.detail})`,
      'grant-expired': (v) => `the delegation had ended (${v.detail})`,
    };
    for (const ex of exceptions) {
      if (!ex.approved_by) continue;
      const at = { file: ex._file, control_id: ex.control_id };
      if (!roster.people.present || !people.length) {
        p.push({ severity: 'warning', ...at, rule: 'G12-unverifiable-approval',
          message: `${ex.exception_id} names approver "${ex.approved_by}", but roster/people.yaml holds no people - the approval cannot be checked against any delegation.` });
        continue;
      }
      const person = people.find((x) => x.person_id === ex.approved_by);
      const verdict = heldScopeOn(person, 'exception.approve', ex.approved_on);
      if (!verdict.held) {
        p.push({ severity: 'error', ...at, rule: 'G12-unentitled-approval',
          message: `${ex.exception_id} was approved by "${ex.approved_by}" on ${ex.approved_on}: ${(REASON[verdict.reason] ?? (() => verdict.reason))(verdict)}` });
      }
    }
  }

  return p;
}
