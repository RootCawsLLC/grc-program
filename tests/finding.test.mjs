import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mappingsOf, controlsTouched, touches, needsVerification, describeConfidence, describeAttribution } from '../src/lib/finding.mjs';

const f = (over = {}) => ({ control_id: 'ctl.a.b.c', mapping_confidence: 'high', mapped_by: 'A', ...over });

test('mappingsOf puts the primary first and flags it', () => {
  // Order matters: the primary names who is accountable, and "one finding, one owner" is what
  // stops a shared exception becoming nobody's problem.
  const m = mappingsOf(f({ also_implicates: [{ control_id: 'ctl.d.e.f' }] }));
  assert.equal(m.length, 2);
  assert.equal(m[0].control_id, 'ctl.a.b.c');
  assert.equal(m[0].primary, true);
  assert.equal(m[1].primary, false);
});

test('an unmapped finding has no mappings, even with secondaries present', () => {
  assert.deepEqual(mappingsOf(f({ control_id: null })), []);
  assert.deepEqual(mappingsOf(null), []);
  assert.deepEqual(mappingsOf({}), []);
});

test('a secondary with no control_id is skipped rather than yielding an undefined mapping', () => {
  const m = mappingsOf(f({ also_implicates: [{ mapped_by: 'A' }, { control_id: 'ctl.d.e.f' }] }));
  assert.deepEqual(m.map((x) => x.control_id), ['ctl.a.b.c', 'ctl.d.e.f']);
});

test('controlsTouched deduplicates and touches() matches either position', () => {
  const rec = f({ also_implicates: [{ control_id: 'ctl.d.e.f' }, { control_id: 'ctl.d.e.f' }] });
  assert.deepEqual(controlsTouched(rec), ['ctl.a.b.c', 'ctl.d.e.f']);
  assert.equal(touches(rec, 'ctl.d.e.f'), true, 'a secondary must be findable');
  assert.equal(touches(rec, 'ctl.a.b.c'), true);
  assert.equal(touches(rec, 'ctl.x.y.z'), false);
});

test('only "high" is verified — null is weaker than low, not stronger', () => {
  assert.equal(needsVerification({ mapping_confidence: 'high' }), false);
  for (const weak of ['medium', 'low', null, undefined]) {
    assert.equal(needsVerification({ mapping_confidence: weak }), true, String(weak));
  }
});

test('the describers say plainly when nothing was recorded', () => {
  assert.equal(describeConfidence({ mapping_confidence: 'low' }), '"low" confidence');
  assert.equal(describeConfidence({ mapping_confidence: null }), 'NO recorded confidence');
  assert.equal(describeAttribution({ mapped_by: 'A Person' }), ' by A Person');
  assert.equal(describeAttribution({ mapped_by: null }), ', by nobody named');
});

test('the schema accepts also_implicates and still accepts records without it', async () => {
  const { readFileSync } = await import('node:fs');
  const { default: Ajv } = await import('ajv/dist/2020.js');
  const { default: addFormats } = await import('ajv-formats');
  const validate = addFormats(new Ajv({ allErrors: true, strict: false }))
    .compile(JSON.parse(readFileSync('schemas/finding.schema.json', 'utf8')));

  // The schema is stricter than a minimal object: finding_id matches ^FND-[0-9]{4}$, source needs
  // document_type, and description has a minimum length. All three are deliberate.
  const base = {
    finding_id: 'FND-0001',
    source: { document: 'doc', document_type: 'soc2-type2' },
    kind: 'exception',
    description: 'A description long enough to be worth reading.',
    disposition: 'open',
  };

  // Backwards compatible: also_implicates is optional, so every existing record still validates.
  assert.ok(validate(base), JSON.stringify(validate.errors));

  assert.ok(validate({ ...base, control_id: 'ctl.a.b.c', also_implicates: [
    { control_id: 'ctl.d.e.f', mapping_confidence: 'low', mapped_by: 'A', basis: 'why' },
  ] }), JSON.stringify(validate.errors));

  // control_id is required on every entry — a mapping to nothing is not a mapping.
  assert.equal(validate({ ...base, also_implicates: [{ mapped_by: 'A' }] }), false);
  // and the enum is enforced there too, not just on the primary
  assert.equal(validate({ ...base, also_implicates: [{ control_id: 'c', mapping_confidence: 'quite-sure' }] }), false);
});
