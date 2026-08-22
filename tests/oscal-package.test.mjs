import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildPackage } from '../src/oscal/emit.mjs';
import { serialize, FILENAMES, profileFilename } from '../src/oscal/common.mjs';
import { frameworksIn } from '../src/oscal/catalog.mjs';
import { chooseBaseline } from '../src/oscal/ssp.mjs';
import { loadYamlDir } from '../src/validate.mjs';
import { loadAssertions } from '../src/lib/load.mjs';

let controls, assertions, docs;
before(async () => {
  controls = await loadYamlDir('controls');
  assertions = await loadAssertions();
  docs = buildPackage({ controls, assertions });
});

const doc = (name) => docs[name];
const ssp = () => doc(FILENAMES.ssp)['system-security-plan'];
const plan = () => doc(FILENAMES['assessment-plan'])['assessment-plan'];

// ── the package ──────────────────────────────────────────────────────────────────────────────

test('every model B18 asks for is emitted, plus the assessment-plan it turned out to require', () => {
  for (const key of ['catalog', 'component-definition', 'assessment-plan', 'assessment-results', 'poam', 'ssp']) {
    assert.ok(docs[FILENAMES[key]], `missing ${key}`);
  }
  assert.ok(frameworksIn(controls).length > 0);
  for (const f of frameworksIn(controls)) assert.ok(docs[profileFilename(f)], `missing profile ${f}`);
});

test('every artifact re-exports byte-identically on unchanged input', () => {
  const again = buildPackage({ controls, assertions });
  for (const name of Object.keys(docs)) {
    assert.equal(serialize(docs[name]), serialize(again[name]), `${name} is not deterministic`);
  }
});

test('no artifact carries a generation timestamp or a random uuid', () => {
  // The two fields that make an otherwise-unchanged export produce a dirty diff. last-modified is
  // derived from the evidence, so it moves only when the evidence moves.
  const stamps = new Set();
  for (const d of Object.values(docs)) {
    const root = Object.values(d)[0];
    stamps.add(root.metadata['last-modified']);
  }
  const expected = assertions.map((a) => a.as_of).sort().at(-1);
  assert.deepEqual([...stamps], [expected], 'last-modified must come from the evidence, not the clock');
});

// ── the regression that started B18 ──────────────────────────────────────────────────────────

test('every document href resolves to a document this package actually emits', () => {
  // assessment-results shipped an `import-ap` pointing at ./assessment-plan.json, which nothing
  // emitted. oscal-cli follows document hrefs and rejected the whole file with FODC0002 and a Java
  // stack trace — no schema message, nothing to read. This is that failure, pinned.
  const uuids = new Set(Object.values(docs).map((d) => Object.values(d)[0].uuid));

  const hrefs = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('import') && v && typeof v === 'object' && typeof v.href === 'string') hrefs.push(v.href);
      else walk(v);
    }
  };
  Object.values(docs).forEach(walk);

  assert.ok(hrefs.length >= 3, 'expected import-ssp / import-ap / import-profile references');
  for (const href of hrefs) {
    assert.ok(href.startsWith('#'), `document href must be a UUID fragment, got ${href}`);
    assert.ok(uuids.has(href.slice(1)), `href ${href} resolves to no emitted document`);
  }
});

test('every UUID fragment reference has a back-matter resource to land on', () => {
  for (const [name, d] of Object.entries(docs)) {
    const root = Object.values(d)[0];
    const imports = Object.entries(root).filter(([k]) => k.startsWith('import')).map(([, v]) => v?.href).filter(Boolean);
    if (!imports.length) continue;
    const landing = new Set((root['back-matter']?.resources ?? []).map((r) => `#${r.uuid}`));
    for (const href of imports) assert.ok(landing.has(href), `${name}: ${href} has no back-matter resource`);
  }
});

// ── the two schema traps, pinned so they cannot come back ─────────────────────────────────────

test('SSP implemented-requirements carry remarks, never description', () => {
  // `description` is not a field on implemented-requirement. oscal-cli rejects it AND separately
  // logs it as an unhandled field it dropped — the dangerous half, since without the schema error
  // the prose would silently vanish from the document.
  for (const r of ssp()['control-implementation']['implemented-requirements']) {
    assert.equal(r.description, undefined, `${r['control-id']} must not carry description`);
    assert.ok(r.remarks, `${r['control-id']} must carry remarks`);
  }
});

test('assessment-plan associated-activities carry activity-uuid and no uuid of their own', () => {
  for (const t of plan().tasks) {
    for (const a of t['associated-activities'] ?? []) {
      assert.equal(a.uuid, undefined, 'an association is not an object with its own identity');
      assert.ok(a['activity-uuid']);
    }
  }
});

test('every role-id used is declared in metadata.roles', () => {
  // OSCAL indexes role ids and reports an unresolved key reference at the USE site, not at the
  // omission, so this fails a long way from its cause.
  const declared = new Set((ssp().metadata.roles ?? []).map((r) => r.id));
  for (const u of ssp()['system-implementation'].users) {
    for (const id of u['role-ids'] ?? []) assert.ok(declared.has(id), `role ${id} is used but not declared`);
  }
});

// ── licensing (docs/adr/0003) ────────────────────────────────────────────────────────────────

test('crosswalks travel as identifiers and URNs, never as framework text', () => {
  const json = Object.values(docs).map(serialize).join('\n');
  // A crosswalk target must be an external URN, never a fragment the validator would try to resolve.
  assert.match(json, /urn:reco:grc:soc2:CC6\.1/);

  for (const d of Object.values(docs)) {
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      if (typeof node.href === 'string' && node.href.startsWith('urn:reco:grc:')) {
        // Link text may name the identifier. It must not paraphrase the requirement.
        const [, , , framework, item] = node.href.split(':');
        assert.equal(node.text, `${framework} ${decodeURIComponent(item)}`, 'crosswalk link text must be the identifier alone');
      }
      Object.values(node).forEach(walk);
    };
    walk(d);
  }
});

// ── the profile, which is the point of the unit ──────────────────────────────────────────────

test('a profile records what is OUT and why, not only what is in', () => {
  const framework = frameworksIn(controls)[0];
  const p = doc(profileFilename(framework)).profile;
  const tailoring = p['back-matter'].resources.find((r) => r.title === 'Tailoring statement');

  assert.ok(tailoring, 'every profile must carry a tailoring statement');
  assert.match(tailoring.description, /IN SCOPE \(\d+\)/);
  assert.match(tailoring.description, /OUT OF SCOPE \(\d+\)/);
  assert.match(tailoring.description, /Excluded deliberately, not omitted/);

  // Selection and coverage are different questions and the statement must not conflate them.
  assert.match(tailoring.description, /records selection, NOT coverage/);

  const included = p.imports[0]['include-controls'][0]['with-ids'];
  const mentioned = controls.filter((c) => tailoring.description.includes(c.control_id));
  assert.equal(mentioned.length, controls.length, 'every control must be accounted for, in or out');
  assert.ok(included.length > 0 && included.length <= controls.length);
});

test('profile selection is derived from the crosswalk, not asserted separately', () => {
  for (const framework of frameworksIn(controls)) {
    const included = doc(profileFilename(framework)).profile.imports[0]['include-controls'][0]['with-ids'];
    const expected = controls
      .filter((c) => Object.keys(c.crosswalk ?? {}).includes(framework) && (c.crosswalk[framework] ?? []).length)
      .map((c) => c.control_id)
      .sort();
    assert.deepEqual(included, expected, `${framework} selection drifted from the crosswalk`);
  }
});

// ── honesty about unmeasured things ──────────────────────────────────────────────────────────

test('a control with no assertion is not described as operating', () => {
  const measured = new Set(assertions.map((a) => a.control_id));
  const cd = doc(FILENAMES['component-definition'])['component-definition'];
  for (const component of cd.components) {
    const id = component.props.find((p) => p.name === 'label').value;
    const req = component['control-implementations'][0]['implemented-requirements'][0];
    if (measured.has(id)) continue;
    assert.match(req.description, /NO ASSERTION RECORD EXISTS/, `${id} must say it is unmeasured`);
  }
});

test('SSP placeholders are declared rather than filled with plausible values', () => {
  const chars = ssp()['system-characteristics'];
  assert.match(chars['authorization-boundary'].description, /PLACEHOLDER/);
  assert.ok(chars['authorization-boundary'].props.some((p) => p.name === 'derivation' && p.value === 'assumed'));
  const infoType = chars['system-information']['information-types'][0];
  assert.match(infoType.description, /PLACEHOLDER/);
  assert.ok(infoType.props.some((p) => p.name === 'derivation' && p.value === 'assumed'));
  assert.match(chars.remarks, /GENERATED DOCUMENT/);
});

test('the SSP baseline is a recorded decision, not an accident of ordering', () => {
  assert.equal(chooseBaseline(controls), 'soc2');
  assert.equal(chooseBaseline(controls, 'gdpr'), 'gdpr');
  // An unknown baseline falls back rather than emitting a reference to a profile that is not there.
  assert.equal(chooseBaseline(controls, 'not-a-framework'), 'soc2');
  assert.match(ssp()['system-characteristics'].remarks, /baseline claimed is soc2/);
});

test('POA&M enumerates one item per failing subject and says when variance is unavailable', () => {
  const items = doc(FILENAMES.poam)['plan-of-action-and-milestones']['poam-items'];
  const failing = assertions.flatMap((a) => a.failing);
  assert.equal(items.length, failing.length);
  for (const item of items) {
    // No variance was supplied to buildPackage, so every item must SAY so rather than omit it.
    assert.ok(item.props.some((p) => p.name === 'variance-segment-unavailable'));
  }
});
