/**
 * Control health assessment.
 *
 * Deliberately a CLASSIFICATION, not a score.
 *
 * The temptation is to rate each control 1-5 and average it into a program number that goes on a
 * slide. Resist it. Ordinal values are not ratio values — a 5 is not five times a 1 — so averaging
 * them produces a number that cannot validly be used for anything, and the moment it exists someone
 * will divide by it. A maturity score is also not a proxy for risk reduction: most framework
 * subcategories affect decisions ABOUT controls rather than acting on loss events at all.
 *
 * So: each control gets a set of named deficiencies, and the aggregate is a count by deficiency
 * type plus a band. Both are actionable. Neither is arithmetic.
 */

const DAY = 86_400_000;

const CADENCE_DAYS = {
  continuous: 1, daily: 1, weekly: 7, monthly: 31, quarterly: 92, annual: 366,
};

/** Deficiency catalog. Each carries the fix, because a finding without a fix is a complaint. */
export const DEFICIENCIES = {
  'H1-no-evidence':        { fix: 'write the dbt model; until then this control is a claim, not a control' },
  'H2-stale':              { fix: 'collection is behind its declared cadence — fix the collector or lower the declared cadence to the truth' },
  'H3-tier-floor':         { fix: 'evidence is attestation or screenshot grade; replace with a query over the population' },
  'H4-population-vague':   { fix: 'the prose denominator does not quantify a population; rewrite it so the WHERE clause can match it' },
  'H5-variance-blind':     { fix: 'variance_started_at equals detection, so Variance Duration is understated and reliability is an upper bound only' },
  'H6-owner-is-a-person':  { fix: 'reassign to a team; person-owned controls die when the person changes role' },
  'H7-unpriced':           { fix: 'no scenario joins to this control, so it cannot be ranked or defended against "why this and not that"' },
  'H8-uncosted':           { fix: 'cost.opex_annual is unpopulated, so ROSI is undefined for this control' },
  'H9-manual':             { fix: 'legitimate, but it consumes the scarce resource in a one-person program — count these deliberately' },
  'H10-policy-orphan':     { fix: 'operating with no generated policy; generate it from the control record' },
  'H11-open-finding':      { fix: 'an assurance activity raised a finding against this control and it is still open' },
  'H12-planned-indefinite':{ fix: 'planned with no evidence and no date; either commit to building it or retire it from the inventory' },
};

/** Named bands. No numbers, because the number would get averaged. */
export const BANDS = {
  instrumented: 'Evidence is a query over a defined population, current, and variance is measurable.',
  attested:     'Evidence exists but is attestation-grade, manual, or variance-blind. Real, but not measurable.',
  declared:     'A control record exists. No evidence has ever been produced against it.',
  aspirational: 'Planned or building, with no evidence and no committed date.',
};

export function assessControl({ control, assertions = [], findings = [], asOf = new Date().toISOString() }) {
  const d = [];
  const mine = assertions.filter((a) => a.control_id === control.control_id)
    .sort((a, b) => new Date(b.as_of) - new Date(a.as_of));
  const latest = mine[0] ?? null;

  // --- evidence existence and quality -------------------------------------------------
  if (!latest) d.push('H1-no-evidence');

  if (latest) {
    const cadence = CADENCE_DAYS[control.collection?.cadence ?? 'quarterly'] ?? 92;
    const ageDays = (new Date(asOf) - new Date(latest.as_of)) / DAY;
    // Two cadences of slack before calling it stale. One is noise; two is a broken collector.
    if (ageDays > cadence * 2) d.push('H2-stale');
    if ((latest.confidence_tier ?? 1) <= 2) d.push('H3-tier-floor');
  }

  // --- population integrity -----------------------------------------------------------
  // A denominator you cannot write is a control you cannot measure. Heuristic, and it is a
  // heuristic on purpose: it flags for human review rather than deciding.
  const pop = (control.population_definition ?? '').toLowerCase();
  const quantified = /\b(all|every|each)\b/.test(pop);
  if (!quantified || pop.length < 40) d.push('H4-population-vague');

  // --- variance visibility ------------------------------------------------------------
  if (control.collection?.variance_started_at_quality === 'equals-detected') d.push('H5-variance-blind');

  // --- ownership ----------------------------------------------------------------------
  // A team name is lowercase-hyphenated by convention here. Anything with an @, a capitalized
  // given name, or a space is very likely a person.
  const owner = control.owner ?? '';
  if (/@/.test(owner) || /\s/.test(owner) || /[A-Z]/.test(owner)) d.push('H6-owner-is-a-person');

  // --- linkage ------------------------------------------------------------------------
  if (!control.scenarios?.length) d.push('H7-unpriced');
  if (!(control.cost?.opex_annual > 0)) d.push('H8-uncosted');
  if (control.collection?.mechanism === 'manual-procedure') d.push('H9-manual');
  if (control.status === 'operating' && !control.policy_ref) d.push('H10-policy-orphan');

  const open = findings.filter((f) => f.control_id === control.control_id &&
    ['open', 'in-remediation'].includes(f.disposition));
  if (open.length) d.push('H11-open-finding');

  if (control.status === 'planned' && !latest) d.push('H12-planned-indefinite');

  // --- band ---------------------------------------------------------------------------
  const has = (x) => d.includes(x);
  let band;
  if (!latest) band = control.status === 'planned' ? 'aspirational' : 'declared';
  else if (has('H2-stale') || has('H3-tier-floor') || has('H5-variance-blind') || has('H9-manual')) band = 'attested';
  else band = 'instrumented';

  return {
    control_id: control.control_id,
    status: control.status,
    band,
    deficiencies: d.sort(),
    open_findings: open.map((f) => f.finding_id),
    last_assertion: latest?.as_of ?? null,
    evidence_tier: latest?.confidence_tier ?? null,
    population_total: latest?.total ?? null,
  };
}

export function assessAll({ controls, assertions = [], findings = [], asOf }) {
  const results = controls
    .map((control) => assessControl({ control, assertions, findings, asOf }))
    .sort((a, b) => a.control_id.localeCompare(b.control_id));

  const byBand = {};
  for (const b of Object.keys(BANDS)) byBand[b] = results.filter((r) => r.band === b).length;

  const byDeficiency = {};
  for (const code of Object.keys(DEFICIENCIES)) {
    const n = results.filter((r) => r.deficiencies.includes(code)).length;
    if (n) byDeficiency[code] = n;
  }

  return {
    as_of: asOf ?? new Date().toISOString(),
    total_controls: results.length,
    by_band: byBand,
    by_deficiency: byDeficiency,
    // Stated explicitly so nobody derives one anyway.
    scoring_note:
      'No aggregate score is produced. Deficiency counts and band membership are the output. ' +
      'Averaging ordinal control ratings into a program number yields a value that cannot ' +
      'validly enter arithmetic, and it will be divided by the moment it exists.',
    controls: results,
  };
}
