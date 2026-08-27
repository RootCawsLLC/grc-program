/**
 * O4 — Plan of Action and Milestones.
 *
 * Generated from `failing[]`, one item per failing subject, with the four variance timestamps
 * attached where the variance layer has them.
 *
 * THOSE TIMESTAMPS ARE THE WHOLE POINT. A POA&M without them is a compliance artifact: a list of
 * things that are wrong and a promise to fix them. With them it is a risk artifact, because
 * started -> detected -> triaged -> remediated says WHICH function is slow, and "mean time to
 * remediate is 30 days" becomes "26 of those 30 were detection latency, and remediate-faster was
 * the wrong instruction".
 *
 * A failing subject under a documented exception still appears here. An exception reduces coverage;
 * it does not remove the subject from the denominator and it does not make the item disappear from
 * the plan — it changes who is accountable and until when.
 */

import { metadata, ref, resource, ids, PROPS_NS, FILENAMES } from './common.mjs';

export function emitPoam({ controls, assertions = [], variance = [] }) {
  const byId = new Map(controls.map((c) => [c.control_id, c]));

  // Point-in-time: the newest assertion per control. Feeding the full history would emit one item
  // per subject PER SNAPSHOT and collide on the deterministic UUID — the same weakness listed
  // three times, or listed once with the count silently wrong.
  const latest = new Map();
  for (const a of assertions) {
    const prev = latest.get(a.control_id);
    if (!prev || a.as_of > prev.as_of) latest.set(a.control_id, a);
  }

  const varianceBySubject = new Map(
    variance.map((v) => [`${v.control_id}|${v.subject_id}`, v]),
  );

  const items = [];
  for (const a of [...latest.values()].sort((x, y) => x.control_id.localeCompare(y.control_id))) {
    const control = byId.get(a.control_id);
    if (!control) throw new Error(`assertion references unknown control ${a.control_id}`);
    for (const f of a.failing) {
      items.push(poamItem({ control, assertion: a, failing: f, variance: varianceBySubject.get(`${a.control_id}|${f.subject_id}`) }));
    }
  }

  return {
    'plan-of-action-and-milestones': {
      uuid: ids.document('poam'),
      metadata: metadata({ title: 'GRC Program plan of action and milestones', assertions }),
      'import-ssp': { href: ref('ssp') },
      'system-id': { id: 'grc-program', 'identifier-type': 'https://reco.ai/ns/grc/system-id' },
      'poam-items': items,
      'back-matter': {
        resources: [resource('ssp', 'GRC Program system security plan (generated)', FILENAMES.ssp)],
      },
    },
  };
}

function poamItem({ control, assertion, failing, variance }) {
  const props = [
    { ns: PROPS_NS, name: 'control-id', value: control.control_id },
    { ns: PROPS_NS, name: 'subject-id', value: failing.subject_id },
    { ns: PROPS_NS, name: 'reason', value: failing.reason },
    { ns: PROPS_NS, name: 'first-observed', value: failing.first_observed },
    { ns: PROPS_NS, name: 'population-total', value: String(assertion.total) },
    { ns: PROPS_NS, name: 'owner', value: control.owner },
  ];

  if (failing.exception_ref) {
    props.push({ ns: PROPS_NS, name: 'exception-ref', value: failing.exception_ref });
  }

  // The four timestamps, and the honesty about which are missing.
  if (variance) {
    const emit = (name, value) => {
      if (value === null || value === undefined) return;
      props.push({ ns: PROPS_NS, name, value: String(value) });
    };
    emit('variance-started-at', variance.variance_started_at);
    emit('variance-detected-at', variance.variance_detected_at);
    emit('remediation-started-at', variance.remediation_started_at);
    emit('remediation-completed-at', variance.remediation_completed_at);
    emit('variance-started-at-quality', variance.started_at_quality);
    if (!variance.remediation_started_at) {
      // Not cosmetic: without a first-touch timestamp the middle segment collapses and a
      // prioritisation failure is indistinguishable from an implementation failure.
      emit('variance-segment-unavailable', 'detected-to-triaged: no ticket first-touch recorded');
    }
  } else {
    props.push({
      ns: PROPS_NS,
      name: 'variance-segment-unavailable',
      value: 'no variance event: the subject has no prior passing observation to have transitioned from',
    });
  }

  return {
    uuid: ids.poamItem(control.control_id, failing.subject_id),
    title: `${control.control_id}: ${failing.subject_id} — ${failing.reason}`,
    description:
      `${failing.subject_id} is outside the intended state for ${control.control_id} ` +
      `(${failing.reason}), first observed ${failing.first_observed}. ` +
      (failing.exception_ref
        ? `Covered by documented exception ${failing.exception_ref}; the exception reduces coverage ` +
          'and does not remove this subject from the denominator or from this plan. '
        : '') +
      `Population at ${assertion.as_of}: ${assertion.failing_count} of ${assertion.total} failing. ` +
      `Evidence is ${assertion.query_ref}; re-running it reproduces this item.`,
    props,
    'related-observations': [
      { 'observation-uuid': ids.observation(control.control_id, assertion.as_of, 'population') },
    ],
  };
}
