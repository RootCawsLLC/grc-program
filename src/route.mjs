/**
 * `route` — turn newly failing subjects into work items for the team that owns the control.
 *
 * The rules are not invented here. They are written down in
 * `.claude/agents/exception-triage.md` and implemented deterministically, because every one of them
 * is a mechanical decision that does not need judgment:
 *
 *   - denominator movement outranks failure count, and HOLDS the routing
 *   - deduplicate by SUBJECT, not by finding — one item per subject, updated in place
 *   - route to the control's `owner`, in their vocabulary
 *   - carry enough context to act without asking a question back
 *   - escalate a subject failing three cycles running to root cause instead of re-ticketing it
 *
 * WHAT THIS DOES NOT DO, per ADR-0004 and the agent's own refusals: it does not close an item,
 * approve or extend an exception, or say whether the control is effective. It reports what is
 * failing and for how long. Closure happens when the test passes.
 *
 * AGE IS MEASURED FROM `first_observed`, NOT FROM DETECTION. The difference is the entire point of
 * the variance layer: a subject that has been failing since March and was noticed on Tuesday is a
 * detection problem, and reporting it as two days old hides that.
 */

const CONSECUTIVE_BEFORE_ESCALATION = 3;

const days = (from, to) =>
  from && to ? Math.round(((new Date(to) - new Date(from)) / 86_400_000) * 10) / 10 : null;

/** Assertions for one control, oldest first. */
function historyByControl(assertions) {
  const byControl = new Map();
  for (const a of assertions) {
    if (!byControl.has(a.control_id)) byControl.set(a.control_id, []);
    byControl.get(a.control_id).push(a);
  }
  for (const list of byControl.values()) list.sort((x, y) => x.as_of.localeCompare(y.as_of));
  return byControl;
}

/** How many cycles, counting back from the latest, this subject has failed without interruption. */
function consecutiveFailures(history, subjectId) {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].failing.some((f) => f.subject_id === subjectId)) n += 1;
    else break;
  }
  return n;
}

export function route({ assertions, controls, drift = null, exceptions = [] }) {
  // The denominator gate. Held BEFORE any item is produced, not reported alongside them — a hold
  // that arrives as one line above forty tickets is a hold nobody acts on.
  if (drift?.hold) {
    return {
      held: true,
      reason:
        `Routing held: ${drift.drifted.length} denominator(s) moved beyond ` +
        `${(drift.tolerance * 100).toFixed(0)}%. The asset inventory failed before the controls did, ` +
        'and routing failures first would bury that under a list of tickets.',
      drifted: drift.drifted.map((d) => ({
        control_id: d.control_id,
        previous_total: d.previous_total,
        current_total: d.current_total,
        reason: d.reason,
      })),
      items: [],
      summaries: [],
    };
  }

  const byId = new Map(controls.map((c) => [c.control_id, c]));
  const exceptionBySubject = new Map();
  for (const ex of exceptions) {
    for (const s of ex.subjects ?? []) exceptionBySubject.set(`${ex.control_id}|${s}`, ex);
  }

  const items = [];
  const summaries = [];

  for (const [controlId, history] of historyByControl(assertions)) {
    const control = byId.get(controlId);
    if (!control) throw new Error(`assertion references unknown control ${controlId}`);

    const current = history.at(-1);
    const previous = history.length > 1 ? history.at(-2) : null;
    const previouslyFailing = new Set((previous?.failing ?? []).map((f) => f.subject_id));

    const controlItems = [];
    for (const f of current.failing) {
      const streak = consecutiveFailures(history, f.subject_id);
      const exception = exceptionBySubject.get(`${controlId}|${f.subject_id}`) ?? null;
      const isNew = !previouslyFailing.has(f.subject_id);

      controlItems.push({
        // Deduplicated by SUBJECT: the id is stable across cycles so a tracker updates in place
        // rather than opening a new ticket every morning, which is how a channel becomes noise.
        item_id: `${controlId}|${f.subject_id}`,
        control_id: controlId,
        owner: control.owner,
        subject_id: f.subject_id,
        reason: f.reason,
        status: isNew ? 'new' : 'continuing',
        first_observed: f.first_observed,
        // From first_observed, not from detection.
        failing_for_days: days(f.first_observed, current.as_of),
        consecutive_cycles: streak,
        scenarios: control.scenarios ?? [],
        fixed_looks_like: control.population_definition?.trim() ?? null,
        exception: exception
          ? { exception_id: exception.exception_id, expires_on: exception.expires_on }
          : null,
        // Repeats are a different problem with a different fix. Saying so is the point: remediating
        // the same subject every cycle is the most expensive way to not fix something.
        escalate_to_root_cause: streak >= CONSECUTIVE_BEFORE_ESCALATION,
        escalation_note:
          streak >= CONSECUTIVE_BEFORE_ESCALATION
            ? `Failing ${streak} cycles running. This is a variance-management or decision-support ` +
              'failure, not a loss-event-control failure. Stop opening tickets and find the cause.'
            : undefined,
      });
    }

    items.push(...controlItems);

    // One summary per control, never per subject.
    if (controlItems.length) {
      const fresh = controlItems.filter((i) => i.status === 'new').length;
      summaries.push({
        control_id: controlId,
        owner: control.owner,
        as_of: current.as_of,
        failing: current.failing_count,
        total: current.total,
        new_this_cycle: fresh,
        escalations: controlItems.filter((i) => i.escalate_to_root_cause).length,
        message:
          `${controlId}: ${current.failing_count} of ${current.total} subjects outside the intended ` +
          `state as of ${current.as_of}` + (fresh ? `, ${fresh} new this cycle.` : ', none new this cycle.'),
      });
    }
  }

  return {
    held: false,
    items: items.sort((a, b) => a.item_id.localeCompare(b.item_id)),
    summaries: summaries.sort((a, b) => a.control_id.localeCompare(b.control_id)),
    // "If nothing is new, say nothing — a silent channel is a working channel."
    silent: items.every((i) => i.status !== 'new'),
    note: items.length === 0 ? 'Nothing failing. No items routed.' : undefined,
  };
}
