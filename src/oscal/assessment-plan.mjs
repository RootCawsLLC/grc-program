/**
 * O2/O3 bridge — Assessment Plan.
 *
 * B18 lists five models and this is not one of them. It is here because oscal-cli proved it was
 * required: assessment-results carries `import-ap`, the validator RESOLVES that href and follows it,
 * and this repo's assessment-results was failing with FODC0002 against an assessment-plan nobody
 * had ever generated. A dangling document reference is not a warning in OSCAL, it is a hard failure
 * with a Java stack trace and no schema message to explain it.
 *
 * It is also the honest document to have. An assessment plan says what will be tested and how,
 * ahead of the result — which for continuous monitoring is the collection cadence. Everything below
 * is derived from the control records' own `collection` block, so the plan cannot claim a cadence
 * the inventory does not declare.
 */

import { metadata, ref, resource, ids, PROPS_NS, FILENAMES } from './common.mjs';

export function emitAssessmentPlan({ controls, assertions = [] }) {
  const sorted = controls.slice().sort((a, b) => a.control_id.localeCompare(b.control_id));

  return {
    'assessment-plan': {
      uuid: ids.document('assessment-plan'),
      metadata: metadata({ title: 'GRC Program continuous control assessment plan', assertions }),
      'import-ssp': { href: ref('ssp') },
      'reviewed-controls': {
        description:
          'Every control in the inventory is in continuous scope. There is no sampling frame here ' +
          'because there is no sampling: each control test returns its full population, so the ' +
          'assessment target is the whole denominator on every cycle.',
        'control-selections': [
          {
            description: 'All controls in the house catalog.',
            'include-controls': sorted.map((c) => ({ 'control-id': c.control_id })),
          },
        ],
      },
      'assessment-subjects': [
        {
          type: 'component',
          description:
            'The control test layer. Each subject is the population a control quantifies over, ' +
            'enumerated by its query rather than selected by an assessor.',
          'include-all': {},
        },
      ],
      tasks: sorted.map(collectionTask),
      'back-matter': {
        resources: [
          resource('ssp', 'GRC Program system security plan (generated)', FILENAMES.ssp),
          resource('catalog', 'GRC Program house control catalog', FILENAMES.catalog),
        ],
      },
    },
  };
}

/**
 * One task per control, describing how its evidence is collected.
 *
 * A control whose `collection` block is absent gets a task that says so rather than a plausible
 * default. "Collected daily by API" written about a control nobody has wired is the kind of
 * sentence that survives into an audit unchallenged.
 */
function collectionTask(c) {
  const cadence = c.collection?.cadence ?? null;
  const mechanism = c.collection?.mechanism ?? null;

  return {
    uuid: ids.resource(`task|${c.control_id}`),
    type: 'action',
    title: `Collect ${c.control_id}`,
    description: cadence
      ? `Collected ${cadence} from ${c.source_system} by ${mechanism ?? 'an unspecified mechanism'}. ` +
        `The query at ${c.query_ref} returns the full population; its WHERE clause is the population ` +
        'definition.'
      : `NOT YET SCHEDULED. This control declares no collection cadence, so no evidence is produced ` +
        `for it on any interval. The intended query is ${c.query_ref}.`,
    props: [
      { ns: PROPS_NS, name: 'control-id', value: c.control_id },
      { ns: PROPS_NS, name: 'source-system', value: c.source_system },
      ...(cadence ? [{ ns: PROPS_NS, name: 'cadence', value: cadence }] : [{ ns: PROPS_NS, name: 'cadence', value: 'none' }]),
      ...(mechanism ? [{ ns: PROPS_NS, name: 'mechanism', value: mechanism }] : []),
    ],
    // `associated-activity` carries `activity-uuid` (the reference) and NOT its own `uuid` — an
    // extra one is rejected outright rather than ignored. It is an association, not an object with
    // an identity of its own.
    'associated-activities': [
      {
        'activity-uuid': ids.resource(`activity-def|${c.control_id}`),
        subjects: [{ type: 'component', 'include-all': {} }],
      },
    ],
  };
}
