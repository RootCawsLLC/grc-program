import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collect, liveReadiness, readFixtureCycles } from '../src/collect.mjs';
import { modelCoverage, modelNameFor, readManifest } from '../src/assert.mjs';
import { assessDrift } from '../src/drift.mjs';
import { route } from '../src/route.mjs';

const tmp = () => mkdtemp(join(tmpdir(), 'ccm-'));

// ── collect: an empty collection must never look like a successful one ───────────────────────

test('live collection REFUSES without credentials, and names each one', async () => {
  await assert.rejects(
    () => collect({ fixture: false, env: {} }),
    (err) => {
      assert.match(err.message, /refusing to collect/);
      assert.match(err.message, /aws: missing AWS_ACCESS_KEY_ID/);
      assert.match(err.message, /idp: missing IDP_TOKEN/);
      return true;
    },
  );
});

test('there is NO fallback from live to fixture', async () => {
  // A scheduled run that quietly collected synthetic data when its credentials lapsed would go
  // green having measured nothing, and the first real failure would look identical to every fake
  // success before it. The refusal says so, where somebody will read it.
  await assert.rejects(() => collect({ fixture: false, env: {} }), /no fallback to fixtures/);
  await assert.rejects(() => collect({ fixture: false, env: {} }), /collect --fixture/);
});

test('live collection refuses even WITH credentials, because no client is wired', async () => {
  // The honest state: credentials existing is not the same as a collector that has ever
  // authenticated. Pretending otherwise reports a population nobody read.
  const env = { AWS_ACCESS_KEY_ID: 'a', AWS_SESSION_TOKEN: 'b', IDP_TOKEN: 'c', GH_TOKEN: 'd' };
  assert.deepEqual(liveReadiness(env).filter((r) => !r.ready), []);
  await assert.rejects(() => collect({ fixture: false, env }), /live collection is not wired/);
  await assert.rejects(() => collect({ fixture: false, env }), /BUILD-ORDER B2/);
});

test('an empty secret counts as absent, not present', () => {
  const [aws] = liveReadiness({ AWS_ACCESS_KEY_ID: '', AWS_SESSION_TOKEN: '   ' });
  assert.equal(aws.ready, false);
  assert.deepEqual(aws.missing, ['AWS_ACCESS_KEY_ID', 'AWS_SESSION_TOKEN']);
});

test('an unstamped fixture file is refused at the door', async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, 'c.json'), JSON.stringify({ as_of: '2026-01-01T00:00:00Z', tables: {} }));
    await assert.rejects(() => readFixtureCycles(dir), /missing the "NOT REAL EVIDENCE" stamp/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a zero-row collection is refused unless empty is declared to be the answer', async () => {
  // A collector that legitimately found nothing and one whose token silently expired both return
  // zero rows. Downstream every control becomes 0/0, which renders as "nothing failing".
  const dir = await tmp();
  const wh = join(dir, 'w.duckdb');
  try {
    await mkdir(join(dir, 'fx'), { recursive: true });
    await writeFile(join(dir, 'fx', 'empty.json'), JSON.stringify({
      _stamp: 'NOT REAL EVIDENCE', as_of: '2026-01-01T00:00:00Z',
      tables: { landing_aws_credential_report: [], landing_aws_org_accounts: [], landing_ticket_first_touch: [] },
    }));
    await assert.rejects(
      () => collect({ fixture: true, fixtureDir: join(dir, 'fx'), warehousePath: wh }),
      /refusing to record a zero-row collection/,
    );
    // Declared, it is allowed — and the manifest records that it was empty on purpose.
    const m = await collect({ fixture: true, fixtureDir: join(dir, 'fx'), warehousePath: wh, allowEmpty: true });
    assert.equal(m.total_rows, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a fixture collection stamps its manifest', async () => {
  const dir = await tmp();
  try {
    const m = await collect({ fixture: true, warehousePath: join(dir, 'w.duckdb') });
    assert.equal(m.fixture, true);
    assert.equal(m.mode, 'fixture');
    assert.match(m.note, /NOT REAL EVIDENCE/);
    assert.ok(m.total_rows > 0);
    assert.equal(m.cycles.length, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ── assert ───────────────────────────────────────────────────────────────────────────────────

test('assert refuses without a collection manifest', async () => {
  await assert.rejects(() => readManifest(join(tmpdir(), 'definitely-not-here-9931.json')), /Run `collect` first/);
});

test('model coverage reports what is UNMEASURED rather than asserting over the subset silently', async () => {
  const { loadYamlDir } = await import('../src/validate.mjs');
  const controls = await loadYamlDir('controls');
  const { modelled, unmodelled } = modelCoverage(controls, '.');
  assert.ok(modelled.length > 0);
  assert.ok(unmodelled.length > 0, 'the seed inventory has controls with no model');
  assert.equal(modelled.length + unmodelled.length, controls.length);
  assert.equal(modelNameFor('ctl.iam.cloud-platform.mfa'), 'ctl_iam_cloud_platform_mfa');
});

// ── drift: the denominator gate ──────────────────────────────────────────────────────────────

const a = (control_id, as_of, total, failing = []) => ({
  control_id, as_of, total, passing_count: total - failing.length, failing_count: failing.length,
  failing: failing.map((s) => (typeof s === 'string' ? { subject_id: s, reason: 'r', first_observed: as_of } : s)),
  population_definition: 'p', source_system: 's', query_ref: 'q', coverage_basis: 'c', confidence_tier: 4,
});

test('a single observation is NOT "no drift"', () => {
  // Saying "no drift" would imply a comparison that never happened — the same conflation of
  // "checked and fine" with "not checked" this repo refuses everywhere else.
  const r = assessDrift({ assertions: [a('ctl.a.b.c', '2026-01-01T00:00:00Z', 10)] });
  assert.equal(r.drifted.length, 0);
  assert.equal(r.incomparable.length, 1);
  assert.equal(r.controls[0].comparable, false);
  assert.match(r.summary, /That is not "no drift"/);
});

test('a shrinking denominator is caught, and holds the cycle', () => {
  // 40 of 45 reads better than 40 of 60 and it is the same forty.
  const r = assessDrift({ assertions: [
    a('ctl.a.b.c', '2026-01-01T00:00:00Z', 60),
    a('ctl.a.b.c', '2026-02-01T00:00:00Z', 45),
  ] });
  assert.equal(r.drifted.length, 1);
  assert.equal(r.hold, true);
  assert.match(r.drifted[0].reason, /shrank 25\.0%/);
  assert.match(r.summary, /Investigate the asset inventory before trusting any pass rate/);
});

test('movement inside tolerance does not hold the cycle', () => {
  const r = assessDrift({ assertions: [
    a('ctl.a.b.c', '2026-01-01T00:00:00Z', 100),
    a('ctl.a.b.c', '2026-02-01T00:00:00Z', 95),
  ] });
  assert.equal(r.hold, false);
});

// ── route: the triage rules, implemented ─────────────────────────────────────────────────────

const ctl = (over = {}) => ({
  control_id: 'ctl.a.b.c', owner: 'platform-engineering', scenarios: ['scn.x.y'],
  population_definition: 'every widget', ...over,
});

test('routing is HELD when the denominator moved — before any item is produced', () => {
  // A hold that arrives as one line above forty tickets is a hold nobody acts on.
  const assertions = [a('ctl.a.b.c', '2026-01-01T00:00:00Z', 60, ['s1']), a('ctl.a.b.c', '2026-02-01T00:00:00Z', 45, ['s1'])];
  const drift = assessDrift({ assertions });
  const r = route({ assertions, controls: [ctl()], drift });
  assert.equal(r.held, true);
  assert.deepEqual(r.items, []);
  assert.match(r.reason, /asset inventory failed before the controls did/);
});

test('items are deduplicated by SUBJECT and keep a stable id across cycles', () => {
  const assertions = [
    a('ctl.a.b.c', '2026-01-01T00:00:00Z', 10, ['s1']),
    a('ctl.a.b.c', '2026-02-01T00:00:00Z', 10, ['s1', 's2']),
  ];
  const r = route({ assertions, controls: [ctl()], drift: assessDrift({ assertions }) });
  assert.equal(r.items.length, 2);
  assert.deepEqual(r.items.map((i) => i.item_id), ['ctl.a.b.c|s1', 'ctl.a.b.c|s2']);
  assert.equal(r.items.find((i) => i.subject_id === 's1').status, 'continuing');
  assert.equal(r.items.find((i) => i.subject_id === 's2').status, 'new');
  // One summary per control, never per subject.
  assert.equal(r.summaries.length, 1);
  assert.equal(r.summaries[0].new_this_cycle, 1);
});

test('age is measured from first_observed, not from detection', () => {
  // A subject failing since March and noticed on Tuesday is a DETECTION problem. Reporting it as
  // two days old hides exactly that.
  const assertions = [
    a('ctl.a.b.c', '2026-03-01T00:00:00Z', 10),
    a('ctl.a.b.c', '2026-03-31T00:00:00Z', 10, [{ subject_id: 's1', reason: 'r', first_observed: '2026-03-01T00:00:00Z' }]),
  ];
  const r = route({ assertions, controls: [ctl()], drift: assessDrift({ assertions }) });
  assert.equal(r.items[0].failing_for_days, 30);
});

test('three consecutive cycles escalates to root cause instead of re-ticketing', () => {
  const assertions = ['2026-01-01', '2026-02-01', '2026-03-01'].map((d) => a('ctl.a.b.c', `${d}T00:00:00Z`, 10, ['s1']));
  const r = route({ assertions, controls: [ctl()], drift: assessDrift({ assertions }) });
  const item = r.items[0];
  assert.equal(item.consecutive_cycles, 3);
  assert.equal(item.escalate_to_root_cause, true);
  assert.match(item.escalation_note, /variance-management or decision-support failure/);
  assert.match(item.escalation_note, /Stop opening tickets/);
});

test('a streak broken by a passing cycle resets', () => {
  const assertions = [
    a('ctl.a.b.c', '2026-01-01T00:00:00Z', 10, ['s1']),
    a('ctl.a.b.c', '2026-02-01T00:00:00Z', 10),          // passed
    a('ctl.a.b.c', '2026-03-01T00:00:00Z', 10, ['s1']),  // failing again
  ];
  const r = route({ assertions, controls: [ctl()], drift: assessDrift({ assertions }) });
  assert.equal(r.items[0].consecutive_cycles, 1);
  assert.equal(r.items[0].escalate_to_root_cause, false);
});

test('a documented exception travels with the item but does not remove it', () => {
  // An exception reduces coverage; it does not remove the subject from the work queue.
  const assertions = [a('ctl.a.b.c', '2026-01-01T00:00:00Z', 10, ['s1'])];
  const exceptions = [{ exception_id: 'EX-0009', control_id: 'ctl.a.b.c', subjects: ['s1'], expires_on: '2027-01-01' }];
  const r = route({ assertions, controls: [ctl()], exceptions, drift: assessDrift({ assertions }) });
  assert.equal(r.items.length, 1);
  assert.deepEqual(r.items[0].exception, { exception_id: 'EX-0009', expires_on: '2027-01-01' });
});

test('nothing failing routes nothing, and says so', () => {
  const assertions = [a('ctl.a.b.c', '2026-01-01T00:00:00Z', 10)];
  const r = route({ assertions, controls: [ctl()], drift: assessDrift({ assertions }) });
  assert.deepEqual(r.items, []);
  assert.match(r.note, /Nothing failing/);
});

test('an assertion naming an unknown control is an error, not a silent skip', () => {
  const assertions = [a('ctl.nope.nope.nope', '2026-01-01T00:00:00Z', 1, ['s1'])];
  assert.throws(() => route({ assertions, controls: [ctl()], drift: { hold: false } }), /unknown control/);
});
