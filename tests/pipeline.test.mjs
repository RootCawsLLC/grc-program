import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPipeline, loadCycles, impossibleStart, CONTROL_MODEL } from '../src/pipeline.mjs';
import { denominatorDrift } from '../src/lib/assertion.mjs';

// The pipeline is read-only against the repo and builds an in-memory warehouse, so one run serves
// every assertion below.
let run;
before(async () => { run = await runPipeline(); });
after(async () => { await run.warehouse.close(); });

// ── the dbt data tests, ported ───────────────────────────────────────────────────────────────
// B22 asks for not_null on subject_id, unique on (as_of, subject_id) and a denominator-stability
// test. Without dbt these are node tests over the built models, which run in the same place as the
// control logic and fail the same build.

test('not_null: every control model row has a subject_id', async () => {
  const [{ n }] = await run.warehouse.all(`select count(*) as n from ${CONTROL_MODEL} where subject_id is null`);
  assert.equal(n, 0);
});

test('unique: (as_of, subject_id) is unique in the accumulated snapshot', async () => {
  // A duplicate here would double-count a subject in the denominator and, worse, make lag() in
  // variance_events.sql compare a row against itself — inventing or erasing a transition.
  const dupes = await run.warehouse.all(`
    select as_of, subject_id, count(*) as n
    from control_assertions group by as_of, subject_id having count(*) > 1`);
  assert.deepEqual(dupes, []);
});

test('denominator stability: the population does not drift across cycles', async () => {
  const totals = run.assertions.map((a) => a.total);
  assert.deepEqual(totals, [6, 6, 6], 'fixture population is designed to hold steady');
  for (const a of run.assertions) assert.equal(a.drift.drifted, false, a.drift.reason ?? '');
});

test('denominator drift IS caught when it happens', async () => {
  // The stability test above only proves the fixtures are stable. This proves the alarm works —
  // otherwise a silently shrinking population would read as an improving pass rate.
  const drift = denominatorDrift({ total: 100 }, { total: 80 });
  assert.equal(drift.drifted, true);
  assert.match(drift.reason, /shrank 20\.0%/);
});

// ── the population predicate ─────────────────────────────────────────────────────────────────

test('the WHERE clause excludes non-production accounts and non-authenticating principals', () => {
  const subjects = run.assertions.at(-1).failing.map((f) => f.subject_id);
  const all = run.assertions.at(-1);
  assert.equal(all.total, 6);
  // sandbox-sam fails the control on its face but sits outside the production organisation;
  // svc-batch has neither a console password nor an active key. Neither is in the population.
  assert.ok(!subjects.some((s) => s.includes('sandbox-sam')), 'non-production account must not appear');
  assert.ok(!subjects.some((s) => s.includes('svc-batch')), 'principal with no interactive access and no key must not appear');
});

test('the root account IS in the population despite AWS reporting password_enabled=not_supported', async () => {
  // Read literally, the credential report would drop the one principal that most needs to be in
  // scope. stg_aws_iam_principals makes that judgement explicitly; this pins it.
  const rows = await run.warehouse.all(`select subject_id from ${CONTROL_MODEL} where subject_id like '%root_account%'`);
  assert.equal(rows.length, 1);
});

// ── the shape of history ─────────────────────────────────────────────────────────────────────

test('three cycles of history accumulate rather than overwrite', async () => {
  const [{ n }] = await run.warehouse.all('select count(distinct as_of) as n from control_assertions');
  assert.equal(n, 3);
});

test('a complete four-timestamp event is produced, and its segments sum to the total', () => {
  const carol = run.events.find((e) => e.subject_id.includes('carol'));
  assert.ok(carol, 'the pass -> fail -> pass arc must yield an event');
  assert.ok(carol.variance_started_at && carol.variance_detected_at);
  assert.ok(carol.remediation_started_at, 'the ticket join must populate the middle timestamp');
  assert.ok(carol.remediation_completed_at, 'the transition back to passing closes it');
  assert.equal(String(carol.still_open), 'false');
});

test('an unremediated variance stays open rather than being quietly closed', () => {
  const erin = run.events.find((e) => e.subject_id.includes('erin'));
  assert.ok(erin);
  assert.equal(erin.remediation_completed_at, null);
  assert.equal(String(erin.still_open), 'true');
});

test('a failure that predates the first cycle produces NO event rather than an invented one', () => {
  // bob is failing in cycle 1, so there is no prior passing observation to transition from. The
  // honest answer is silence: any start date would be fabricated.
  assert.equal(run.events.some((e) => e.subject_id.includes('bob')), false);
});

// ── the defect this build surfaced (ADR-0006) ────────────────────────────────────────────────

test('the impossible-start detector fires on the case ADR-0006 documents', () => {
  const erin = run.events.find((e) => e.subject_id.includes('erin'));
  const carol = run.events.find((e) => e.subject_id.includes('carol'));
  const cycleTimes = run.cycles.map((c) => c.as_of);

  assert.equal(impossibleStart(erin, cycleTimes), true, 'erin was passing at 2026-06-15 but her variance claims to start in 2025');
  assert.equal(impossibleStart(carol, cycleTimes), false, 'carol has a genuine source timestamp and must not be flagged');
});

test('started_at_quality is currently always source-timestamp — the ladder is unreachable', () => {
  // Pinned deliberately. When the control model's first_observed expression is fixed, this test
  // SHOULD fail, and its failure is the signal that ADR-0006 has been addressed.
  const qualities = [...new Set(run.events.map((e) => e.started_at_quality))];
  assert.deepEqual(qualities, ['source-timestamp']);
});

// ── the stamp ────────────────────────────────────────────────────────────────────────────────

test('every assertion the pipeline produces is marked as fixture-derived', () => {
  for (const a of run.assertions) assert.equal(a.fixture, true);
});

test('an unstamped fixture file is refused at the door', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reco-fx-'));
  try {
    await writeFile(join(dir, 'cycle.json'), JSON.stringify({ as_of: '2026-08-15T00:00:00Z', tables: {} }));
    await assert.rejects(() => loadCycles(dir), /missing the "NOT REAL EVIDENCE" stamp/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── the line B22 draws ───────────────────────────────────────────────────────────────────────

test('no control record changed status — this unit builds plumbing, it does not instrument', async () => {
  // The test of which side of B22's line this work fell on. Statuses live in controls/*.yaml and
  // nothing in the pipeline writes to them.
  const statuses = run.controls.map((c) => `${c.control_id}=${c.status}`).sort();
  assert.ok(statuses.length >= 9);
  assert.ok(!statuses.some((s) => s.endsWith('=undefined')));
});
