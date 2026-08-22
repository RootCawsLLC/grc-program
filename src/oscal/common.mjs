/**
 * Shared conventions for every OSCAL artifact. Six models are emitted from one control inventory,
 * and the properties below are what make them a package rather than six files.
 *
 * Several of these encode a constraint that is invisible in the spec prose and only shows up when
 * oscal-cli runs. Each is commented where it is enforced; they were paid for once already in
 * RootCawsLLC/cui-control-plane and are not worth rediscovering.
 */

import { uuid5 } from '../lib/uuid5.mjs';
import { isFixtureSet, FIXTURE_STAMP, fixtureNotice } from '../lib/load.mjs';

/** Our own namespaces. Anything that is not OSCAL's rides on one of these — that is what a namespace is for. */
export const PROPS_NS = 'https://reco.ai/ns/grc';
export const FAIRCAM_NS = 'https://reco.ai/ns/faircam';

/**
 * Pinned, and matched to what oscal-cli 3.2.0 validates against. Bumping this is a deliberate act:
 * it changes what every emitted document claims conformance to, and the gate is what proves the
 * claim rather than a comment asserting it.
 */
export const OSCAL_VERSION = '1.1.3';

/**
 * Every UUID in every artifact comes through here. Natural keys are stable ones — control_id, or
 * control_id plus as_of — never a filename, never an array position, never the clock.
 */
export const ids = {
  document: (kind) => uuid5(`document|${kind}`),
  component: (controlId) => uuid5(controlId),
  implementedRequirement: (controlId, framework, item) => uuid5(`${controlId}|${framework}|${item}`),
  result: (controlId, asOf) => uuid5(`${controlId}|${asOf}`),
  observation: (controlId, asOf, subject) => uuid5(`${controlId}|${asOf}|${subject}`),
  finding: (controlId, asOf) => uuid5(`finding|${controlId}|${asOf}`),
  poamItem: (controlId, subjectId) => uuid5(`poam|${controlId}|${subjectId}`),
  party: (name) => uuid5(`party|${name}`),
  resource: (kind) => uuid5(`resource|${kind}`),
};

/**
 * Cross-document references.
 *
 * OSCAL resolves `#…` fragments as UUIDs and WILL try to follow them. A readable fragment like
 * `#catalog` is not an error you can see by eye — it fails inside the validator with
 * "Invalid UUID string". Worse, a document-level `href` that points at a file which does not exist
 * fails with FODC0002 and a Java stack trace: that is exactly how this repo's assessment-results
 * was failing before B18, via an `import-ap` pointing at an assessment-plan nobody emitted.
 *
 * So: reference documents by deterministic UUID, and give every reference something to land on.
 */
export const ref = (kind) => `#${ids.document(kind)}`;

/** A back-matter resource so a `ref()` fragment resolves to a real emitted file rather than dangling. */
export const resource = (kind, title, filename) => ({
  uuid: ids.document(kind),
  title,
  rlinks: [{ href: `./${filename}` }],
});

/**
 * Crosswalk links use a URN, not a fragment, for the same reason. A crosswalk target is an
 * external identifier — not a document in this package — and modelling it as `#soc2:CC6.1` invites
 * the validator to resolve a fragment that was never going to exist.
 *
 * IDENTIFIERS ONLY. No framework text travels through here or anywhere else in this package.
 * See docs/adr/0003-no-framework-text.md; CI greps for it.
 */
export const crosswalkHref = (framework, reference) =>
  `urn:reco:grc:${framework}:${encodeURIComponent(reference)}`;

/**
 * `last-modified` is the hardest part of byte-stability: OSCAL requires it, and setting it from the
 * clock makes every export differ from the last even when nothing changed — destroying the exact
 * property the deterministic UUIDs exist to create.
 *
 * So it comes from the CONTENT: the newest as_of in the evidence, or a fixed epoch when there is
 * none. An unchanged inventory re-exports byte-identically; a real change moves the timestamp
 * because a real change moves the evidence.
 */
export const EPOCH = '1970-01-01T00:00:00.000Z';

export function lastModified(assertions = []) {
  if (!assertions.length) return EPOCH;
  return assertions.map((a) => a.as_of).sort().at(-1);
}

export function metadata({ title, assertions = [], version = '0.1.0', subject = 'This package' }) {
  const fixture = isFixtureSet(assertions);
  return {
    title: fixture ? `${title} [${FIXTURE_STAMP}]` : title,
    'last-modified': lastModified(assertions),
    version,
    'oscal-version': OSCAL_VERSION,
    ...(fixture ? { remarks: fixtureNotice(subject) } : {}),
  };
}

/**
 * FAIR-CAM measurement on OSCAL props. OSCAL has nowhere to carry control measurement, so it rides
 * in a namespace Reco controls. Spec-legal, ignorable by tools that do not know the namespace, and
 * it makes the package carry the risk layer rather than only the compliance layer.
 */
export function faircamProps(control, asOf = null) {
  const props = [];
  for (const f of control.faircam ?? []) {
    props.push({ ns: FAIRCAM_NS, name: 'function', value: f.function, class: f.primary ? 'primary' : 'secondary' });
  }
  if (control.collection?.variance_started_at_quality) {
    props.push({ ns: FAIRCAM_NS, name: 'variance-started-at-quality', value: control.collection.variance_started_at_quality });
  }
  if (asOf) props.push({ ns: FAIRCAM_NS, name: 'as-of', value: asOf });
  return props;
}

/**
 * Control-record props. Only `label` belongs in OSCAL's own namespace — prop names there are
 * constrained, and `status` in particular has a fixed allowed-values list (`withdrawn`) that this
 * repo's lifecycle states are not part of. Emitting `status: building` unnamespaced is a
 * constraint violation, not an extension.
 */
export function controlProps(control) {
  const props = [
    { name: 'label', value: control.control_id },
    { ns: PROPS_NS, name: 'status', value: control.status },
    { ns: PROPS_NS, name: 'layer', value: control.layer },
    { ns: PROPS_NS, name: 'owner', value: control.owner },
    { ns: PROPS_NS, name: 'source-system', value: control.source_system },
    { ns: PROPS_NS, name: 'query-ref', value: control.query_ref },
  ];
  if (control.collection?.cadence) props.push({ ns: PROPS_NS, name: 'collection-cadence', value: control.collection.cadence });
  if (control.collection?.mechanism) props.push({ ns: PROPS_NS, name: 'collection-mechanism', value: control.collection.mechanism });
  return props;
}

/**
 * Crosswalk edges flattened from the record's `{framework: [ids]}` shape.
 *
 * Note what is NOT here: confidence and basis. cui-control-plane's records carry them per edge and
 * this repo's do not — its crosswalk is a bare identifier list. Emitting an invented confidence
 * would be worse than emitting none, so the link text carries the identifier alone.
 */
export function crosswalkEdges(control) {
  const out = [];
  for (const [framework, items] of Object.entries(control.crosswalk ?? {})) {
    for (const item of items ?? []) out.push({ framework, item });
  }
  return out.sort((a, b) => `${a.framework}|${a.item}`.localeCompare(`${b.framework}|${b.item}`));
}

export const crosswalkLinks = (control) =>
  crosswalkEdges(control).map(({ framework, item }) => ({
    href: crosswalkHref(framework, item),
    rel: 'related',
    text: `${framework} ${item}`,
  }));

/** Recursively sorts object keys so serialization is stable regardless of construction order. */
export function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
}

/** One serializer for every artifact: sorted keys, two-space indent, trailing newline. */
export const serialize = (doc) => `${JSON.stringify(sortKeys(doc), null, 2)}\n`;

/** The filenames every emitter writes to, and every cross-reference resolves against. */
export const FILENAMES = {
  catalog: 'oscal-catalog.json',
  'component-definition': 'oscal-component-definition.json',
  'assessment-plan': 'oscal-assessment-plan.json',
  'assessment-results': 'oscal-assessment-results.json',
  poam: 'oscal-poam.json',
  ssp: 'oscal-ssp.json',
};

export const profileFilename = (key) => `oscal-profile-${key}.json`;
