/**
 * The tools this repo exposes over MCP. READ-ONLY, without exception.
 *
 * Writes go through pull requests. That is guardrail 2 in CLAUDE.md and it is not negotiable: the
 * merge IS the control, and a model that can write to controls/ has removed the only human step in
 * the chain. Enforcement here is structural rather than promised — every tool declares
 * `effect: 'read'`, the server refuses to register anything else, and a test exercises every tool
 * and then asserts the working tree is byte-for-byte unchanged.
 *
 * ON THE DESCRIPTIONS. B19 asks for these to be written as carefully as a control's
 * population_definition, and the reason is the same: a description is not documentation, it is the
 * thing that decides whether the right tool gets called and whether the answer is understood. So
 * each one says what the answer covers, what it EXCLUDES, and what it must not be read as claiming.
 * "412 of 412" and "412 of 412, measured Tuesday, against a population that omits contractors" are
 * different sentences and only one of them is safe in front of an auditor.
 *
 * EVERY ANSWER CARRIES ITS PROVENANCE. Each result includes a `_source` block naming the files it
 * came from and whether the evidence is fixture-derived. An answer that cannot be traced back to a
 * file in this repo is exactly the "I think we're covered there" this server exists to replace.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { loadYamlDir } from '../validate.mjs';
import { loadAssertions, isFixtureSet, FIXTURE_STAMP } from '../lib/load.mjs';
import { loadFindings, loadRequirementIndex, reconcile } from '../intake.mjs';
import { assessAll, DEFICIENCIES, BANDS } from '../health.mjs';
import { assessGaps } from '../gap.mjs';

/**
 * Refuses a root that is not this repository.
 *
 * WHY THIS IS FATAL RATHER THAN A WARNING. Every loader below degrades gracefully to an empty
 * result: loadYamlDir catches a missing directory and returns [], loadAssertions returns [] on
 * ENOENT. Pointed at the wrong directory the server therefore STARTS CLEANLY, reports
 * "0 controls, 0 scenarios", and answers `list_failing` with zero failing subjects — which reads
 * as good news rather than as a misconfiguration.
 *
 * That is not hypothetical. The server was registered with `claude mcp add` at local scope with no
 * RECO_GRC_ROOT, so it launched with cwd set to the parent workspace directory and sat there
 * showing "✔ Connected" while knowing about nothing at all. A healthy-looking server confidently
 * reporting an empty inventory is the single worst output this repo can produce, and graceful
 * degradation is what produced it.
 *
 * So the marker is checked before anything loads, and a bad root stops the process.
 */
async function assertRepoRoot(root) {
  const marker = join(root, 'schemas', 'control.schema.json');
  let name = null;
  try {
    name = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).name;
  } catch { /* falls through to the same refusal */ }

  if (!existsSync(marker) || name !== 'reco-grc') {
    throw new Error(
      `refusing to start: ${root} is not the reco-grc repository.\n` +
      `  expected: schemas/control.schema.json and package.json name "reco-grc"\n` +
      `  found:    marker ${existsSync(marker) ? 'present' : 'MISSING'}, package name ${JSON.stringify(name)}\n` +
      '\n' +
      '  Every loader here degrades to an empty result, so without this check the server would\n' +
      '  start, report "0 controls", and answer "nothing is failing" — which is indistinguishable\n' +
      '  from good news and is not true.\n' +
      '\n' +
      '  Set RECO_GRC_ROOT to an absolute path, which is required whenever the server is registered\n' +
      '  outside the repo directory:\n' +
      '    claude mcp add reco-grc -s user -e RECO_GRC_ROOT=<abs-path> -- node <abs-path>/src/mcp/server.mjs',
    );
  }
  return root;
}

/** Loaded once per process and reused. The repo is a git checkout, not a live database. */
export async function loadContext(root = process.cwd()) {
  await assertRepoRoot(root);
  const [controls, scenarios, exceptions, findings, assertions] = await Promise.all([
    loadYamlDir(join(root, 'controls')),
    loadYamlDir(join(root, 'scenarios')),
    loadYamlDir(join(root, 'exceptions')),
    loadFindings(join(root, 'intake/extracted')),
    loadAssertions(join(root, 'fixtures/assertions.json')),
  ]);
  return { root, controls, scenarios, exceptions, findings, assertions };
}

/** The provenance block attached to every answer. */
function source(ctx, files, extra = {}) {
  const fixture = isFixtureSet(ctx.assertions);
  return {
    repo: ctx.root,
    files,
    evidence_is_fixture: fixture,
    ...(fixture
      ? { warning: `${FIXTURE_STAMP}. The assertion set loaded here is synthetic. Any count below describes fixture data, not a real system.` }
      : {}),
    ...extra,
  };
}

const latestPerControl = (assertions) => {
  const latest = new Map();
  for (const a of assertions) {
    const prev = latest.get(a.control_id);
    if (!prev || a.as_of > prev.as_of) latest.set(a.control_id, a);
  }
  return latest;
};

export const TOOLS = [
  {
    name: 'get_control',
    effect: 'read',
    title: 'Get one control record',
    description:
      'Returns the complete control record for one control_id, exactly as it appears in ' +
      'controls/<id>.yaml — including its status, owner, population_definition, query_ref, ' +
      'FAIR-CAM function tags and framework crosswalk identifiers. ' +
      'The crosswalk carries IDENTIFIERS ONLY, never framework text. ' +
      'This describes what the control CLAIMS, not whether it is operating: `status` is a lifecycle ' +
      'state a human set, not a measurement. For measured state use get_assertion_history or ' +
      'health_summary.',
    inputSchema: {
      type: 'object',
      properties: { control_id: { type: 'string', description: 'e.g. ctl.iam.cloud-platform.mfa' } },
      required: ['control_id'],
    },
    handler: async (args, ctx) => {
      const control = ctx.controls.find((c) => c.control_id === args.control_id);
      if (!control) {
        return {
          error: `No control ${args.control_id}. Use list_controls to see the ${ctx.controls.length} that exist.`,
          _source: source(ctx, ['controls/']),
        };
      }
      const assertion = latestPerControl(ctx.assertions).get(control.control_id) ?? null;
      return {
        control,
        latest_assertion: assertion
          ? { as_of: assertion.as_of, total: assertion.total, passing_count: assertion.passing_count, failing_count: assertion.failing_count, confidence_tier: assertion.confidence_tier }
          : null,
        note: assertion ? undefined : 'No assertion record exists for this control. Nothing here is a measurement of its operation.',
        _source: source(ctx, [`controls/${control.control_id}.yaml`, 'fixtures/assertions.json']),
      };
    },
  },

  {
    name: 'list_controls',
    effect: 'read',
    title: 'List controls, optionally filtered',
    description:
      'Lists every control in the inventory as a summary (id, title, status, layer, owner, and ' +
      'whether an assertion exists). Optional filters narrow by status (planned | building | ' +
      'operating | retired), layer, or owner. ' +
      'This is the whole inventory, not a sample. A control being listed says nothing about ' +
      'whether it works — status is a human-set lifecycle state.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['planned', 'building', 'operating', 'retired'] },
        layer: { type: 'string', description: 'e.g. cloud-platform, agent, enterprise-sso' },
        owner: { type: 'string', description: 'e.g. platform-engineering' },
      },
    },
    handler: async (args, ctx) => {
      const latest = latestPerControl(ctx.assertions);
      const rows = ctx.controls
        .filter((c) => (!args.status || c.status === args.status))
        .filter((c) => (!args.layer || c.layer === args.layer))
        .filter((c) => (!args.owner || c.owner === args.owner))
        .map((c) => ({
          control_id: c.control_id,
          title: c.title,
          status: c.status,
          layer: c.layer,
          owner: c.owner,
          has_assertion: latest.has(c.control_id),
        }))
        .sort((a, b) => a.control_id.localeCompare(b.control_id));

      return {
        count: rows.length,
        of_total: ctx.controls.length,
        controls: rows,
        _source: source(ctx, ['controls/']),
      };
    },
  },

  {
    name: 'list_failing',
    effect: 'read',
    title: 'List every failing subject',
    description:
      'Returns the FULLY ENUMERATED set of subjects outside the intended state, from the most ' +
      'recent assertion for each control. Optionally narrowed to one control_id. ' +
      'This is a population statement, not a sample: `total` is the denominator the control test ' +
      'quantified over and `failing` lists every failing subject by id, with the reason and when ' +
      'it was first observed. ' +
      'A subject under a documented exception STILL APPEARS here — an exception reduces coverage, ' +
      'it does not remove the subject from the denominator or from the work queue. ' +
      'Controls with no assertion are reported separately under `unmeasured`; they are not passing, ' +
      'they are unknown, and conflating the two is the most common way this question gets answered ' +
      'wrongly.',
    inputSchema: {
      type: 'object',
      properties: { control_id: { type: 'string', description: 'omit for every control' } },
    },
    handler: async (args, ctx) => {
      const latest = latestPerControl(ctx.assertions);
      const wanted = args.control_id ? [args.control_id] : ctx.controls.map((c) => c.control_id);

      const measured = [];
      const unmeasured = [];
      for (const id of wanted) {
        const a = latest.get(id);
        if (!a) { unmeasured.push(id); continue; }
        measured.push({
          control_id: id,
          as_of: a.as_of,
          total: a.total,
          failing_count: a.failing_count,
          coverage_basis: a.coverage_basis,
          confidence_tier: a.confidence_tier,
          failing: a.failing,
        });
      }

      return {
        failing_subjects: measured.reduce((n, m) => n + m.failing_count, 0),
        controls_measured: measured.length,
        controls_unmeasured: unmeasured.length,
        measured,
        unmeasured,
        note: unmeasured.length
          ? `${unmeasured.length} control(s) have no assertion record. They are UNKNOWN, not passing.`
          : undefined,
        _source: source(ctx, ['fixtures/assertions.json', 'controls/']),
      };
    },
  },

  {
    name: 'get_assertion_history',
    effect: 'read',
    title: 'Assertion history for one control',
    description:
      'Every assertion record for one control, oldest first, optionally bounded by an ISO-8601 ' +
      '`from` and/or `to`. This is the time series behind a control — the thing that makes ' +
      '"what was true on 14 March" answerable and the thing the variance layer is derived from. ' +
      'Each entry carries total, passing_count, failing_count and coverage_basis, so a change in ' +
      'the pass rate can be distinguished from a change in the DENOMINATOR. A population that ' +
      'silently shrank looks like an improving control and is not one.',
    inputSchema: {
      type: 'object',
      properties: {
        control_id: { type: 'string' },
        from: { type: 'string', description: 'ISO-8601, inclusive' },
        to: { type: 'string', description: 'ISO-8601, inclusive' },
      },
      required: ['control_id'],
    },
    handler: async (args, ctx) => {
      const all = ctx.assertions
        .filter((a) => a.control_id === args.control_id)
        .filter((a) => (!args.from || a.as_of >= args.from))
        .filter((a) => (!args.to || a.as_of <= args.to))
        .sort((a, b) => a.as_of.localeCompare(b.as_of));

      return {
        control_id: args.control_id,
        count: all.length,
        window: { from: args.from ?? null, to: args.to ?? null },
        history: all.map((a) => ({
          as_of: a.as_of,
          total: a.total,
          passing_count: a.passing_count,
          failing_count: a.failing_count,
          confidence_tier: a.confidence_tier,
          coverage_basis: a.coverage_basis,
        })),
        note: all.length === 0
          ? 'No assertion records in this window. That is not evidence the control was passing.'
          : all.length === 1
            ? 'A single snapshot. Variance Duration is not derivable from one observation.'
            : undefined,
        _source: source(ctx, ['fixtures/assertions.json']),
      };
    },
  },

  {
    name: 'get_variance',
    effect: 'read',
    title: 'Variance episodes for one control',
    description:
      'Derives variance episodes for a control from its assertion history: when each subject left ' +
      'the intended state and when it returned. ' +
      'THREE of the four FAIR-CAM timestamps are derivable from assertions alone — variance_started ' +
      '(the source system\'s own first_observed), variance_detected (the collection that first saw ' +
      'it) and remediation_completed (the collection that first did not). ' +
      'The fourth, remediation_started, comes from the TICKETING SYSTEM and is not in an assertion ' +
      'record, so it is reported as null here rather than guessed. Without it the middle segment ' +
      'collapses and a prioritisation failure is indistinguishable from an implementation failure. ' +
      'An episode still open has no duration and is reported as open rather than measured to now, ' +
      'which would grow by itself on every call.',
    inputSchema: {
      type: 'object',
      properties: { control_id: { type: 'string' } },
      required: ['control_id'],
    },
    handler: async (args, ctx) => {
      const history = ctx.assertions
        .filter((a) => a.control_id === args.control_id)
        .sort((a, b) => a.as_of.localeCompare(b.as_of));

      if (history.length < 2) {
        return {
          control_id: args.control_id,
          episodes: [],
          note:
            `Variance needs at least two observations to see a transition; this control has ${history.length}. ` +
            'A single snapshot cannot distinguish "always failing" from "just failed".',
          _source: source(ctx, ['fixtures/assertions.json']),
        };
      }

      // subject -> the episode currently open for it
      const open = new Map();
      const episodes = [];
      let prevFailing = new Set();

      for (const a of history) {
        const nowFailing = new Set(a.failing.map((f) => f.subject_id));
        for (const f of a.failing) {
          if (!prevFailing.has(f.subject_id) && !open.has(f.subject_id)) {
            open.set(f.subject_id, {
              subject_id: f.subject_id,
              reason: f.reason,
              variance_started_at: f.first_observed ?? a.as_of,
              variance_detected_at: a.as_of,
              remediation_started_at: null,
              remediation_completed_at: null,
              exception_ref: f.exception_ref ?? null,
            });
          }
        }
        for (const [subject, episode] of [...open.entries()]) {
          if (!nowFailing.has(subject)) {
            episode.remediation_completed_at = a.as_of;
            episodes.push(episode);
            open.delete(subject);
          }
        }
        prevFailing = nowFailing;
      }

      const stillOpen = [...open.values()];
      const days = (a, b) => (a && b ? Math.round(((new Date(b) - new Date(a)) / 86_400_000) * 10) / 10 : null);

      return {
        control_id: args.control_id,
        observations: history.length,
        closed_episodes: episodes.map((e) => ({
          ...e,
          detection_latency_days: days(e.variance_started_at, e.variance_detected_at),
          total_duration_days: days(e.variance_started_at, e.remediation_completed_at),
        })),
        open_episodes: stillOpen.map((e) => ({ ...e, still_open: true, total_duration_days: null })),
        remediation_started_at_note:
          'null throughout: not derivable from assertion records. It comes from the ticketing ' +
          'system and requires the join in models/variance/variance_events.sql.',
        _source: source(ctx, ['fixtures/assertions.json']),
      };
    },
  },

  {
    name: 'get_findings',
    effect: 'read',
    title: 'Audit findings, optionally filtered',
    description:
      'Returns findings extracted from audit reports (intake/extracted/), optionally filtered by ' +
      'disposition or by the control they map to. ' +
      'The number that matters most is `unmapped_open`: an open finding that maps to NO control in ' +
      'the inventory is the sharpest available signal that the control model has a hole, because ' +
      'an auditor found something the model has no place to put. ' +
      'Read `unverified_mapping_open` alongside it: those findings ARE mapped, but at a confidence ' +
      'below "high" or with none recorded, so the attribution is somebody\'s judgement and has not ' +
      'been confirmed. A wrong mapping misdirects the remediation AND leaves the control that ' +
      'should have been named reading clean, so these are not a softer version of unmapped — they ' +
      'are the ones that hide. ' +
      'Source documents themselves are never in this repo — they are NDA-gated and watermarked. ' +
      'Only the structured extraction is committed.',
    inputSchema: {
      type: 'object',
      properties: {
        disposition: { type: 'string', description: 'e.g. open, remediated, accepted' },
        control_id: { type: 'string' },
      },
    },
    handler: async (args, ctx) => {
      const { problems, summary } = reconcile({ findings: ctx.findings, controls: ctx.controls });
      // `control_id` is singular on a finding and may be null — an unmapped finding is the whole
      // point of the `unmapped_open` count, so it must not be filtered into invisibility.
      const rows = ctx.findings
        .filter((f) => (!args.disposition || f.disposition === args.disposition))
        .filter((f) => (!args.control_id || f.control_id === args.control_id));

      return {
        count: rows.length,
        summary,
        findings: rows,
        reconciliation_problems: problems,
        _source: source(ctx, ['intake/extracted/']),
      };
    },
  },

  {
    name: 'health_summary',
    effect: 'read',
    title: 'Control health as a classification',
    description:
      'Classifies every control into a health band with the deficiencies that put it there. ' +
      'THIS IS DELIBERATELY NOT A SCORE. Bands are ordinal and ordinal values never enter ' +
      'arithmetic: a control in band 3 is not three times one in band 1, and averaging them would ' +
      'manufacture a number with no meaning that would then be reported to a board. ' +
      'A deficiency names what is missing — no assertion, stale evidence, an expired exception — ' +
      'so the output is a work queue rather than a dashboard number.',
    inputSchema: {
      type: 'object',
      properties: { as_of: { type: 'string', description: 'ISO-8601; defaults to the newest assertion' } },
    },
    handler: async (args, ctx) => {
      const r = assessAll({ controls: ctx.controls, assertions: ctx.assertions, findings: ctx.findings, asOf: args.as_of });
      return {
        ...r,
        band_meanings: BANDS,
        deficiency_meanings: Object.fromEntries(Object.entries(DEFICIENCIES).map(([k, v]) => [k, v.fix])),
        _source: source(ctx, ['controls/', 'fixtures/assertions.json', 'intake/extracted/']),
      };
    },
  },

  {
    name: 'gap_summary',
    effect: 'read',
    title: 'Four-direction gap assessment',
    description:
      'Gaps between the control model and the four things it must answer to, optionally narrowed ' +
      'to one direction: ' +
      'REMEDIATION (an open finding with no control), RISK (a scenario no control addresses), ' +
      'ASSURANCE (a control with no evidence), COVERAGE (a framework requirement nothing claims). ' +
      'They are different questions with different fixes and are never summed. ' +
      'Coverage is the noisiest by nature and the least urgent; remediation gaps are the ones an ' +
      'auditor already found.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['remediation', 'risk', 'assurance', 'coverage'] },
      },
    },
    handler: async (args, ctx) => {
      const requirementIndex = await loadRequirementIndex(join(ctx.root, 'reference/requirement-index.yaml'));
      const r = assessGaps({ controls: ctx.controls, scenarios: ctx.scenarios, findings: ctx.findings, requirementIndex });
      const gaps = args.direction ? r.gaps.filter((g) => g.direction === args.direction) : r.gaps;
      return {
        total: r.total,
        by_direction: r.by_direction,
        ordering_note: r.ordering_note,
        returned: gaps.length,
        gaps,
        _source: source(ctx, ['controls/', 'scenarios/', 'intake/extracted/', 'reference/requirement-index.yaml']),
      };
    },
  },
];

export const findTool = (name) => TOOLS.find((t) => t.name === name);
