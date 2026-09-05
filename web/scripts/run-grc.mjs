/**
 * Standalone grc-program driver.
 *
 * Runs in its own plain Node ESM process — the same way `src/cli.mjs` and
 * `scripts/demo.mjs` run the tool — so grc-program is never touched by the Next
 * bundler, its DuckDB native addon is loaded by a normal Node process, and its
 * filesystem behavior is exactly as shipped. The API route spawns this with cwd
 * set to the tool repo root, writes a request as JSON on stdin, and reads a
 * result as JSON on stdout.
 *
 * It imports the REAL tool modules natively (never a reimplementation) and drives
 * the exact code paths that `npm run demo` (runPipeline + variance decomposition),
 * `grc health`, `grc gap` and `grc emit` (buildPackage) drive.
 *
 * Target policy: this only ever runs the synthetic pipeline. runPipeline reads
 * fixtures/landing/*.json, and loadCycles() REFUSES any cycle file missing the
 * "NOT REAL EVIDENCE" stamp — so the door itself enforces synthetic-only. Every
 * assertion the pipeline emits carries fixture:true; this asserts that before it
 * renders or emits anything, and refuses otherwise.
 */

// The tool's own modules. No "exports" field in its package.json, so these
// subpaths resolve to the real source files. cwd is the tool root (set by the
// spawner / GRC_ROOT), so the tool's relative data paths resolve as for the CLI.
const { runPipeline, impossibleStart, isoish } = await import('grc-program/src/pipeline.mjs');
const { decomposeVariance } = await import('grc-program/src/faircam.mjs');
const { assessAll, BANDS, DEFICIENCIES } = await import('grc-program/src/health.mjs');
const { assessGaps } = await import('grc-program/src/gap.mjs');
const { loadYamlDir } = await import('grc-program/src/validate.mjs');
const { loadFindings, loadRequirementIndex } = await import('grc-program/src/intake.mjs');
const { buildPackage } = await import('grc-program/src/oscal/emit.mjs');
const { serialize } = await import('grc-program/src/oscal/common.mjs');
const { isFixtureSet, FIXTURE_STAMP, isFixture } = await import('grc-program/src/lib/load.mjs');

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

/** `drift` is a demo-time annotation, not part of the assertion contract (schema is
 * additionalProperties:false). Strip it before it reaches OSCAL or health. */
function strip({ drift, ...assertion }) {
  return assertion;
}

/** What can honestly be said about a still-open variance: only the segments whose
 * endpoints have both happened. Mirrors scripts/demo.mjs partial(). */
function partial(e) {
  const days = (a, b) => Math.round(((new Date(isoish(b)) - new Date(isoish(a))) / 86_400_000) * 10) / 10;
  const touched = e.remediation_started_at;
  return {
    control_id: e.control_id,
    subject_id: e.subject_id,
    total_duration_days: null,
    segments: [
      { span: 'started_to_detected', days: days(e.variance_started_at, e.variance_detected_at), faircam_function: 'control-monitoring', fix: 'monitoring cadence or coverage' },
      { span: 'detected_to_triaged', days: touched ? days(e.variance_detected_at, touched) : null, faircam_function: 'treatment-selection', fix: 'prioritization or ownership' },
      { span: 'triaged_to_remediated', days: null, faircam_function: 'implementation', fix: 'capacity or tooling' },
    ],
  };
}

function controlView(c) {
  const crosswalk = [];
  for (const [framework, ids] of Object.entries(c.crosswalk ?? {})) {
    for (const id of ids ?? []) crosswalk.push({ framework, id, kind: 'crosswalk' });
  }
  for (const [framework, ids] of Object.entries(c.crosswalk_direct ?? {})) {
    for (const id of ids ?? []) crosswalk.push({ framework, id, kind: 'direct' });
  }
  return {
    control_id: c.control_id,
    title: c.title,
    status: c.status,
    layer: c.layer,
    owner: c.owner,
    source_system: c.source_system ?? null,
    query_ref: c.query_ref ?? null,
    population_definition: (c.population_definition ?? '').trim(),
    cadence: c.collection?.cadence ?? null,
    mechanism: c.collection?.mechanism ?? null,
    faircam: (c.faircam ?? []).map((f) => ({ function: f.function, primary: !!f.primary })),
    scenarios: c.scenarios ?? [],
    crosswalk,
    crosswalk_frameworks: [...new Set(crosswalk.map((e) => e.framework))].length,
  };
}

async function main() {
  const req = await readStdin();
  const want = {
    pipeline: req?.sections?.pipeline !== false,
    health: req?.sections?.health !== false,
    gap: req?.sections?.gap !== false,
    oscal: req?.sections?.oscal !== false,
  };
  const started = Date.now();

  // ---- the control inventory: the system of record --------------------------------------
  const controls = await loadYamlDir('controls');
  if (!controls.length) throw new Error('no controls found in controls/ — is cwd the tool root?');
  const scenarios = await loadYamlDir('scenarios');
  const findings = await loadFindings();
  const requirementIndex = await loadRequirementIndex();

  const inventory = controls.map(controlView);
  const crosswalkEdges = inventory.reduce((n, c) => n + c.crosswalk.length, 0);

  // ---- the synthetic evidence pipeline (the demo path) ----------------------------------
  const pipe = await runPipeline();
  const rawAssertions = pipe.assertions; // carry drift + fixture:true
  const stripped = rawAssertions.map(strip);

  // Target-policy guard: refuse unless this really is the synthetic set.
  if (!isFixtureSet(stripped)) {
    await pipe.warehouse.close();
    throw new Error('refusing to run: the pipeline did not produce a fixture-stamped assertion set. This GUI only ever renders the bundled synthetic demo.');
  }

  const cycleTimes = pipe.cycles.map((c) => c.as_of);
  let retainedRows = null;
  try {
    const [{ n }] = await pipe.warehouse.all('select count(*) as n from landing_aws_credential_report');
    retainedRows = Number(n);
  } catch { /* table name may change; the landed[] summary is enough */ }

  // Decompose each variance episode into the FAIR-CAM segments (closed episodes
  // fully; open ones only as far as their endpoints allow) — mirrors the demo.
  const episodes = pipe.events.map((e) => {
    const closed = Boolean(e.remediation_completed_at);
    const d = closed
      ? decomposeVariance({
          control_id: e.control_id,
          subject_id: e.subject_id,
          variance_started_at: isoish(e.variance_started_at),
          variance_detected_at: isoish(e.variance_detected_at),
          remediation_started_at: isoish(e.remediation_started_at),
          remediation_completed_at: isoish(e.remediation_completed_at),
        })
      : partial(e);
    return {
      control_id: e.control_id,
      subject_id: e.subject_id,
      open: !closed,
      started_at_quality: e.started_at_quality,
      variance_started_at: e.variance_started_at,
      variance_detected_at: e.variance_detected_at,
      remediation_started_at: e.remediation_started_at,
      remediation_completed_at: e.remediation_completed_at,
      total_duration_days: d.total_duration_days,
      segments: d.segments,
      impossible_start: impossibleStart(e, cycleTimes),
    };
  });

  const cycles = pipe.assertions.map((a) => ({
    as_of: a.as_of,
    total: a.total,
    passing_count: a.passing_count,
    failing_count: a.failing_count,
    failing: (a.failing ?? []).map((f) => ({ subject_id: f.subject_id, reason: f.reason })),
    drifted: Boolean(a.drift?.drifted),
    drift_reason: a.drift?.reason ?? null,
  }));

  const result = {
    toolVersion: '0.1.0',
    node: process.version,
    fixtureStamp: FIXTURE_STAMP,
    isFixture: true,
    controlCount: inventory.length,
    crosswalkEdges,
    controlsWithEvidence: [...new Set(stripped.map((a) => a.control_id))].length,
    inventory,
  };

  if (want.pipeline) {
    result.pipeline = {
      control_id: pipe.control?.control_id ?? null,
      landed: pipe.landed,
      retainedRows,
      cycleCount: pipe.cycles.length,
      cycles,
      episodes,
    };
  }

  if (want.health) {
    const asOf = pipe.cycles.at(-1)?.as_of;
    const h = assessAll({ controls, assertions: stripped, findings, asOf });
    result.health = {
      as_of: h.as_of,
      total_controls: h.total_controls,
      by_band: h.by_band,
      band_descriptions: BANDS,
      by_deficiency: Object.fromEntries(
        Object.entries(h.by_deficiency).map(([code, n]) => [code, { count: n, fix: DEFICIENCIES[code]?.fix ?? '' }]),
      ),
      scoring_note: h.scoring_note,
      controls: h.controls.map((c) => ({
        control_id: c.control_id,
        band: c.band,
        deficiencies: c.deficiencies,
        last_assertion: c.last_assertion,
        population_total: c.population_total,
      })),
    };
  }

  if (want.gap) {
    const g = assessGaps({ controls, scenarios, findings, requirementIndex });
    result.gap = {
      total: g.total,
      by_direction: g.by_direction,
      ordering_note: g.ordering_note,
      gaps: g.gaps.map((x) => ({
        gap_id: x.gap_id,
        direction: x.direction,
        subject: x.subject,
        statement: x.statement,
      })),
    };
  }

  if (want.oscal) {
    // Point-in-time package: latest assertion per control (here, the latest cycle
    // for the one instrumented control), plus the raw variance events for the
    // POA&M. This mirrors `grc emit` / buildPackage exactly.
    const latestByControl = new Map();
    for (const a of stripped) {
      const prev = latestByControl.get(a.control_id);
      if (!prev || new Date(a.as_of) > new Date(prev.as_of)) latestByControl.set(a.control_id, a);
    }
    const latest = [...latestByControl.values()];
    const asOf = latest.map((a) => a.as_of).sort().at(-1) ?? null;
    const docs = buildPackage({ controls, assertions: latest, variance: pipe.events, asOf });

    const files = Object.entries(docs)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, doc]) => {
        const body = serialize(doc);
        const model = modelLabel(doc, name);
        return {
          name,
          model,
          bytes: Buffer.byteLength(body, 'utf8'),
          preview: body.length > 1400 ? body.slice(0, 1400) + `\n… (${Buffer.byteLength(body, 'utf8')} bytes total)` : body,
        };
      });
    result.oscal = { files, count: files.length };
  }

  await pipe.warehouse.close();

  result.durationMs = Date.now() - started;
  process.stdout.write(JSON.stringify(result));
}

/** The OSCAL root object key is the model name (e.g. "assessment-results"). */
function modelLabel(doc, name) {
  const key = Object.keys(doc ?? {})[0] ?? name.replace(/\.json$/, '');
  return key
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ error: err?.stack ?? err?.message ?? String(err) }));
  process.exit(1);
});
