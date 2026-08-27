/**
 * O1 — Component Definition.
 *
 * One component per control. OSCAL's `type` is a closed list, and a control is a procedure rather
 * than a piece of software, so `process-procedure` is the honest choice — `software` would name the
 * system the control is measured on, which is a different thing and would make the catalog and this
 * document disagree about what a component is.
 *
 * This is where the FAIR-CAM props extension earns its keep: OSCAL has nowhere to carry control
 * measurement, so the function tagging rides in a namespace the organization controls. A tool that does not
 * know the namespace ignores it; a tool that does gets the risk layer along with the compliance
 * layer.
 */

import { metadata, controlProps, faircamProps, crosswalkLinks, ref, resource, ids, PROPS_NS, FILENAMES } from './common.mjs';

export function emitComponentDefinition({ controls, assertions = [] }) {
  const byControl = new Map(assertions.map((a) => [a.control_id, a]));

  return {
    'component-definition': {
      uuid: ids.document('component-definition'),
      metadata: metadata({ title: 'GRC Program control components', assertions }),
      components: controls
        .slice()
        .sort((a, b) => a.control_id.localeCompare(b.control_id))
        .map((c) => component(c, byControl.get(c.control_id))),
      'back-matter': {
        resources: [resource('catalog', 'GRC Program house control catalog', FILENAMES.catalog)],
      },
    },
  };
}

function component(c, assertion) {
  return {
    uuid: ids.component(c.control_id),
    type: 'process-procedure',
    title: c.title,
    description: c.population_definition.trim(),
    props: [...controlProps(c), ...faircamProps(c, assertion?.as_of ?? null)],
    links: crosswalkLinks(c),
    'control-implementations': [
      {
        uuid: ids.implementedRequirement(c.control_id, 'catalog', 'impl'),
        source: ref('catalog'),
        description:
          `Implements ${c.control_id} as defined in the house catalog. The implementation IS the ` +
          `query at ${c.query_ref}: its WHERE clause is the population definition, and drift ` +
          'between the two is a finding rather than a documentation problem.',
        'implemented-requirements': [
          {
            uuid: ids.implementedRequirement(c.control_id, 'catalog', 'req'),
            'control-id': c.control_id,
            description: describeState(c, assertion),
            props: [
              { ns: PROPS_NS, name: 'implementation-status', value: c.status },
              ...(assertion
                ? [
                    { ns: PROPS_NS, name: 'population-total', value: String(assertion.total) },
                    { ns: PROPS_NS, name: 'population-failing', value: String(assertion.failing_count) },
                    { ns: PROPS_NS, name: 'confidence-tier', value: String(assertion.confidence_tier) },
                  ]
                : []),
            ],
          },
        ],
      },
    ],
  };
}

/**
 * What is said about a control with no assertion behind it.
 *
 * Deliberately not softened. A control at `building` with no evidence is described as exactly that,
 * because a component definition that reads the same whether or not the control is measured is the
 * artifact that lets a planned control reach a customer questionnaire as an operating one.
 */
function describeState(c, assertion) {
  if (!assertion) {
    return (
      `Status ${c.status}. NO ASSERTION RECORD EXISTS for this control, so nothing here is a ` +
      `measurement of its operation. Collection is ${c.collection?.cadence ?? 'not yet scheduled'} ` +
      `via ${c.collection?.mechanism ?? 'an unwired mechanism'} from ${c.source_system}.`
    );
  }
  return (
    `Status ${c.status}. Most recent assertion ${assertion.as_of}: ${assertion.passing_count} of ` +
    `${assertion.total} subjects in the intended state, ${assertion.failing_count} outside it. ` +
    `${assertion.coverage_basis}`
  );
}
