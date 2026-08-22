/**
 * O2 — Catalog and Profiles.
 *
 * THE CATALOG holds our controls, with our text. It does not hold framework requirement text; the
 * framework identifiers appear as crosswalk links and as profile selections, never with their
 * prose. SCF is CC BY-ND with an explicit prohibition on AI-generated derivatives, and CI greps
 * for violations. See docs/adr/0003-no-framework-text.md.
 *
 * THE PROFILE is the piece almost everyone skips, and it is the difference between a Statement of
 * Applicability that is defensible and one that is a spreadsheet nobody can justify. It records
 * WHY each control is in or out of a baseline. An SoA is supposed to prove exactly that.
 *
 * A NOTE ON THE STATEMENT PROSE. cui-control-plane's control records carry an authored `assertion`
 * field and use it as the catalog statement. This repo's schema has no such field — see
 * schemas/control.schema.json. Rather than invent an assertion, the statement is the
 * population_definition, which is the text that actually says what is being quantified over, and
 * the title carries the claim. If an `assertion` field is added later, this is the line that
 * changes and nothing else.
 */

import { metadata, controlProps, crosswalkLinks, crosswalkEdges, ref, resource, sortKeys, ids, PROPS_NS, FILENAMES } from './common.mjs';

export function emitCatalog({ controls, assertions = [] }) {
  return {
    catalog: {
      uuid: ids.document('catalog'),
      metadata: metadata({ title: 'Reco house control catalog', assertions }),
      groups: groupsByDomain(controls),
    },
  };
}

function groupsByDomain(controls) {
  const byDomain = new Map();
  for (const c of controls) {
    const domain = c.control_id.split('.')[1];
    byDomain.set(domain, [...(byDomain.get(domain) ?? []), c]);
  }

  return [...byDomain.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([domain, group]) => ({
      id: `grp-${domain}`,
      title: domain,
      controls: group
        .slice()
        .sort((a, b) => a.control_id.localeCompare(b.control_id))
        .map(catalogControl),
    }));
}

function catalogControl(c) {
  return {
    id: c.control_id,
    title: c.title,
    props: controlProps(c),
    // OSCAL constrains control part names: a top-level part must be `overview`, `statement`,
    // `guidance` or an assessment part, and `item` is legal ONLY nested inside a statement.
    // Emitting `item` at the top level trips oscal-control-part-name and
    // oscal-control-statement-part-name together.
    parts: [
      {
        id: `${c.control_id}_smt`,
        name: 'statement',
        prose: c.population_definition.trim(),
        parts: [
          {
            id: `${c.control_id}_evidence`,
            name: 'item',
            title: 'Evidence',
            prose: `Collected from ${c.source_system} by ${c.query_ref}. The query is the evidence: re-running it at as_of reproduces the result, which is strictly stronger than a sample or a screenshot.`,
          },
          ...(c.notes ? [{ id: `${c.control_id}_notes`, name: 'item', title: 'Notes', prose: c.notes.trim() }] : []),
          ...(c.applicability_note
            ? [{ id: `${c.control_id}_applicability`, name: 'item', title: 'Applicability', prose: c.applicability_note.trim() }]
            : []),
        ],
      },
    ],
    links: crosswalkLinks(c),
  };
}

/**
 * One profile per framework that any control crosswalks to. Derived from the inventory rather than
 * hardcoded, so a new framework appearing in a crosswalk produces a baseline without anyone
 * remembering to add one.
 */
export function frameworksIn(controls) {
  const frameworks = new Set();
  for (const c of controls) for (const { framework } of crosswalkEdges(c)) frameworks.add(framework);
  return [...frameworks].sort();
}

export function emitProfiles({ controls, assertions = [] }) {
  return frameworksIn(controls).map((framework) => {
    const included = controls
      .filter((c) => crosswalkEdges(c).some((e) => e.framework === framework))
      .sort((a, b) => a.control_id.localeCompare(b.control_id));
    const excluded = controls
      .filter((c) => !crosswalkEdges(c).some((e) => e.framework === framework))
      .sort((a, b) => a.control_id.localeCompare(b.control_id));

    return { framework, key: framework, doc: profile({ framework, included, excluded, assertions }) };
  });
}

function profile({ framework, included, excluded, assertions }) {
  return {
    profile: {
      uuid: ids.document(`profile|${framework}`),
      metadata: metadata({ title: `Reco baseline — ${framework}`, assertions }),
      imports: [
        {
          href: ref('catalog'),
          'include-controls': [{ 'with-ids': included.map((c) => c.control_id) }],
        },
      ],
      merge: { 'as-is': true },
      'back-matter': {
        resources: [
          // The import href is a UUID fragment, so it needs something in back-matter to land on.
          // Without this the profile references a catalog the validator cannot resolve — the same
          // class of failure as the dangling import-ap this repo shipped before B18.
          resource('catalog', 'Reco house control catalog', FILENAMES.catalog),
          {
            uuid: ids.document(`profile-tailoring|${framework}`),
            title: 'Tailoring statement',
            description: tailoring({ framework, included, excluded }),
            props: [
              { ns: PROPS_NS, name: 'framework', value: framework },
              { ns: PROPS_NS, name: 'controls-in-scope', value: String(included.length) },
              { ns: PROPS_NS, name: 'controls-out-of-scope', value: String(excluded.length) },
            ],
          },
        ],
      },
    },
  };
}

/**
 * The tailoring statement — the reason this profile exists.
 *
 * Inclusion is derived, not asserted: a control is in this baseline exactly when it crosswalks to
 * this framework, and the crosswalk edge names which clause it claims. Exclusion is stated the same
 * way and for the same reason, so an absence is a recorded decision rather than something a reader
 * has to notice.
 *
 * What this deliberately does NOT claim: that the framework's requirement set is covered. That is a
 * different question — it runs from the requirement index toward the controls, not from the
 * controls outward — and `npm run gap -- --direction coverage` answers it. Implying coverage here
 * from a selection of our own controls is precisely the move that makes most SoAs worthless.
 */
function tailoring({ framework, included, excluded }) {
  const lines = [
    `Baseline for ${framework}, derived from the control inventory rather than authored alongside it.`,
    '',
    `IN SCOPE (${included.length}). A control is selected exactly when it crosswalks to ${framework}; ` +
      'the crosswalk edge on each control names the clause it claims.',
  ];

  for (const c of included) {
    const items = crosswalkEdges(c).filter((e) => e.framework === framework).map((e) => e.item);
    lines.push(`  - ${c.control_id} [${c.status}] -> ${items.join(', ')}`);
  }

  lines.push(
    '',
    `OUT OF SCOPE (${excluded.length}). Excluded deliberately, not omitted: these controls carry no ` +
      `${framework} crosswalk edge, so they make no claim against this framework and importing them ` +
      'would put unrelated failures into this baseline.',
  );
  for (const c of excluded) lines.push(`  - ${c.control_id} [${c.status}] -> no ${framework} edge`);

  lines.push(
    '',
    'This statement records selection, NOT coverage. Whether the framework\'s own requirement set is ' +
      'fully claimed runs the other direction — from the requirement index toward the controls — and ' +
      'is reported by `npm run gap -- --direction coverage`. Inferring coverage from a selection of ' +
      'our own controls is the error that makes most Statements of Applicability indefensible.',
  );

  return lines.join('\n');
}

export { sortKeys };
