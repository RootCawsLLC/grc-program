/**
 * Turn a `route()` result into dispatch envelopes.
 *
 * `route` already decided what is new, what is held, and what is a repeat.
 * This file does not re-triage. It wraps those decisions so the orchestrator
 * sees the same objects the tracker would, instead of a second opinion.
 *
 * Only NEW subjects become `control.failing` events. Continuing subjects stay
 * silent — that rule is in exception-triage and is not re-derived here.
 * A held cycle becomes one `denominator.drift` event and no failure events.
 *
 * Quantities ride with `derivation_level: measured` because they came from
 * assertion records, not from a model. If the assertion set is synthetic,
 * the stamp travels onto every event.
 */

import { FIXTURE_STAMP, isFixtureSet } from './lib/load.mjs';

function latestAsOf(assertions) {
  let latest = null;
  for (const a of assertions ?? []) {
    if (a?.as_of && (!latest || a.as_of > latest)) latest = a.as_of;
  }
  return latest;
}

function stamp(assertions) {
  if (!isFixtureSet(assertions ?? [])) return {};
  return { _stamp: FIXTURE_STAMP, fixture: true };
}

/**
 * @param {object} routed  result of `route()`
 * @param {{ assertions?: object[], source?: string }} [opts]
 * @returns {object[]}
 */
export function eventsFromRoute(routed, { assertions = [], source = 'pipeline.route' } = {}) {
  if (!routed || typeof routed !== 'object') {
    throw new Error('eventsFromRoute: routed result is missing.');
  }
  const as_of = latestAsOf(assertions);
  if (!as_of) {
    throw new Error('eventsFromRoute: as_of is required. Untimed route results cannot enter dispatch.');
  }
  const base = {
    source,
    as_of,
    derivation_level: 'measured',
    ...stamp(assertions),
  };

  if (routed.held) {
    return [{
      ...base,
      event_id: `evt.route.drift.${as_of}`,
      kind: 'denominator.drift',
      payload: { drifted: routed.drifted ?? [], reason: routed.reason },
    }];
  }

  const events = [];
  for (const item of routed.items ?? []) {
    if (item.status !== 'new') continue;
    events.push({
      ...base,
      event_id: `evt.route.${String(item.item_id).replace(/\|/g, '.')}`,
      kind: 'control.failing',
      payload: {
        control_id: item.control_id,
        subject_id: item.subject_id,
        item_id: item.item_id,
        owner: item.owner,
        days_failing: item.failing_for_days,
        consecutive_cycles: item.consecutive_cycles,
        escalate_to_root_cause: Boolean(item.escalate_to_root_cause),
      },
    });
  }
  return events;
}
