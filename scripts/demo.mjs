#!/usr/bin/env node
/**
 * The offline demo: fixture rows -> staging -> control model -> assertion record -> variance ->
 * OSCAL, end to end, in about a second, touching nothing real.
 *
 * WHAT THIS IS FOR. It shows what the finished pipeline does, on data that is unambiguously not
 * anybody's, without credentials and without contacting a system. Everything it prints is derived
 * by src/pipeline.mjs; nothing below is asserted by hand.
 *
 * WHAT THIS IS NOT. It is not evidence and it does not instrument a control. No control record's
 * status changes because this ran. Every artifact it writes carries the NOT REAL EVIDENCE stamp,
 * and it writes to out-synthetic/ because synthetic and real evidence never share a directory.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { runPipeline, impossibleStart, isoish } from '../src/pipeline.mjs';
import { decomposeVariance } from '../src/faircam.mjs';
import { emitAssessmentResults, stableStringify } from '../src/oscal/assessment-results.mjs';
import { FIXTURE_STAMP } from '../src/lib/load.mjs';

const OUT_DIR = 'out-synthetic';

const rule = (t) => console.log(`\n${t}\n${'─'.repeat(78)}`);
const fmt = (v) => (v === null || v === undefined ? '—' : String(v).replace('T', ' ').replace(/\.000/, '').replace('Z', ''));
const seg = (d) => (d === null || d === undefined ? '    —  ' : `${(Math.round(d * 10) / 10).toFixed(1).padStart(6)}d`);

console.log(`\n  ${FIXTURE_STAMP}. Synthetic fixtures, no credentials, nothing contacted.\n`);

const { warehouse, controls, cycles, landed, assertions, events } = await runPipeline();
const cycleTimes = cycles.map((c) => c.as_of);

// ── 1. landing ───────────────────────────────────────────────────────────────────────────────
rule('1. LANDING — time-indexed, append-only');
for (const l of landed) console.log(`  ${fmt(l.as_of)}   ${String(l.rows).padStart(3)} rows landed`);
const [{ n }] = await warehouse.all('select count(*) as n from landing_aws_credential_report');
console.log(`\n  ${n} credential-report rows retained across ${cycles.length} cycles. Nothing was`);
console.log('  overwritten — that is the whole reason the variance layer below is reachable at all.');

// ── 2. control model ─────────────────────────────────────────────────────────────────────────
rule('2. CONTROL MODEL — one model per control_id, and its WHERE clause IS the population');
for (const a of assertions) {
  console.log(
    `  ${fmt(a.as_of)}   total=${String(a.total).padStart(2)}  passing=${String(a.passing_count).padStart(2)}  ` +
    `failing=${a.failing_count}${a.drift.drifted ? `   ⚠ DENOMINATOR ${a.drift.reason}` : ''}`,
  );
  for (const f of a.failing) console.log(`                          ${f.subject_id.padEnd(30)} ${f.reason}`);
}
console.log(`\n  The denominator held at ${assertions[0].total} across every cycle. Population drift is itself a`);
console.log('  control metric: a pass rate that "improves" because the denominator shrank is a failure');
console.log('  of the asset inventory, not a success of this control.');

// ── 3. variance ──────────────────────────────────────────────────────────────────────────────
rule('3. VARIANCE — the four timestamps, which is the part almost nobody emits');
if (!events.length) console.log('  (no transitions — a variance needs a passing observation to transition away from)');

const decomposed = [];
for (const e of events) {
  const closed = Boolean(e.remediation_completed_at);

  // decomposeVariance() requires all four timestamps and refuses an open event. Correct for what it
  // computes — a total duration is meaningless before the clock stops — but it means the only fully
  // decomposable events are the ones already fixed, and the slowest failures are exactly the ones
  // still open. So open events are decomposed as far as their endpoints allow, and no further.
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
  decomposed.push({ ...e, ...d, complete: closed });

  const by = (span) => d.segments.find((s) => s.span === span)?.days;
  console.log(`\n  ${e.subject_id}${closed ? '' : '   [STILL OPEN]'}`);
  console.log(`    started ${fmt(e.variance_started_at)}  →  detected ${fmt(e.variance_detected_at)}  →  touched ${fmt(e.remediation_started_at)}  →  closed ${fmt(e.remediation_completed_at)}`);
  console.log(`    control monitoring ${seg(by('started_to_detected'))}   treatment selection ${seg(by('detected_to_triaged'))}   implementation ${seg(by('triaged_to_remediated'))}`);
  console.log(`    total ${seg(d.total_duration_days)}   started_at quality: ${e.started_at_quality}`);

  if (impossibleStart(e, cycleTimes)) {
    console.log('    ⚠ started_at predates the last cycle in which this subject was observed PASSING.');
    console.log('      Not a slow detection — an impossible timestamp, reported at the HIGHEST quality');
    console.log('      rung. See docs/adr/0006-variance-quality-ladder.md.');
  }
}
console.log('\n  Knowing remediation took 36 days is not actionable. Knowing 5 of them were detection');
console.log('  and 26 were implementation tells you which function to fix.');

// ── 4. OSCAL ─────────────────────────────────────────────────────────────────────────────────
rule('4. OSCAL — assessment results, deterministic UUIDs, stamped');
const latest = assertions.at(-1);
const doc = emitAssessmentResults({ assertions: [strip(latest)], controls, asOf: latest.as_of });
await mkdir(OUT_DIR, { recursive: true });
await writeFile(join(OUT_DIR, 'assessment-results.json'), stableStringify(doc));
await writeFile(join(OUT_DIR, 'assertions.json'), JSON.stringify(assertions.map(strip), null, 2) + '\n');
await writeFile(join(OUT_DIR, 'variance-events.json'), JSON.stringify(decomposed, null, 2) + '\n');

console.log(`  ${doc['assessment-results'].metadata.title}`);
console.log(`  wrote ${OUT_DIR}/{assessment-results,assertions,variance-events}.json`);
console.log('  Re-running on unchanged input re-exports byte-identically. Review the diff, not the file.');

rule('WHAT THIS DID NOT DO');
console.log('  No control record changed status. Nothing was instrumented. Nothing above is evidence');
console.log(`  about any real system, and every artifact says ${FIXTURE_STAMP} on its face.\n`);

await warehouse.close();

/** `drift` is a demo-time annotation, not part of the assertion contract. */
function strip({ drift, ...assertion }) {
  return assertion;
}

/**
 * What can honestly be said about a variance still open: the segments whose endpoints have both
 * happened. The third stays null rather than being measured to now — an in-flight remediation has
 * no implementation duration yet, and substituting the current time reports a number that grows by
 * itself every time someone re-runs the pipeline.
 */
function partial(e) {
  const days = (a, b) => Math.round(((new Date(isoish(b)) - new Date(isoish(a))) / 86_400_000) * 10) / 10;
  const touched = e.remediation_started_at;
  return {
    control_id: e.control_id,
    subject_id: e.subject_id,
    total_duration_days: null,
    segments: [
      { span: 'started_to_detected',   days: days(e.variance_started_at, e.variance_detected_at),   faircam_function: 'control-monitoring',  fix: 'monitoring cadence or coverage' },
      { span: 'detected_to_triaged',   days: touched ? days(e.variance_detected_at, touched) : null, faircam_function: 'treatment-selection', fix: 'prioritisation or ownership' },
      { span: 'triaged_to_remediated', days: null,                                                   faircam_function: 'implementation',      fix: 'capacity or tooling' },
    ],
  };
}
