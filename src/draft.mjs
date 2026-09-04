/**
 * Draft artifacts from a hydrated pack.
 *
 * A pack is context. This module is the mechanical specialist output:
 * a Linear issue body, an evidence package, a scenario stub, a questionnaire
 * answer. It does not post, merge, approve an exception, populate FAIR
 * parameters, or conclude that a control works.
 *
 * Design-time specialists (requirement-decomposer, crosswalk, test-author,
 * policy-generator) draft PRs in a session. This host will not write
 * `controls/`, `policies/` or `scenarios/`.
 *
 * `--live` / `send: true` is refused. A draft that quietly posted would look
 * like a ticket, and the next "fix" would be the first real Linear issue.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { FIXTURE_STAMP } from './lib/load.mjs';
import { stableStringify } from './oscal/assessment-results.mjs';
import { DEFAULT_FIXTURE_PACK_DIR, DEFAULT_PACK_DIR } from './pack.mjs';

/** Same table as `src/health.mjs`. Evidence-scout uses one cadence, not two. */
const CADENCE_DAYS = {
  continuous: 1, daily: 1, weekly: 7, monthly: 31, quarterly: 92, annual: 366,
};

const BLOCKED_SEGMENTS = Object.freeze(['controls', 'policies', 'exceptions', 'scenarios']);

function normalised(path) {
  return String(path).replace(/\\/g, '/');
}

function sameDir(a, b) {
  return normalised(a).replace(/\/+$/, '') === normalised(b).replace(/\/+$/, '');
}

function stamp(pack) {
  const fixture = Boolean(pack?.fixture || pack?._stamp === FIXTURE_STAMP);
  return {
    executed: false,
    posted: false,
    sent: false,
    screenshot: false,
    shared_state_file: null,
    fixture,
    ...(fixture ? { _stamp: FIXTURE_STAMP } : {}),
  };
}

function refuse(pack, code, message) {
  return { ok: false, code, message, specialist: pack?.specialist ?? null, ...stamp(pack) };
}

export function assertDraftDir(dir) {
  if (!dir || typeof dir !== 'string') {
    throw new Error('materializeDrafts needs a directory. Drafts are files, not a Linear post.');
  }
  const parts = normalised(dir).split('/').filter(Boolean);
  for (const seg of BLOCKED_SEGMENTS) {
    if (parts.includes(seg)) {
      throw new Error(
        `refusing to write drafts under ${seg}/. A draft is not a merge and not a scenario on the branch.`,
      );
    }
  }
}

function assertNotMixedDir(dir, fixture) {
  if (fixture && sameDir(dir, DEFAULT_PACK_DIR)) {
    throw new Error(
      `refusing to write a fixture draft into ${DEFAULT_PACK_DIR}. Synthetic and real drafts do not share a directory.`,
    );
  }
  if (!fixture && sameDir(dir, DEFAULT_FIXTURE_PACK_DIR)) {
    throw new Error(
      `refusing to write a real draft into ${DEFAULT_FIXTURE_PACK_DIR}. Synthetic and real drafts do not share a directory.`,
    );
  }
}

function mentionsFedramp(pack) {
  const blob = `${pack?.kind ?? ''} ${JSON.stringify(pack?.payload ?? {})}`;
  return /fedramp/i.test(blob);
}

function populationLine(assertion) {
  if (!assertion || assertion.total == null || assertion.passing_count == null) return null;
  return `${assertion.passing_count} of ${assertion.total}`;
}

function staleVsCadence(control, assertionAsOf, asOf) {
  const cadence = control?.collection?.cadence;
  const window = CADENCE_DAYS[cadence];
  if (!window || !assertionAsOf || !asOf) return { stale: false, unknown: true };
  const ageDays = (new Date(asOf) - new Date(assertionAsOf)) / 86_400_000;
  return { stale: ageDays > window, ageDays, cadence, window };
}

function controlOf(pack) {
  return pack.reads?.get_control?.control ?? null;
}

function latestAssertion(pack) {
  const fromControl = pack.reads?.get_control?.latest_assertion;
  if (fromControl) return fromControl;
  const history = pack.reads?.get_assertion_history;
  const all = history?.assertions ?? history?.history ?? history?.records;
  if (Array.isArray(all) && all.length) return all.at(-1);
  return null;
}

function draftExceptionTriage(pack) {
  const control = controlOf(pack);
  if (!control) return refuse(pack, 'missing-control', 'exception-triage needs get_control. The pack did not contain one.');
  const payload = pack.payload ?? {};
  const subject = payload.subject_id ?? null;
  const days = payload.days_failing ?? payload.failing_for_days ?? null;
  const measured = pack.reads?.list_failing?.measured ?? [];
  const row = measured.find((m) => m.control_id === control.control_id);
  const failing = (row?.failing ?? []).find((f) => f.subject_id === subject) ?? null;
  const firstObserved = failing?.first_observed ?? payload.first_observed ?? null;
  const scenarios = control.scenarios ?? [];
  const exception = payload.exception ?? failing?.exception_ref ?? null;

  const lines = [
    `${control.control_id} — ${subject ?? 'unnamed subject'} is outside the intended state.`,
    '',
    `Owner: ${control.owner}`,
    `as_of: ${pack.as_of}  derivation_level: ${pack.derivation_level ?? 'measured'}`,
    subject ? `subject: ${subject}` : null,
    failing?.reason ? `reason: ${failing.reason}` : (payload.reason ? `reason: ${payload.reason}` : null),
    firstObserved ? `first_observed: ${firstObserved} (age is from this, not from detection)` : null,
    days != null ? `failing_for_days: ${days} (${pack.derivation_level ?? 'measured'})` : null,
    `fixed looks like: ${control.population_definition?.trim() ?? 'see population_definition on the control record'}`,
    scenarios.length ? `scenarios: ${scenarios.join(', ')}` : 'scenarios: none joined',
    exception ? `exception in force: ${JSON.stringify(exception)} — still in failing[], still a work item` : 'no documented exception',
    payload.escalate_to_root_cause
      ? `ESCALATE: failing ${payload.consecutive_cycles} cycles running. Stop opening tickets; find the cause.`
      : null,
    '',
    'This item is not an exception approval. Closure happens when the test passes.',
  ].filter((l) => l !== null);

  return {
    ok: true,
    specialist: 'exception-triage',
    tool: 'save_issue',
    issue: {
      team: control.owner,
      title: subject
        ? `${control.control_id}: ${subject} outside intended state`
        : `${control.control_id}: subjects outside intended state`,
      description: lines.join('\n'),
      id: payload.item_id ?? (subject ? `${control.control_id}|${subject}` : control.control_id),
    },
    closes_item: false,
    approves_exception: false,
    derivation_level: pack.derivation_level ?? 'measured',
    ...stamp(pack),
  };
}

function evidenceGate(pack) {
  if (mentionsFedramp(pack)) {
    return refuse(
      pack,
      'no-fedramp',
      'The organization holds no FedRAMP authorization. Do not soften that. Route it to GRC.',
    );
  }
  const control = controlOf(pack);
  if (!control) {
    return refuse(
      pack,
      'missing-control',
      'No control_id on the envelope, so there is no assertion to assemble. The evidence does not exist here. Do not invent a control.',
    );
  }
  if (control.status !== 'operating') {
    return refuse(
      pack,
      'not-operating',
      `${control.control_id} status is ${JSON.stringify(control.status)}, not operating. ` +
        'A confident answer about a planned or building control is a contractual misrepresentation. Say it is under construction.',
    );
  }
  const assertion = latestAssertion(pack);
  if (!assertion) {
    return refuse(
      pack,
      'no-assertion',
      `The evidence does not exist for ${control.control_id}. That sentence is the answer.`,
    );
  }
  const staleness = staleVsCadence(control, assertion.as_of, pack.as_of);
  if (staleness.stale) {
    return refuse(
      pack,
      'stale-assertion',
      `Assertion as_of ${assertion.as_of} is older than the ${staleness.cadence} cadence relative to ${pack.as_of}. Stale is worse than absent.`,
    );
  }
  return { control, assertion };
}

function draftEvidenceScout(pack) {
  const gate = evidenceGate(pack);
  if (gate.ok === false) return gate;
  const { control, assertion } = gate;
  const history = pack.reads?.get_assertion_history ?? null;
  const pop = populationLine(assertion);
  return {
    ok: true,
    specialist: 'evidence-scout',
    package: {
      control_id: control.control_id,
      status: control.status,
      as_of: assertion.as_of,
      population: pop,
      passing_count: assertion.passing_count,
      total: assertion.total,
      failing_count: assertion.failing_count,
      failing: assertion.failing ?? pack.reads?.list_failing?.measured?.find((m) => m.control_id === control.control_id)?.failing ?? null,
      coverage_basis: assertion.coverage_basis ?? null,
      query_ref: control.query_ref,
      lineage: {
        source_system: control.source_system ?? null,
        query_ref: control.query_ref,
        note: 'A count derived from a reproducible query over the full population is a population statement, not a sample.',
      },
      time_series: history,
      derivation_level: pack.derivation_level ?? 'measured',
    },
    screenshot: false,
    rounded: false,
    ...stamp(pack),
  };
}

function draftAttestation(pack) {
  const gate = evidenceGate(pack);
  if (gate.ok === false) return gate;
  const { control, assertion } = gate;
  const pop = populationLine(assertion);
  const exclusions = (assertion.failing ?? []).filter((f) => f.exception_ref);
  const answer = [
    `${control.title ?? control.control_id}: ${pop} passing as of ${assertion.as_of}, measured from ${control.source_system ?? 'the source system'} via ${control.query_ref}.`,
    exclusions.length
      ? `Exclusions: ${exclusions.map((f) => `${f.subject_id} (${f.exception_ref})`).join('; ')}.`
      : 'No documented exceptions in the failing set.',
    'Evidence under NDA: the assertion record, the query, the lineage, the time series. Not a screenshot.',
  ].join(' ');
  return {
    ok: true,
    specialist: 'attestation-writer',
    answer,
    from_policy: false,
    screenshot: false,
    rounded: false,
    derivation_level: pack.derivation_level ?? 'measured',
    ...stamp(pack),
  };
}

function draftScenarioScoper(pack) {
  const payload = pack.payload ?? {};
  if (pack.kind === 'threat-intel.match' || payload.cve || payload.component) {
    return {
      ok: true,
      specialist: 'scenario-scoper',
      scenario: null,
      redirect: 'control-deficiency',
      message:
        'A CVE match names a method and a component. A loss that disappears once the package is upgraded is a control deficiency, not a risk. Do not write a scenario. Do not populate parameters.',
      parameters_populated: false,
      ...stamp(pack),
    };
  }
  const actor = payload.threat_actor;
  const asset = payload.asset;
  const effect = payload.effect;
  if (!actor || !asset || !effect) {
    return refuse(
      pack,
      'underspecified-scenario',
      'A scenario is one sentence: a threat actor acting against an asset in a manner that produces an effect. Missing parts are not guessed.',
    );
  }
  const assumed = (unit) => ({
    min: 0,
    most_likely: 0,
    max: 0,
    unit,
    provenance: {
      derivation_level: 'assumed',
      source: 'UNCALIBRATED — scoped only. Populate at a named-human workshop. See scenarios/_CALIBRATION-STATUS.md.',
      confidence_tier: 1,
    },
  });
  return {
    ok: true,
    specialist: 'scenario-scoper',
    scenario: {
      scenario_id: payload.scenario_id ?? null,
      statement: `A ${actor} acting against ${asset} in a manner that produces ${effect}.`,
      asset,
      threat_actor: actor,
      effect,
      estimation_level: payload.estimation_level ?? 'lef',
      estimation_rationale: 'Scoped only. Parameters are zeros because this host does not calibrate.',
      parameters: {
        loss_event_frequency: assumed('events_per_year'),
        primary_loss_magnitude: assumed('usd'),
      },
      controls: payload.control_id ? [payload.control_id] : (payload.controls ?? []),
    },
    parameters_populated: false,
    writes_to_scenarios: false,
    ...stamp(pack),
  };
}

const DRAFTERS = Object.freeze({
  'exception-triage': draftExceptionTriage,
  'evidence-scout': draftEvidenceScout,
  'scenario-scoper': draftScenarioScoper,
  'attestation-writer': draftAttestation,
});

/**
 * @param {object} pack  hydrated input_pack
 * @param {{ send?: boolean }} [opts]
 */
export function draftFromPack(pack, { send } = {}) {
  if (send) {
    return refuse(
      pack,
      'send-refused',
      'This host drafts payloads. --live / send:true would post to Linear or open a PR and is refused.',
    );
  }
  if (!pack || typeof pack !== 'object' || !pack.specialist) {
    return refuse(pack, 'missing-pack', 'draftFromPack needs a hydrated pack with a specialist.');
  }
  const fn = DRAFTERS[pack.specialist];
  if (!fn) {
    return refuse(
      pack,
      'not-mechanical',
      `${pack.specialist} drafts a PR in a session. This host does not write controls/, policies/ or scenarios/.`,
    );
  }
  return fn(pack);
}

export function draftFilePath(dir, eventId, agent) {
  const safeEvent = String(eventId).replace(/[^a-zA-Z0-9._-]+/g, '.');
  const safeAgent = String(agent).replace(/[^a-zA-Z0-9._-]+/g, '-');
  return join(dir, safeEvent, `${safeAgent}.draft.json`);
}

/**
 * Write one draft file per pack. Never a Linear post. Never a file under scenarios/.
 */
export async function materializeDrafts({ packs = [], dir, fixture } = {}) {
  assertDraftDir(dir);
  const stamped = Boolean(fixture || packs.some((p) => p?.fixture || p?._stamp === FIXTURE_STAMP));
  assertNotMixedDir(dir, stamped);
  const files = [];
  const drafts = [];
  for (const pack of packs) {
    const draft = draftFromPack(pack);
    drafts.push(draft);
    const path = draftFilePath(dir, pack.event_id ?? 'evt.unknown', pack.specialist);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, stableStringify(draft));
    files.push(path);
  }
  return {
    ok: true,
    executed: false,
    posted: false,
    sent: false,
    shared_state_file: null,
    fixture: stamped,
    files,
    drafts,
  };
}
