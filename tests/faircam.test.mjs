import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reliability, operationalEfficacy, decomposeVariance, rosi } from '../src/faircam.mjs';

const WORKED_EXAMPLE = {
  intendedEfficacy: 0.90, variantEfficacy: 0.60,
  varianceFrequency: 1.0, varianceDurationDays: 30, coverage: 0.80,
};

test('operational efficacy computes the worked example exactly, without intermediate rounding', () => {
  const r = operationalEfficacy(WORKED_EXAMPLE);
  assert.equal(r.reliability, 0.9178);          // 1 - 30/365 = 0.91780821918...
  assert.equal(r.operational_efficacy, 0.8753); // 0.9178082192*0.9 + 0.0821917808*0.6
});

/**
 * Documented discrepancy, deliberately kept as a test rather than buried in a comment.
 *
 * A commonly circulated FAIR-CAM props example carries operational-efficacy = 0.876 for these
 * exact inputs. The exact arithmetic is 0.87534..., which rounds to 0.875. The published 0.876
 * is reproducible only by rounding reliability to two decimals (0.92) BEFORE multiplying.
 *
 * We do not round intermediates. Over a control inventory of a few hundred controls, intermediate
 * rounding introduces drift that shows up as unexplained movement in aggregate efficacy between
 * cycles — which is indistinguishable from a real control change, and therefore worse than the
 * rounding error itself.
 *
 * This test exists so that anyone who diffs our number against the published example finds the
 * explanation immediately instead of assuming our implementation is wrong.
 */
test('the published 0.876 figure is reproducible only via intermediate rounding, which we reject', () => {
  const roundedReliability = 0.92; // 0.9178 rounded to 2dp
  const withIntermediateRounding = roundedReliability * 0.9 + (1 - roundedReliability) * 0.6;
  assert.equal(Math.round(withIntermediateRounding * 1000) / 1000, 0.876);

  const exact = operationalEfficacy(WORKED_EXAMPLE).operational_efficacy;
  assert.equal(Math.round(exact * 1000) / 1000, 0.875);
  assert.notEqual(Math.round(exact * 1000) / 1000, 0.876);
});

test('coverage is held separate from efficacy, not folded into it', () => {
  const r = operationalEfficacy({ intendedEfficacy: 1, variantEfficacy: 0, varianceFrequency: 0, varianceDurationDays: 0, coverage: 0.5 });
  assert.equal(r.operational_efficacy, 1);          // the control works perfectly...
  assert.equal(r.coverage_weighted_efficacy, 0.5);  // ...on half the population. Two different fixes.
});

test('a control in variance longer than a year saturates rather than going negative', () => {
  const r = reliability(12, 40); // 480 days of variance in a 365 day year
  assert.equal(r.value, 0);
  assert.equal(r.saturated, true);
});

test('equals-detected variance quality marks the result as an upper bound', () => {
  const r = operationalEfficacy({
    intendedEfficacy: 0.9, variantEfficacy: 0.5, varianceFrequency: 2, varianceDurationDays: 10,
    varianceStartQuality: 'equals-detected',
  });
  assert.equal(r.upper_bound_only, true);
  assert.match(r.caveat, /UPPER BOUND/);
});

test('efficacy inputs outside [0,1] are refused, not clamped', () => {
  assert.throws(() => operationalEfficacy({ intendedEfficacy: 1.4, variantEfficacy: 0.5, varianceFrequency: 1, varianceDurationDays: 1 }), RangeError);
});

test('variance decomposes into the three FAIR-CAM segments', () => {
  const d = decomposeVariance({
    control_id: 'ctl.iam.cloud-platform.mfa', subject_id: 'x',
    variance_started_at:      '2026-06-01T00:00:00Z',
    variance_detected_at:     '2026-06-27T00:00:00Z',
    remediation_started_at:   '2026-06-28T00:00:00Z',
    remediation_completed_at: '2026-07-01T00:00:00Z',
  });
  assert.equal(d.total_duration_days, 30);
  assert.equal(d.segments[0].days, 26);
  assert.equal(d.segments[0].faircam_function, 'control-monitoring');
  // The actionable finding: 26 of 30 days were detection latency. "Remediate faster" is the wrong fix.
});

test('ROSI refuses to rank against a zero cost instead of returning infinity', () => {
  const r = rosi({ aleBefore: 500000, aleAfter: 100000, annualCost: 0 });
  assert.equal(r.ranked, false);
  assert.match(r.reason, /undefined, not infinite/);
});

test('ROSI computes reduction per dollar', () => {
  const r = rosi({ aleBefore: 500000, aleAfter: 100000, annualCost: 80000 });
  assert.equal(r.rosi, 5);
  assert.equal(r.net_benefit, 320000);
});
