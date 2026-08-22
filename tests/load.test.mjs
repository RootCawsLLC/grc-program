import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isFixture, isFixtureSet, assertNotMixed, loadAssertions, FIXTURE_STAMP } from '../src/lib/load.mjs';

const rec = (id, extra = {}) => ({
  control_id: id, as_of: '2026-08-15T00:00:00Z', population_definition: 'p', source_system: 's',
  query_ref: 'q', total: 1, passing_count: 1, failing_count: 0, failing: [],
  coverage_basis: 'c', confidence_tier: 4, ...extra,
});

test('a record without the flag is real — absence is not ambiguity', () => {
  assert.equal(isFixture(rec('a')), false);
  assert.equal(isFixture(rec('a', { fixture: false })), false);
  assert.equal(isFixture(rec('a', { fixture: true })), true);
});

test('one synthetic record taints the whole set', () => {
  assert.equal(isFixtureSet([rec('a', { fixture: true })]), true);
  assert.equal(isFixtureSet([rec('a'), rec('b')]), false);
});

test('a uniform set passes through unchanged', () => {
  const real = [rec('a'), rec('b')];
  assert.equal(assertNotMixed(real), real);
  const synthetic = [rec('a', { fixture: true }), rec('b', { fixture: true })];
  assert.equal(assertNotMixed(synthetic), synthetic);
});

test('a mixed set is REFUSED, not warned about', () => {
  assert.throws(
    () => assertNotMixed([rec('real.one'), rec('synthetic.one', { fixture: true })], 'demo set'),
    (err) => {
      assert.match(err.message, /refusing a set that mixes synthetic and real evidence/);
      // The operator has to be able to see which records are on which side without a debugger.
      assert.match(err.message, /real\.one/);
      assert.match(err.message, /synthetic\.one/);
      assert.match(err.message, /demo set/);
      return true;
    },
  );
});

test('the refusal names every record up to a readable limit', () => {
  const many = Array.from({ length: 9 }, (_, i) => rec(`syn.${i}`, { fixture: true }));
  try {
    assertNotMixed([...many, rec('the.real.one')]);
    assert.fail('should have refused');
  } catch (err) {
    assert.match(err.message, /9 record\(s\) carry fixture:true/);
    assert.match(err.message, /… and 4 more/);
    assert.match(err.message, /the\.real\.one/);
  }
});

test('a missing assertion file is an empty set, not a crash', async () => {
  assert.deepEqual(await loadAssertions(join(tmpdir(), 'definitely-not-here-4831.json')), []);
});

test('loadAssertions refuses a mixed file on disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reco-load-'));
  const p = join(dir, 'assertions.json');
  await writeFile(p, JSON.stringify([rec('a'), rec('b', { fixture: true })]));
  await assert.rejects(() => loadAssertions(p), /mixes synthetic and real evidence/);
});

test('the stamp string is the one cui-control-plane uses', () => {
  // B22 calls this "NOT REAL DATA"; the actual constant in cui-control-plane/src/lib/load.mjs is
  // NOT REAL EVIDENCE, and fixtures/README.md here already says the same. Pinned so the three
  // spellings cannot drift apart again.
  assert.equal(FIXTURE_STAMP, 'NOT REAL EVIDENCE');
});
