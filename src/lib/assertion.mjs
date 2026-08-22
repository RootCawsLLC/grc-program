/**
 * Builds the canonical control assertion record.
 *
 * The counts-vs-enumeration ruling: a count derived from a reproducible query over the full
 * population IS a population statement, not a sample. The evidence is total + failing[] +
 * query_ref + lineage — the auditor re-runs the query and gets the same answer. That is strictly
 * stronger than a sample and strictly stronger than a screenshot.
 */

export function buildAssertion({
  control,
  asOf,
  rows,              // [{ subject_id, passing, reason, first_observed }]
  exceptions = [],
  confidenceTier,
}) {
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array — a control test returns a population');

  const excepted = new Map();
  for (const ex of exceptions) {
    if (ex.control_id !== control.control_id) continue;
    assertNotExpired(ex, asOf);
    for (const s of ex.subjects) excepted.set(s, ex.exception_id);
  }

  const failing = rows
    .filter((r) => !r.passing)
    .map((r) => ({
      subject_id: r.subject_id,
      reason: r.reason ?? 'unspecified',
      first_observed: r.first_observed ?? asOf,
      exception_ref: excepted.get(r.subject_id) ?? null,
    }))
    .sort((a, b) => a.subject_id.localeCompare(b.subject_id)); // deterministic ordering, reviewable diffs

  const total = rows.length;
  const failingCount = failing.length;
  const exceptedCount = failing.filter((f) => f.exception_ref).length;

  return {
    control_id: control.control_id,
    as_of: asOf,
    population_definition: control.population_definition.trim(),
    source_system: control.source_system,
    query_ref: control.query_ref,
    total,
    passing_count: total - failingCount,
    failing_count: failingCount,
    failing,
    passing: null, // null by default. Enumerating passing rows is storage, not evidence.
    coverage_basis: exceptedCount
      ? `${total} subjects in scope; ${exceptedCount} failing under documented exception (${[...new Set(failing.filter(f=>f.exception_ref).map(f=>f.exception_ref))].join(', ')}). Exceptions reduce coverage; they do not leave the denominator.`
      : `${total} subjects in scope; no documented exceptions in force.`,
    confidence_tier: confidenceTier ?? 4,
  };
}

function assertNotExpired(ex, asOf) {
  if (!ex.expires_on) {
    throw new Error(`${ex.exception_id} has no expires_on. An exception without an expiry is an undocumented control change and will not be honoured.`);
  }
  if (new Date(ex.expires_on) < new Date(asOf)) {
    throw new Error(`${ex.exception_id} expired ${ex.expires_on} and is still referenced at ${asOf}. Renew it or let the subjects fail.`);
  }
}

/**
 * Denominator drift alarm. total is itself a control metric: if it moves unexpectedly the asset
 * inventory — a Decision Support control — failed BEFORE this control did. Alerting only on
 * failures misses the case where the population silently shrank and the pass rate "improved".
 */
export function denominatorDrift(previous, current, tolerance = 0.10) {
  if (!previous) return { drifted: false, reason: 'no prior assertion' };
  if (previous.total === 0) return { drifted: current.total > 0, reason: 'population appeared' };

  const delta = (current.total - previous.total) / previous.total;
  return {
    drifted: Math.abs(delta) > tolerance,
    delta: Math.round(delta * 1000) / 1000,
    direction: delta < 0 ? 'shrank' : 'grew',
    reason:
      Math.abs(delta) > tolerance
        ? `denominator ${delta < 0 ? 'shrank' : 'grew'} ${(Math.abs(delta) * 100).toFixed(1)}% (${previous.total} -> ${current.total}). Investigate the asset inventory before trusting the pass rate.`
        : null,
  };
}
