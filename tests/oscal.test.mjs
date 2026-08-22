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

test('FAIR-CAM props are namespaced to a domain Reco controls', async () => {
  const { controls, assertions } = await load();
  const doc = emitAssessmentResults({ assertions, controls, asOf: '2026-09-15T00:00:00Z' });
  const props = doc['assessment-results'].results[0].observations[0].props;
  assert.ok(props.every((p) => p.ns.startsWith('https://reco.ai/ns/')));
  assert.ok(props.some((p) => p.name === 'function' && p.class === 'primary'));
});
