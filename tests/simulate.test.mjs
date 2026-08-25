import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  seeded, triangular, poisson, percentile, summarise, exceedanceCurve,
  assertCalibrated, simulate, rankByRosi, CALIBRATED, POISSON_EXACT_LIMIT,
} from '../src/simulate.mjs';
import { loadYamlDir } from '../src/validate.mjs';

let fixtures, register, controls;
before(async () => {
  fixtures = await loadYamlDir('fixtures/scenarios');
  register = await loadYamlDir('scenarios');
  controls = await loadYamlDir('controls');
});

// ── the refusal, which is the point of the unit ──────────────────────────────────────────────

test('every scenario in the real register is refused, and every parameter is NAMED', () => {
  // Named, not counted. "3 scenarios are uncalibrated" sends someone hunting; naming the scenario,
  // the parameter and its declared source is what you take to the workshop.
  let err;
  try { assertCalibrated(register); } catch (e) { err = e; }
  assert.ok(err, 'the real register must be refused');
  assert.match(err.message, /refusing to simulate/);
  assert.equal(err.problems.length, register.length * 2, 'both parameters of every scenario');
  for (const s of register) {
    assert.match(err.message, new RegExp(s.scenario_id.replace(/\./g, '\\.')), `${s.scenario_id} must be named`);
  }
  assert.match(err.message, /loss_event_frequency/);
  assert.match(err.message, /primary_loss_magnitude/);
  // The reasoning has to travel with the refusal, or it reads as a bug to be worked around.
  assert.match(err.message, /worse than no curve/);
  assert.match(err.message, /_CALIBRATION-STATUS\.md/);
});

test('simulate() itself refuses — the guard is not only in the CLI', () => {
  assert.throws(() => simulate({ scenarios: register, trials: 10 }), /refusing to simulate/);
});

test('only real derivation levels count as calibrated', () => {
  assert.deepEqual([...CALIBRATED].sort(), ['calibrated-estimate', 'derived', 'measured']);
  const mk = (level) => [{
    scenario_id: 'scn.t.t',
    parameters: { loss_event_frequency: { min: 0, most_likely: 1, max: 2, provenance: { derivation_level: level, confidence_tier: 3, source: 's' } } },
  }];
  for (const good of CALIBRATED) assert.doesNotThrow(() => assertCalibrated(mk(good)));
  for (const bad of ['assumed', undefined, 'guessed']) assert.throws(() => assertCalibrated(mk(bad)));
});

test('the calibrated fixtures pass the same gate', () => {
  assert.doesNotThrow(() => assertCalibrated(fixtures));
  assert.equal(fixtures.length, 2);
});

// ── the fixtures are stamped, and the stamp cannot be quietly dropped ─────────────────────────

test('every fixture scenario carries the stamp in its own prose', () => {
  // schemas/scenario.schema.json sets additionalProperties:false, so there is nowhere to put a
  // `_stamp` field. The stamp rides in the statement instead, which is stronger: removing it means
  // editing the sentence a reader sees, not deleting a key they never look at.
  for (const f of fixtures) {
    assert.match(f.statement, /NOT REAL EVIDENCE/, `${f.scenario_id} statement must be stamped`);
    for (const [name, p] of Object.entries(f.parameters)) {
      assert.match(p.provenance.source, /FIXTURE/, `${f.scenario_id} ${name} source must say it is invented`);
    }
  }
});

test('the fixture scenarios validate against the real scenario schema', async () => {
  // `npm run validate` only scans scenarios/, so a malformed fixture would otherwise go unchecked
  // until it produced a confusing engine failure.
  const { default: Ajv } = await import('ajv/dist/2020.js');
  const { default: addFormats } = await import('ajv-formats');
  const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));
  const validate = ajv.compile(JSON.parse(readFileSync('schemas/scenario.schema.json', 'utf8')));
  for (const f of fixtures) {
    const { _file, ...record } = f;
    assert.ok(validate(record), `${f.scenario_id}: ${JSON.stringify(validate.errors)}`);
  }
});

// ── determinism ──────────────────────────────────────────────────────────────────────────────

test('the same seed gives the same answer, and a different seed does not', () => {
  // Every other artifact here is byte-reproducible. A risk number that moved between runs would be
  // the one figure a reader had to take on trust, and it could not be diffed or argued with.
  const a = simulate({ scenarios: fixtures, trials: 500, seed: 1 });
  const b = simulate({ scenarios: fixtures, trials: 500, seed: 1 });
  const c = simulate({ scenarios: fixtures, trials: 500, seed: 2 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.aggregate.summary, c.aggregate.summary);
});

// ── sampling primitives ──────────────────────────────────────────────────────────────────────

test('triangular stays within its bounds and handles the degenerate case', () => {
  const rand = seeded(7);
  const t = { min: 10, most_likely: 25, max: 100 };
  for (let i = 0; i < 2000; i += 1) {
    const v = triangular(rand, t);
    assert.ok(v >= t.min && v <= t.max, `${v} escaped [${t.min}, ${t.max}]`);
  }
  assert.equal(triangular(rand, { min: 5, most_likely: 5, max: 5 }), 5, 'no division by zero');
});

test('poisson is unbiased on both sides of the exact/approximate threshold', () => {
  const meanOf = (lambda, n = 20000) => {
    const rand = seeded(99);
    let total = 0;
    for (let i = 0; i < n; i += 1) total += poisson(rand, lambda);
    return total / n;
  };
  assert.equal(poisson(seeded(1), 0), 0, 'a zero rate produces no events');
  assert.equal(poisson(seeded(1), -5), 0, 'a negative rate is not an error, it is no events');
  for (const lambda of [0.2, 3, 25]) {
    assert.ok(Math.abs(meanOf(lambda) - lambda) < lambda * 0.1, `exact branch biased at lambda=${lambda}`);
  }
  const big = POISSON_EXACT_LIMIT + 20;
  assert.ok(Math.abs(meanOf(big) - big) < big * 0.05, 'normal approximation biased');
});

test('percentile is by nearest rank and survives the edges', () => {
  const s = [1, 2, 3, 4, 5];
  assert.equal(percentile(s, 0), 1);
  assert.equal(percentile(s, 100), 5);
  assert.equal(percentile(s, 50), 3);
  assert.equal(percentile([], 50), 0);
});

// ── the distribution, never a bare expected value ────────────────────────────────────────────

test('summarise reports quiet_years, which is what a mean hides', () => {
  // A loss of $10M once a decade and $1M every year have the same expected loss and are not the
  // same risk. quiet_years is the number that distinguishes them.
  const s = summarise([0, 0, 0, 0, 0, 0, 0, 0, 0, 10_000_000]);
  assert.equal(s.mean, 1_000_000);
  assert.equal(s.p50, 0);
  assert.equal(s.quiet_years, 0.9);
  assert.equal(s.max, 10_000_000);
});

test('the two fixtures have similar means and completely different shapes', () => {
  // The reason both exist. If the engine reported a mean alone they would look interchangeable.
  const r = simulate({ scenarios: fixtures, trials: 4000, seed: 42 });
  const freq = r.scenarios.find((s) => s.scenario_id === 'scn.fixture.frequency-driven').summary;
  const tail = r.scenarios.find((s) => s.scenario_id === 'scn.fixture.tail-driven').summary;

  assert.ok(freq.quiet_years < 0.35, 'the frequency-driven scenario should rarely be quiet');
  assert.ok(tail.quiet_years > 0.6, 'the tail-driven scenario should usually be quiet');
  assert.ok(tail.p50 < freq.p50, 'medians must separate even where means do not');
  assert.ok(tail.p99 > freq.p99 * 2, 'the tail scenario must dominate at p99');
});

test('the exceedance curve is monotonic — probability falls as loss rises', () => {
  const r = simulate({ scenarios: fixtures, trials: 2000, seed: 5 });
  const curve = r.aggregate.exceedance_curve;
  assert.ok(curve.length > 5);
  for (let i = 1; i < curve.length; i += 1) {
    assert.ok(curve[i].loss >= curve[i - 1].loss, 'loss must be non-decreasing');
    assert.ok(curve[i].probability_of_exceeding <= curve[i - 1].probability_of_exceeding, 'probability must be non-increasing');
  }
  assert.ok(curve.every((p) => p.probability_of_exceeding >= 0 && p.probability_of_exceeding <= 1));
});

// ── the aggregate ────────────────────────────────────────────────────────────────────────────

test('the aggregate is a percentile of the summed year, NOT a sum of percentiles', () => {
  // These are different numbers and the second one is wrong: summing per-scenario p90s assumes
  // every scenario has its bad year simultaneously.
  const r = simulate({ scenarios: fixtures, trials: 6000, seed: 11 });
  const sumOfP90s = r.scenarios.reduce((n, s) => n + s.summary.p90, 0);
  assert.notEqual(r.aggregate.summary.p90, sumOfP90s);
  assert.ok(r.aggregate.summary.p90 < sumOfP90s, 'independent scenarios rarely peak together');

  // The mean IS additive, and that is the check that the totals are actually being summed.
  const sumOfMeans = r.scenarios.reduce((n, s) => n + s.summary.mean, 0);
  assert.ok(Math.abs(r.aggregate.summary.mean - sumOfMeans) < sumOfMeans * 0.02);
});

test('the aggregate states the independence assumption in its own output', () => {
  const r = simulate({ scenarios: fixtures, trials: 100, seed: 1 });
  assert.match(r.aggregate.independence_assumption, /INDEPENDENT/);
  assert.match(r.aggregate.independence_assumption, /real tail is fatter/);
  assert.match(r.aggregate.independence_assumption, /meaningless/);
});

test('confidence tier is carried through as the WEAKEST input, not an average', () => {
  // Averaging tiers would let a tier-4 parameter launder a tier-1 one. The weakest input governs
  // what the output is worth.
  const r = simulate({ scenarios: fixtures, trials: 100, seed: 1 });
  assert.equal(r.scenarios.find((s) => s.scenario_id === 'scn.fixture.frequency-driven').confidence_tier, 3);
  assert.equal(r.scenarios.find((s) => s.scenario_id === 'scn.fixture.tail-driven').confidence_tier, 2);
  assert.equal(r.aggregate.confidence_tier, 2, 'the aggregate is only as good as its worst parameter');
});

// ── input validation ─────────────────────────────────────────────────────────────────────────

test('a malformed three-point estimate is refused, not silently sampled', () => {
  const bad = (over) => [{
    scenario_id: 'scn.t.t',
    parameters: {
      loss_event_frequency: { min: 0, most_likely: 1, max: 2, provenance: { derivation_level: 'measured', confidence_tier: 4, source: 's' }, ...over },
      primary_loss_magnitude: { min: 0, most_likely: 1, max: 2, provenance: { derivation_level: 'measured', confidence_tier: 4, source: 's' } },
    },
  }];
  assert.throws(() => simulate({ scenarios: bad({ most_likely: 5 }), trials: 10 }), /min <= most_likely <= max/);
  assert.throws(() => simulate({ scenarios: bad({ min: -1 }), trials: 10 }), /negative minimum/);
});

// ── ROSI ─────────────────────────────────────────────────────────────────────────────────────

test('nothing in the real inventory is rankable, and the reasons are specific', () => {
  // Both ROSI inputs are genuinely absent: no schema field records control efficacy, and every
  // control carries cost.opex_annual: 0 with a PLACEHOLDER basis. Reporting a rank anyway would
  // require inventing one of them.
  const r = simulate({ scenarios: fixtures, trials: 500, seed: 3 });
  const ranking = rankByRosi({ result: r, controls });

  assert.equal(ranking.ranked.length, 0);
  assert.equal(ranking.unrankable.length, controls.length);
  assert.match(ranking.note, /NOTHING IS RANKABLE/);

  const named = ranking.unrankable.find((u) => u.control_id === 'ctl.iam.cloud-platform.mfa');
  assert.match(named.reason, /no efficacy parameter/);
  assert.match(named.reason, /ADR-0004/);
  assert.ok(named.ale_before > 0, 'the ALE it would have reduced is still reported');

  const uncovered = ranking.unrankable.find((u) => u.control_id === 'ctl.appsec.ci-cd.branch-protection');
  assert.match(uncovered.reason, /no simulated scenario names this control/);
});

test('ROSI ranks once efficacy and cost are both supplied', () => {
  const r = simulate({ scenarios: fixtures, trials: 2000, seed: 3 });
  const priced = controls.map((c) =>
    c.control_id === 'ctl.iam.cloud-platform.mfa' ? { ...c, cost: { ...c.cost, opex_annual: 120_000 } } : c,
  );
  const ranking = rankByRosi({ result: r, controls: priced, efficacy: { 'ctl.iam.cloud-platform.mfa': 0.6 } });

  assert.equal(ranking.ranked.length, 1);
  const row = ranking.ranked[0];
  assert.equal(row.control_id, 'ctl.iam.cloud-platform.mfa');
  assert.ok(row.ale_after < row.ale_before);
  assert.ok(row.rosi > 0);
  assert.equal(row.annual_cost, 120_000);
  assert.equal(ranking.note, undefined);
});

test('a priced control with no efficacy is still unrankable — ROSI needs both', () => {
  const r = simulate({ scenarios: fixtures, trials: 500, seed: 3 });
  const priced = controls.map((c) =>
    c.control_id === 'ctl.iam.cloud-platform.mfa' ? { ...c, cost: { ...c.cost, opex_annual: 120_000 } } : c,
  );
  const ranking = rankByRosi({ result: r, controls: priced });
  assert.equal(ranking.ranked.length, 0);
});

test('efficacy above 1 is refused — a control cannot create value out of the loss it prevents', () => {
  const r = simulate({ scenarios: fixtures, trials: 200, seed: 3 });
  assert.throws(
    () => rankByRosi({ result: r, controls, efficacy: { 'ctl.iam.cloud-platform.mfa': 1.4 } }),
    /outside \[0,1\]/,
  );
});

test('ROSI at zero cost stays undefined rather than infinite', () => {
  // faircam.rosi() already refuses this; the wiring must not route around it.
  const r = simulate({ scenarios: fixtures, trials: 200, seed: 3 });
  const ranking = rankByRosi({ result: r, controls, efficacy: { 'ctl.iam.cloud-platform.mfa': 0.5 } });
  const row = [...ranking.ranked, ...ranking.unrankable].find((x) => x.control_id === 'ctl.iam.cloud-platform.mfa');
  assert.equal(row.ranked, false);
  assert.match(row.reason, /undefined, not infinite/);
});
