import { mappingsOf, needsVerification, describeConfidence, describeAttribution } from './lib/finding.mjs';

/**
 * Gap assessment — four directions, because "gap" means four different things and each has a
 * different fix. Collapsing them into one list is how a gap assessment becomes a wish list.
 *
 *   coverage     a framework requirement in scope with no control mapped to it
 *                -> fix: decompose the requirement and write a control, or justify exclusion in the SoA
 *
 *   assurance    a control with no executable evidence behind it
 *                -> fix: write the query. This is the gap most programmes never look at, because
 *                   the framework says "covered" and nobody asks what covered means
 *
 *   remediation  an open finding with no operating control behind it
 *                -> fix: the auditor already told you. This is the only direction with a deadline
 *                   attached to someone else's calendar
 *
 *   risk         a scenario with nothing operating against it
 *                -> fix: unmitigated exposure. The only direction that is about loss rather than
 *                   about paperwork, and therefore the one to lead a board conversation with
 */

export function assessGaps({ controls, scenarios = [], findings = [], requirementIndex = null }) {
  const gaps = [];
  const byId = new Map(controls.map((c) => [c.control_id, c]));
  const operating = (id) => byId.get(id)?.status === 'operating';
  let n = 0;
  const id = () => `GAP-${String(++n).padStart(4, '0')}`;

  // --- 1. COVERAGE ---------------------------------------------------------------------
  // Build the set of framework identifiers our inventory claims to serve.
  const claimed = new Set();
  for (const c of controls) {
    for (const ids of Object.values(c.crosswalk ?? {})) for (const i of ids) claimed.add(i);
    for (const ids of Object.values(c.crosswalk_direct ?? {})) for (const i of ids) claimed.add(i);
  }

  if (requirementIndex) {
    for (const [family, block] of Object.entries(requirementIndex)) {
      if (!block?.requirements) continue;
      for (const req of block.requirements) {
        if (req.in_scope === false) continue; // excluded in the SoA — not a gap
        if (claimed.has(req.id)) continue;

        gaps.push({
          gap_id: id(),
          direction: 'coverage',
          subject: req.id,
          statement: req.in_scope === null
            ? `${req.id} (${family}) has no control mapped AND its scope is undetermined.`
            : `${req.id} (${family}) is in scope and has no control mapped to it.`,
          severity_basis: req.in_scope === null
            ? 'Scope undetermined. This is a DISCOVERY gap, not yet a control gap — read the Statement of Applicability and the SOC 2 report scope before treating it as either. An undetermined denominator makes every coverage percentage in this repo meaningless.'
            : 'In scope per the requirement index with no control claiming it. Either write the control or record the exclusion justification.',
          related: [],
        });
      }
    }
  }

  // --- 2. ASSURANCE --------------------------------------------------------------------
  for (const c of controls) {
    if (c.status === 'retired') continue;
    const manual = c.collection?.mechanism === 'manual-procedure';
    const noQuery = !c.query_ref;
    if (noQuery || manual) {
      gaps.push({
        gap_id: id(),
        direction: 'assurance',
        subject: c.control_id,
        statement: manual
          ? `${c.control_id} is evidenced by a manual procedure.`
          : `${c.control_id} has no executable evidence.`,
        severity_basis: manual
          ? 'Legitimate but expensive. In a one-person programme the scarce resource is human attention, so manual controls are the budget. Count them deliberately rather than letting them accumulate.'
          : 'The control exists as a record and produces no measurement. It is an assertion, not a control.',
        related: c.scenarios ?? [],
      });
    }
  }

  /** Appended to other remediation statements so the caveat travels with the number it qualifies. */
  const mappingCaveat = (m) =>
    needsVerification(m)
      ? ` Mapping confidence is ${m.mapping_confidence ? `"${m.mapping_confidence}"` : 'not recorded'}; treat the attribution as unverified.`
      : '';

  /** How a secondary mapping is labelled in a statement, so a reader knows which one they are reading. */
  const role = (m) => (m.primary ? '' : ' (also_implicates)');

  // --- 3. REMEDIATION ------------------------------------------------------------------
  for (const f of findings) {
    if (!['open', 'in-remediation'].includes(f.disposition)) continue;

    if (!f.control_id) {
      gaps.push({
        gap_id: id(),
        direction: 'remediation',
        subject: f.finding_id,
        statement: `${f.finding_id} (${f.kind}, ${f.source?.document ?? 'unknown source'}) is open and maps to no control in the inventory.`,
        severity_basis:
          'An unmapped finding is the sharpest signal available that the inventory has a hole. ' +
          'The auditor found something the control model has no place to put. Map it or write the control it belongs to.',
        related: f.framework_ref ?? [],
      });
      continue;
    }

    // EVERY control the finding touches, primary and secondary.
    //
    // A finding routinely reaches further than its owner — "access to the cloud platform AND the
    // source repository was not revoked" is one finding against two controls. Iterating only the
    // primary is what let the second control read as clean while an auditor had already found
    // otherwise. Each mapping gets its own gaps, because each is a separate thing that is wrong.
    for (const m of mappingsOf(f)) {
      if (!operating(m.control_id)) {
        gaps.push({
          gap_id: id(),
          direction: 'remediation',
          subject: f.finding_id,
          statement:
            `${f.finding_id} is open against ${m.control_id}${role(m)}, which is ` +
            `"${byId.get(m.control_id)?.status ?? 'not in the inventory'}" rather than operating.` +
            mappingCaveat(m),
          severity_basis:
            'The remediation depends on a control that is not yet running. This has a date attached ' +
            'to someone else\'s calendar, which makes it the only gap direction that is not ' +
            'self-scheduled.',
          related: [m.control_id],
        });
      }

      // An unverified mapping is its own gap, INDEPENDENT of the control's status.
      //
      // Before this, a finding mapped to an OPERATING control produced no gap at all — so a mapping
      // somebody guessed at was most invisible exactly when the control looked healthiest, which is
      // the worst possible place to hide it. If the mapping is wrong, the status gap above is
      // pointed at the wrong control and the right one reads clean.
      //
      // Guardrail 3 in CLAUDE.md applies to numbers: an unlabelled one is rejected, and a range
      // with no provenance must not read like a sourced one. A control attribution is a judgement
      // with a name on it and decays the same way. It gets the same treatment.
      if (needsVerification(m)) {
        gaps.push({
          gap_id: id(),
          direction: 'remediation',
          subject: f.finding_id,
          statement:
            `${f.finding_id} is mapped to ${m.control_id}${role(m)} at ` +
            `${describeConfidence(m)}${describeAttribution(m)}. The mapping is unverified.`,
          severity_basis:
            'Mapping is a judgement, not a lookup. Until it is confirmed, this finding may be ' +
            'attributed to the wrong control — which both misdirects the remediation and leaves the ' +
            'correct control reading clean. Re-check against the report once the full system ' +
            'description has been read; a mapping made during extraction is the first thing to revisit.',
          related: [m.control_id],
        });
      }
    }
  }

  // --- 4. RISK -------------------------------------------------------------------------
  for (const s of scenarios) {
    const linked = controls.filter((c) => (c.scenarios ?? []).includes(s.scenario_id));
    const live = linked.filter((c) => c.status === 'operating');

    if (linked.length === 0) {
      gaps.push({
        gap_id: id(),
        direction: 'risk',
        subject: s.scenario_id,
        statement: `${s.scenario_id} has no controls joined to it at all.`,
        severity_basis: 'Unmitigated by construction, or mitigated by something not in the inventory. Both are findings.',
        related: [],
      });
    } else if (live.length === 0) {
      gaps.push({
        gap_id: id(),
        direction: 'risk',
        subject: s.scenario_id,
        statement: `${s.scenario_id} is served by ${linked.length} control(s), none of which are operating: ${linked.map((c) => c.control_id).join(', ')}.`,
        severity_basis:
          'Exposure is currently carried with nothing running against it. This is the direction to ' +
          'lead a leadership conversation with, because it is about loss rather than about paperwork.',
        related: linked.map((c) => c.control_id),
      });
    }
  }

  const byDirection = {};
  for (const dir of ['coverage', 'assurance', 'remediation', 'risk']) {
    byDirection[dir] = gaps.filter((g) => g.direction === dir).length;
  }

  return {
    total: gaps.length,
    by_direction: byDirection,
    ordering_note:
      'Work order is remediation, then risk, then assurance, then coverage. Remediation has ' +
      'someone else\'s deadline. Risk is about loss. Assurance makes the rest measurable. Coverage ' +
      'is the least urgent and the most commonly done first, because it is the easiest to count.',
    gaps,
  };
}
