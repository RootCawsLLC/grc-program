/**
 * FAIR-CAM operational efficacy.
 *
 * The point of the whole pipeline: the same query that satisfies an auditor also emits Variance
 * Frequency and Variance Duration, which produce control reliability, which is an input to Loss
 * Event Frequency. That conversion is what makes an evidence pipeline a risk instrument rather
 * than a compliance cost — and it is the argument that gets it funded out of a budget other
 * than compliance.
 *
 * FAIR-CAM and FAIR-MAM are CC BY-NC-ND 4.0. This file implements the published formulation for
 * internal, non-commercial use and does not redistribute or remix the models themselves.
 * Attribution: https://fairinstitute.org/FAIR-CAM/
 */

const DAYS_PER_YEAR = 365;

/**
 * Reliability — the fraction of the year the control sits in its intended state.
 * @param {number} varianceFrequency events per year
 * @param {number} varianceDurationDays mean days per event
 */
export function reliability(varianceFrequency, varianceDurationDays) {
  if (varianceFrequency < 0 || varianceDurationDays < 0) {
    throw new RangeError('variance frequency and duration must be non-negative');
  }
  const inVariance = (varianceFrequency * varianceDurationDays) / DAYS_PER_YEAR;
  if (inVariance > 1) {
    // The control spent more than a year in variance. That is not a reliability number,
    // it is a broken control or a broken measurement. Refuse rather than clamp silently.
    return { value: 0, saturated: true };
  }
  return { value: 1 - inVariance, saturated: false };
}

/**
 * Operational efficacy — efficacy actually delivered, blending intended-state and variant-state
 * performance by the time spent in each.
 *
 * OE = R * intendedEfficacy + (1 - R) * variantEfficacy
 *
 * Coverage is deliberately NOT folded in here. It is a separate dimension with a separate fix
 * (widen the population vs. harden the control) and collapsing them hides which one is failing.
 * coverageWeighted is exposed for the cases where a single number is genuinely wanted.
 */
export function operationalEfficacy({
  intendedEfficacy,
  variantEfficacy,
  varianceFrequency,
  varianceDurationDays,
  coverage = 1,
  confidenceTier,
  varianceStartQuality = 'source-timestamp',
}) {
  for (const [k, v] of Object.entries({ intendedEfficacy, variantEfficacy, coverage })) {
    if (typeof v !== 'number' || v < 0 || v > 1) {
      throw new RangeError(`${k} must be a number in [0,1], got ${v}`);
    }
  }

  const r = reliability(varianceFrequency, varianceDurationDays);
  const oe = r.value * intendedEfficacy + (1 - r.value) * variantEfficacy;

  return {
    reliability: round(r.value),
    operational_efficacy: round(oe),
    coverage_weighted_efficacy: round(oe * coverage),
    coverage,
    confidence_tier: confidenceTier ?? null,
    saturated: r.saturated,
    // Honesty carried in the result, not in a footnote someone drops on the way to a slide.
    upper_bound_only: varianceStartQuality === 'equals-detected',
    caveat:
      varianceStartQuality === 'equals-detected'
        ? 'variance_started_at was set equal to variance_detected_at. Variance Duration is systematically understated and this efficacy is an UPPER BOUND, not an estimate.'
        : null,
  };
}

/**
 * Decompose Variance Duration into the FAIR-CAM segments so the slow function is visible.
 * Knowing VD is 30 days is not actionable. Knowing 26 of those 30 days were detection latency is.
 */
export function decomposeVariance(event) {
  const t = (k) => {
    const v = event[k];
    if (!v) throw new TypeError(`variance event missing ${k}`);
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw new TypeError(`variance event ${k} is not a date: ${v}`);
    return d.getTime();
  };

  const started = t('variance_started_at');
  const detected = t('variance_detected_at');
  const remStart = t('remediation_started_at');
  const remDone = t('remediation_completed_at');

  const days = (a, b) => round((b - a) / 86_400_000);

  return {
    control_id: event.control_id,
    subject_id: event.subject_id,
    total_duration_days: days(started, remDone),
    segments: [
      { span: 'started_to_detected',   days: days(started, detected),  faircam_function: 'control-monitoring',  fix: 'monitoring cadence or coverage' },
      { span: 'detected_to_triaged',   days: days(detected, remStart), faircam_function: 'treatment-selection', fix: 'prioritization or ownership' },
      { span: 'triaged_to_remediated', days: days(remStart, remDone),  faircam_function: 'implementation',      fix: 'capacity or tooling' },
    ],
  };
}

/**
 * ROSI — risk reduction per dollar. This is the only defensible way to sequence remediation
 * for a one-person team, because it is the only ranking that survives the question
 * "why this and not that."
 */
export function rosi({ aleBefore, aleAfter, annualCost }) {
  if (annualCost === 0) {
    return {
      ranked: false,
      reason:
        'annual cost is zero or unpopulated. ROSI is undefined, not infinite. Populate control.cost.opex_annual before ranking.',
    };
  }
  const reduction = aleBefore - aleAfter;
  return {
    ranked: true,
    annual_loss_reduction: round(reduction),
    annual_cost: annualCost,
    rosi: round(reduction / annualCost),
    net_benefit: round(reduction - annualCost),
  };
}

const round = (n) => Math.round(n * 10000) / 10000;
