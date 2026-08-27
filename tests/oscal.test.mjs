import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { emitAssessmentResults, stableStringify } from '../src/oscal/assessment-results.mjs';
import { loadYamlDir } from '../src/validate.mjs';

const load = async () => ({
  controls: await loadYamlDir('controls'),
  assertions: JSON.parse(await readFile('fixtures/assertions.json', 'utf8')),
});

test('an unchanged input re-exports byte-identically', async () => {
  const { controls, assertions } = await load();
  const a = stableStringify(emitAssessmentResults({ assertions, controls, asOf: '2026-09-15T00:00:00Z' }));
  const b = stableStringify(emitAssessmentResults({ assertions, controls, asOf: '2026-09-15T00:00:00Z' }));
  assert.equal(a, b);
});

test('a real change produces a different document', async () => {
  const { controls, assertions } = await load();
  const mutated = structuredClone(assertions);
  mutated[0].failing.pop();
  mutated[0].failing_count -= 1;
  mutated[0].passing_count += 1;
  const a = stableStringify(emitAssessmentResults({ assertions, controls, asOf: '2026-09-15T00:00:00Z' }));
  const b = stableStringify(emitAssessmentResults({ assertions: mutated, controls, asOf: '2026-09-15T00:00:00Z' }));
  assert.notEqual(a, b);
});

test('an assertion against an unknown control is refused', async () => {
  const { controls } = await load();
  assert.throws(() => emitAssessmentResults({
    assertions: [{ control_id: 'ctl.nope.nope.nope', as_of: '2026-09-15T00:00:00Z', failing: [], failing_count: 0, total: 0, passing_count: 0, population_definition: 'x', query_ref: 'y', coverage_basis: 'z', confidence_tier: 1 }],
    controls, asOf: '2026-09-15T00:00:00Z',
  }), /unknown control/);
});

test('FAIR-CAM props are namespaced to a domain the organization controls', async () => {
  const { controls, assertions } = await load();
  const doc = emitAssessmentResults({ assertions, controls, asOf: '2026-09-15T00:00:00Z' });
  const props = doc['assessment-results'].results[0].observations[0].props;
  assert.ok(props.every((p) => p.ns.startsWith('https://reco.ai/ns/')));
  assert.ok(props.some((p) => p.name === 'function' && p.class === 'primary'));
});

// --- the fixture stamp has to survive the trip into OSCAL ------------------------------------
//
// The point of the flag is not that it exists on the assertion record; it is that a person holding
// only the emitted package can tell the numbers are synthetic. These pin the three places it lands.

test('a synthetic assertion set stamps the OSCAL package it produces', async () => {
  const { controls, assertions } = await load();
  const synthetic = structuredClone(assertions).map((a) => ({ ...a, fixture: true }));
  const doc = emitAssessmentResults({ assertions: synthetic, controls, asOf: '2026-09-15T00:00:00Z' });
  const meta = doc['assessment-results'].metadata;
  const result = doc['assessment-results'].results[0];

  assert.match(meta.title, /\[NOT REAL EVIDENCE\]/);
  assert.match(meta.remarks, /NOT REAL EVIDENCE\. This assessment results package/);
  assert.match(meta.remarks, /not submittable/);
  assert.match(result.description, /NOT REAL EVIDENCE/);

  // and on the observation itself, for a consumer that reads one in isolation
  const props = result.observations[0].props;
  assert.ok(props.some((p) => p.name === 'fixture' && p.value === 'NOT REAL EVIDENCE'));
});

test('a real assertion set carries no stamp anywhere', async () => {
  const { controls, assertions } = await load();
  const doc = emitAssessmentResults({ assertions, controls, asOf: '2026-09-15T00:00:00Z' });
  const json = stableStringify(doc);
  assert.doesNotMatch(json, /NOT REAL EVIDENCE/);
  assert.equal(doc['assessment-results'].metadata.remarks, undefined);
});

test('the stamped package is still byte-identical on re-export', async () => {
  const { controls, assertions } = await load();
  const synthetic = structuredClone(assertions).map((a) => ({ ...a, fixture: true }));
  const a = stableStringify(emitAssessmentResults({ assertions: synthetic, controls, asOf: '2026-09-15T00:00:00Z' }));
  const b = stableStringify(emitAssessmentResults({ assertions: synthetic, controls, asOf: '2026-09-15T00:00:00Z' }));
  assert.equal(a, b);
});
