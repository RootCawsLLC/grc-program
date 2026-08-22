/**
 * O5 — System Security Plan. GENERATED, never hand-authored.
 *
 * If this cannot be regenerated from catalog + profile + component definitions, the control model
 * is incomplete and the gap is in the model, not in the SSP. Treat a hand-edited SSP as a bug: the
 * moment prose lives only here, the SSP and the thing it describes start drifting and only the
 * auditor finds out.
 *
 * PLACEHOLDERS ARE DECLARED, NOT SILENT. OSCAL requires a security sensitivity level, impact
 * levels, information types and an authorization boundary. None of those are derivable from a
 * control inventory, and none have been decided. They are emitted with an explicit
 * `derivation: assumed` prop and named in remarks, so a reader cannot mistake a required-field
 * filler for a categorisation anybody performed. Filling them with plausible values would be the
 * more dangerous choice.
 */

import { metadata, controlProps, faircamProps, ref, resource, ids, PROPS_NS, FILENAMES, profileFilename } from './common.mjs';
import { frameworksIn } from './catalog.mjs';

const PLACEHOLDER = { ns: PROPS_NS, name: 'derivation', value: 'assumed' };

/**
 * Which profile the SSP claims. SOC 2 when present because it is the operative report, otherwise
 * the first framework alphabetically. Either way it is a DECISION, recorded in remarks rather than
 * buried, and `baseline` overrides it.
 */
export function chooseBaseline(controls, baseline = null) {
  const frameworks = frameworksIn(controls);
  if (baseline && frameworks.includes(baseline)) return baseline;
  return frameworks.includes('soc2') ? 'soc2' : frameworks[0];
}

export function emitSsp({ controls, assertions = [], baseline = null }) {
  const framework = chooseBaseline(controls, baseline);
  const byControl = new Map(assertions.map((a) => [a.control_id, a]));
  const sorted = controls.slice().sort((a, b) => a.control_id.localeCompare(b.control_id));
  const owners = [...new Set(controls.map((c) => c.owner))].sort();

  return {
    'system-security-plan': {
      uuid: ids.document('ssp'),
      metadata: {
        ...metadata({ title: 'Reco system security plan (generated)', assertions }),
        // A role-id used anywhere in the document must be DECLARED here. OSCAL indexes role ids
        // and reports an unresolved key reference, not a missing-field error, so the failure shows
        // up as `oscal-index-metadata-role-id: Key reference [control-owner] not found` at the use
        // site rather than at the omission.
        roles: [
          {
            id: 'control-owner',
            title: 'Control owner',
            description: 'Operates and remediates the controls attributed to this team in the inventory.',
          },
        ],
        parties: owners.map((owner) => ({
          uuid: ids.party(owner),
          type: 'organization',
          name: owner,
        })),
      },
      'import-profile': { href: ref(`profile|${framework}`) },
      'system-characteristics': systemCharacteristics(framework, sorted, assertions),
      'system-implementation': systemImplementation(sorted, owners, byControl),
      'control-implementation': {
        description:
          'Every implemented requirement below is generated from a control record. The prose is the ' +
          'control\'s population definition and the evidence is its query — neither is authored here, ' +
          'so this document cannot drift from the inventory it describes.',
        'implemented-requirements': sorted.map((c) => implementedRequirement(c, byControl.get(c.control_id))),
      },
      'back-matter': {
        resources: [
          resource('catalog', 'Reco house control catalog', FILENAMES.catalog),
          resource(`profile|${framework}`, `Reco baseline — ${framework}`, profileFilename(framework)),
          resource('component-definition', 'Reco control components', FILENAMES['component-definition']),
        ],
      },
    },
  };
}

function systemCharacteristics(framework, controls, assertions) {
  const measured = assertions.length;
  return {
    'system-ids': [{ id: 'reco-grc', 'identifier-type': 'https://reco.ai/ns/grc/system-id' }],
    'system-name': 'Reco',
    description:
      `The system as described by ${controls.length} controls in the house catalog, tailored to the ` +
      `${framework} baseline. ${measured} of them carry an assertion record; the remainder are ` +
      'described by status alone and are not claimed to be operating.',
    props: [{ ns: PROPS_NS, name: 'generated', value: 'true' }],
    'security-sensitivity-level': 'fips-199-moderate',
    'system-information': {
      'information-types': [
        {
          uuid: ids.resource('information-type|unclassified'),
          title: 'Not yet categorised',
          description:
            'PLACEHOLDER. No information-type categorisation has been performed. This entry exists ' +
            'because OSCAL requires at least one, and it is labelled rather than guessed.',
          props: [PLACEHOLDER],
          'confidentiality-impact': { base: 'fips-199-moderate' },
          'integrity-impact': { base: 'fips-199-moderate' },
          'availability-impact': { base: 'fips-199-moderate' },
        },
      ],
    },
    'security-impact-level': {
      'security-objective-confidentiality': 'fips-199-moderate',
      'security-objective-integrity': 'fips-199-moderate',
      'security-objective-availability': 'fips-199-moderate',
    },
    status: { state: 'under-development' },
    'authorization-boundary': {
      description:
        'PLACEHOLDER. The authorization boundary has not been drawn. What is described here is the ' +
        'control inventory, which is not the same thing: a boundary is a decision about scope and ' +
        'this document must not be read as having made it.',
      props: [PLACEHOLDER],
    },
    remarks:
      'GENERATED DOCUMENT — do not hand-edit. Regenerate with `npm run emit`. Four fields are ' +
      'required by OSCAL and not derivable from a control inventory: security-sensitivity-level, ' +
      'security-impact-level, the information type, and the authorization boundary. Each is marked ' +
      `derivation=assumed. The baseline claimed is ${framework}, chosen because it is the operative ` +
      'framework, and that choice is a decision rather than a derivation.',
  };
}

function systemImplementation(controls, owners, byControl) {
  return {
    users: owners.map((owner) => ({
      uuid: ids.party(`user|${owner}`),
      title: owner,
      'role-ids': ['control-owner'],
      'authorized-privileges': [
        {
          title: 'Control ownership',
          'functions-performed': ['Operate and remediate the controls owned by this team'],
        },
      ],
    })),
    components: controls.map((c) => ({
      uuid: ids.component(c.control_id),
      type: 'process-procedure',
      title: c.title,
      description: c.population_definition.trim(),
      status: { state: c.status === 'operating' ? 'operational' : 'under-development' },
      props: [...controlProps(c), ...faircamProps(c, byControl.get(c.control_id)?.as_of ?? null)],
    })),
  };
}

function implementedRequirement(c, assertion) {
  return {
    uuid: ids.implementedRequirement(c.control_id, 'ssp', 'req'),
    'control-id': c.control_id,
    // `implemented-requirement` has NO `description` in the SSP model — the prose belongs in
    // `remarks`, or in `statements` when it is per-statement. Emitting `description` is rejected
    // as an extraneous key, and the CLI also logs it as an unhandled field it silently dropped,
    // which is the more dangerous half: without the schema error the text would just vanish.
    remarks: assertion
      ? `Measured ${assertion.as_of}: ${assertion.passing_count} of ${assertion.total} subjects in ` +
        `the intended state. ${assertion.coverage_basis} Evidence is ${assertion.query_ref}.`
      : `Status ${c.status}. No assertion record exists, so this requirement is described but NOT ` +
        `claimed to be operating. Evidence would come from ${c.query_ref}.`,
    props: [
      { ns: PROPS_NS, name: 'implementation-status', value: c.status },
      ...(assertion ? [] : [{ ns: PROPS_NS, name: 'evidence', value: 'none' }]),
    ],
    'by-components': [
      {
        'component-uuid': ids.component(c.control_id),
        uuid: ids.implementedRequirement(c.control_id, 'ssp', 'by-component'),
        description: `Implemented by the control test at ${c.query_ref}.`,
      },
    ],
  };
}
