/**
 * How a finding's control mappings are read. One place, because three consumers need it and a
 * second copy drifts.
 *
 * A finding has ONE PRIMARY mapping — `control_id` — and that is deliberate: the primary names who
 * is accountable, and "one finding, one owner" is what stops a shared exception becoming nobody's
 * problem. But a real SOC 2 exception routinely reaches further than its owner. "Access to the
 * cloud platform AND the source repository was not revoked" is one finding against two controls,
 * and before `also_implicates` existed the second one survived only in prose: it appeared in no
 * gap query and read as clean while an auditor had already found otherwise.
 *
 * EVERY MAPPING CARRIES ITS OWN CONFIDENCE AND ATTRIBUTION. A single scalar on the finding would
 * apply the certainty of the primary to secondaries nobody checked as carefully, which is the same
 * laundering that `unverified_mapping_open` exists to prevent one level up.
 */

/**
 * Normalises a finding's mappings into one list, primary first.
 *
 * Returns `[]` for an unmapped finding. That is not the same as "no mappings to check" — an
 * unmapped finding is its own, sharper gap, and callers handle it before reaching here.
 */
export function mappingsOf(finding) {
  const out = [];
  if (finding?.control_id) {
    out.push({
      control_id: finding.control_id,
      mapping_confidence: finding.mapping_confidence ?? null,
      mapped_by: finding.mapped_by ?? null,
      basis: null,
      primary: true,
    });
  }
  for (const m of finding?.also_implicates ?? []) {
    if (!m?.control_id) continue;
    out.push({
      control_id: m.control_id,
      mapping_confidence: m.mapping_confidence ?? null,
      mapped_by: m.mapped_by ?? null,
      basis: m.basis ?? null,
      primary: false,
    });
  }
  return out;
}

/** Every control this finding touches, primary and secondary, deduplicated. */
export const controlsTouched = (finding) => [...new Set(mappingsOf(finding).map((m) => m.control_id))];

/** Does this finding reach the given control at all — as primary or secondary? */
export const touches = (finding, controlId) => controlsTouched(finding).includes(controlId);

/**
 * A mapping needs verifying unless somebody recorded that they were sure.
 *
 * `null` counts as needing verification and is WEAKER than an explicit `low`: nobody even said how
 * sure they were. Treating absence as acceptable is how an unlabelled judgement acquires the
 * authority of a checked one — Guardrail 3, applied to a judgement rather than a number.
 */
export const needsVerification = (mapping) => mapping.mapping_confidence !== 'high';

/** How a mapping's confidence reads in a sentence, including when it was never recorded. */
export const describeConfidence = (mapping) =>
  mapping.mapping_confidence ? `"${mapping.mapping_confidence}" confidence` : 'NO recorded confidence';

/** How a mapping's attribution reads in a sentence, including when there is none. */
export const describeAttribution = (mapping) =>
  mapping.mapped_by ? ` by ${mapping.mapped_by}` : ', by nobody named';
