/**
 * Turning probe evidence into control assertion records.
 *
 * THE TRAP THIS FILE EXISTS TO AVOID. `ctl.ai.agent.tool-allowlist` defines its population as
 * "every agent runtime in a Reco production workload". These probes run against proofplane's
 * reference target, which is not a Reco runtime and never will be — B20 is explicit that nothing
 * points at a Reco system, because she does not work there yet. So an assertion saying
 * "3 of 3 subjects passing" against that control would be a true sentence about the wrong
 * population, and it would travel into OSCAL, into control health, and eventually in front of
 * somebody who reads it as a measurement of Reco.
 *
 * The fix is the one B22 already built and tested: `fixture: true`. Evidence produced against a
 * reference target is not evidence about Reco, in exactly the sense that fixture rows are not
 * evidence about Reco. Marking it means the stamp travels into every derived artifact, and
 * src/lib/load.mjs refuses to mix these records with real ones. The number cannot be laundered.
 *
 * When these probes are eventually pointed at a real runtime — a Phase 2 conversation, not a code
 * change — the flag comes off and everything downstream keeps working.
 */

import { buildAssertion } from '../lib/assertion.mjs';

/** Each trial is an independent execution of the control test, and therefore a population subject. */
function subjects(record) {
  const target = record.guarded?.observations?.length ? 'proofplane-reference-target' : 'unknown-target';
  return (record.guarded?.per_trial ?? []).map((t) => ({
    subject_id: `${record.probe_id}#${target}#trial-${t.trial}`,
    passing: t.outcome === 'HELD',
    reason:
      t.outcome === 'HELD'
        ? null
        : t.outcome === 'BREACHED'
          ? 'probe_breached_control'
          : 'probe_error',
    first_observed: record.recorded_at,
  }));
}

/**
 * Builds assertion records for every probe that has BOTH a control to attach to and a result worth
 * asserting. Returns the records and, separately, the reasons the others were skipped — because a
 * silent omission is how a partial run comes to look like a complete one.
 */
export function assertionsFrom(evidence, controls) {
  const byId = new Map(controls.map((c) => [c.control_id, c]));
  const assertions = [];
  const skipped = [];

  for (const record of evidence.records) {
    if (!record.control_id) {
      skipped.push({
        probe_id: record.probe_id,
        reason: 'no-control',
        detail:
          `No control in this inventory covers ${record.probe_id}. The probe ran and its paired ` +
          `evidence is recorded, but there is nothing to assert against. Missing: ${record.missing_control}.`,
      });
      continue;
    }

    const control = byId.get(record.control_id);
    if (!control) {
      // Louder than a skip: the probe names a control the inventory does not have, which is a
      // drift between two files that are supposed to agree.
      throw new Error(
        `${record.probe_id} names control ${record.control_id}, which is not in controls/. ` +
        'Either the control was removed or the probe is stale; both are findings.',
      );
    }

    if (record.outcome === 'VOID') {
      skipped.push({
        probe_id: record.probe_id,
        control_id: record.control_id,
        reason: 'void',
        detail: record.void_reason,
      });
      continue;
    }

    const rows = subjects(record);
    const assertion = buildAssertion({
      control,
      asOf: record.recorded_at,
      rows,
      // Tier 4 is "internal empirical". This IS empirical — a probe was executed and the result
      // observed — but against a reference target rather than the declared population, so it is
      // recorded one rung down. An executed probe against the wrong population is still better
      // evidence than a questionnaire, and worse than the same probe against the right one.
      confidenceTier: 3,
    });

    assertion.coverage_basis =
      `${rows.length} executed probe trial(s) of ${record.probe_id} against proofplane's reference ` +
      `target at ${evidence.targets?.guarded?.base_url ?? 'a loopback address'}. ` +
      'ZERO Reco agent runtimes are in scope: this run exercises the control test, not the control. ' +
      `The unguarded control run BREACHED, so the probe demonstrably distinguishes a working control ` +
      'from a missing one. ' +
      `${assertion.failing_count} of ${assertion.total} trial(s) outside the intended state.`;

    // The stamp. Same mechanism as the fixture pipeline; same reason.
    assertion.fixture = true;

    assertions.push(assertion);
  }

  return { assertions, skipped };
}

/**
 * The gaps a probe run reveals in the control inventory.
 *
 * A probe with no control is not a probe failure — it is an inventory finding, and it is more
 * useful than the probe result would have been. Reported rather than discarded.
 */
export function gapsFrom(evidence) {
  return evidence.records
    .filter((r) => !r.control_id)
    .map((r) => ({
      gap_id: `gap.probe.${r.probe_id.toLowerCase()}`,
      direction: 'assurance',
      probe_id: r.probe_id,
      missing_control: r.missing_control,
      statement:
        `${r.probe_id} ("${r.title}") executes and produces paired evidence, but no control in the ` +
        `inventory claims it. A working test with nothing to attach to is an assurance gap: the ` +
        `capability exists and nothing in the control model records that it does. Needs ` +
        `${r.missing_control}, written after the SOC 2 is read — not before.`,
      evidence: {
        guarded: r.guarded?.outcome,
        unguarded: r.unguarded?.outcome,
        discriminating: r.discriminating,
      },
    }));
}
