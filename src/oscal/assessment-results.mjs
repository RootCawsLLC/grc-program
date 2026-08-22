import { resultUuid, observationUuid, componentUuid, uuid5 } from '../lib/uuid5.mjs';

const FAIRCAM_NS = 'https://reco.ai/ns/faircam';

/**
 * OSCAL Assessment Results (O3) — the join between compliance artifacts and live control state.
 * Most OSCAL implementations stop before this model, which is why most OSCAL packages describe a
 * system rather than measure one.
 *
 * Every UUID is deterministic (RFC 4122 v5) so an unchanged warehouse re-exports byte-identically.
 * Keys are sorted for the same reason. Review the diff, not the file.
 */
export function emitAssessmentResults({ assertions, controls, efficacy = {}, asOf }) {
  const byId = new Map(controls.map((c) => [c.control_id, c]));
  const sorted = [...assertions].sort((a, b) => a.control_id.localeCompare(b.control_id));

  const observations = [];
  const findings = [];

  for (const a of sorted) {
    const control = byId.get(a.control_id);
    if (!control) throw new Error(`assertion references unknown control ${a.control_id}`);

    observations.push({
      uuid: observationUuid(a.control_id, a.as_of, 'population'),
      title: `${a.control_id} population assertion`,
      description: a.population_definition,
      methods: ['TEST'],
      types: ['control-objective'],
      collected: a.as_of,
      'relevant-evidence': [{
        href: a.query_ref,
        description:
          `Reproducible query over the full population. total=${a.total} passing=${a.passing_count} ` +
          `failing=${a.failing_count}. ${a.coverage_basis} Re-running this query at as_of reproduces ` +
          `this result; that reproducibility is the evidence.`,
      }],
      props: buildProps(control, a, efficacy[a.control_id]),
    });

    if (a.failing_count > 0) {
      findings.push({
        uuid: uuid5(`finding|${a.control_id}|${a.as_of}`),
        title: `${a.failing_count} of ${a.total} subjects outside intended state for ${a.control_id}`,
        description:
          a.failing
            .map((f) => `${f.subject_id}: ${f.reason} (failing since ${f.first_observed}${f.exception_ref ? `, exception ${f.exception_ref}` : ''})`)
            .join('\n'),
        target: {
          type: 'objective-id',
          'target-id': a.control_id,
          status: { state: 'not-satisfied' },
        },
        'related-observations': [{ 'observation-uuid': observationUuid(a.control_id, a.as_of, 'population') }],
      });
    }
  }

  return {
    'assessment-results': {
      uuid: uuid5(`assessment-results|${asOf}`),
      metadata: {
        title: 'Reco continuous control assessment results',
        'last-modified': asOf,
        version: asOf,
        'oscal-version': '1.1.2',
        // No random uuid, no generation timestamp: those are the two fields that make an
        // otherwise-unchanged export produce a dirty diff.
      },
      'import-ap': { href: './assessment-plan.json' },
      results: [{
        uuid: resultUuid('all-controls', asOf),
        title: 'Continuous controls monitoring cycle',
        description: 'Population assertions produced by the control test layer. No samples, no screenshots.',
        start: asOf,
        'reviewed-controls': {
          'control-selections': [{
            'include-controls': sorted.map((a) => ({ 'control-id': a.control_id })),
          }],
        },
        observations,
        findings,
      }],
    },
  };
}

/**
 * FAIR-CAM props extension. OSCAL has nowhere to carry control measurement, so it goes in
 * namespaced props on a namespace Reco controls. Spec-legal, ignorable by tools that do not know
 * the namespace, and it makes an OSCAL package carry the risk layer rather than only the
 * compliance layer.
 */
function buildProps(control, assertion, eff) {
  const props = [
    { ns: FAIRCAM_NS, name: 'as-of', value: assertion.as_of },
    { ns: FAIRCAM_NS, name: 'confidence-tier', value: String(assertion.confidence_tier) },
    { ns: FAIRCAM_NS, name: 'population-total', value: String(assertion.total) },
  ];
  for (const f of control.faircam) {
    props.push({ ns: FAIRCAM_NS, name: 'function', value: f.function, class: f.primary ? 'primary' : 'secondary' });
  }
  if (eff) {
    props.push(
      { ns: FAIRCAM_NS, name: 'reliability', value: String(eff.reliability) },
      { ns: FAIRCAM_NS, name: 'operational-efficacy', value: String(eff.operational_efficacy) },
      { ns: FAIRCAM_NS, name: 'coverage', value: String(eff.coverage) },
    );
    if (eff.upper_bound_only) {
      props.push({ ns: FAIRCAM_NS, name: 'efficacy-caveat', value: 'upper-bound-only: variance_started_at equals variance_detected_at' });
    }
  }
  return props;
}

export const stableStringify = (obj) => JSON.stringify(obj, null, 2) + '\n';
