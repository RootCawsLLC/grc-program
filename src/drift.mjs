/**
 * `drift` — check the denominator before anybody looks at the failures.
 *
 * WHY THIS RUNS BEFORE `route`, and why that ordering is load-bearing. `total` is itself a control
 * metric. If the population silently shrank, the pass rate IMPROVES while coverage gets worse: 40
 * of 45 passing reads better than 40 of 60, and it is the same forty. The asset inventory — a
 * Decision Support control — failed before the control under test did.
 *
 * Routing failures first buries that signal under a list of tickets, which is why
 * `.claude/agents/exception-triage.md` states the same rule for the human-facing side:
 * "Denominator movement outranks failure count ... raise that first and hold the failure routing."
 *
 * A DRIFT IS NOT AUTOMATICALLY A FAULT. A population legitimately grows when a team onboards and
 * shrinks when a project is decommissioned. What is never legitimate is nobody noticing. So this
 * reports movement and blocks the cycle; it does not diagnose the cause, because the cause is a
 * question about the estate rather than about this repository.
 */

import { denominatorDrift } from './lib/assertion.mjs';

export const DEFAULT_TOLERANCE = 0.10;

/** Latest-two per control, oldest first, so "previous" is unambiguous. */
function historyByControl(assertions) {
  const byControl = new Map();
  for (const a of assertions) {
    if (!byControl.has(a.control_id)) byControl.set(a.control_id, []);
    byControl.get(a.control_id).push(a);
  }
  for (const list of byControl.values()) list.sort((x, y) => x.as_of.localeCompare(y.as_of));
  return byControl;
}

export function assessDrift({ assertions, tolerance = DEFAULT_TOLERANCE }) {
  const byControl = historyByControl(assertions);
  const results = [];

  for (const [controlId, history] of byControl) {
    const current = history.at(-1);
    const previous = history.length > 1 ? history.at(-2) : null;
    const d = denominatorDrift(previous, current, tolerance);

    results.push({
      control_id: controlId,
      observations: history.length,
      previous_total: previous?.total ?? null,
      current_total: current.total,
      as_of: current.as_of,
      ...d,
      // A single observation cannot drift. Saying "no drift" would imply a comparison that never
      // happened — the same conflation of "checked and fine" with "not checked" this repo refuses
      // everywhere else.
      comparable: history.length > 1,
    });
  }

  const drifted = results.filter((r) => r.drifted);
  const incomparable = results.filter((r) => !r.comparable);

  return {
    tolerance,
    controls: results.sort((a, b) => a.control_id.localeCompare(b.control_id)),
    drifted,
    incomparable,
    // The cycle is held open on drift. `route` checks this.
    hold: drifted.length > 0,
    summary:
      drifted.length === 0
        ? incomparable.length === results.length
          ? 'No comparison was possible: every control has a single observation. That is not "no drift".'
          : `No denominator moved beyond ${(tolerance * 100).toFixed(0)}%.`
        : `${drifted.length} denominator(s) moved beyond ${(tolerance * 100).toFixed(0)}%. ` +
          'Investigate the asset inventory before trusting any pass rate from this cycle.',
  };
}
