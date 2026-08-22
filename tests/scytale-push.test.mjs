import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toScytalePayload, push } from '../src/push/scytale.mjs';

const control = { control_id: 'ctl.iam.cloud-platform.mfa' };
const assertion = {
  control_id: 'ctl.iam.cloud-platform.mfa', as_of: '2026-09-15T00:00:00Z',
  total: 47, passing_count: 43, failing_count: 4,
  failing: [{ subject_id: 'a', reason: 'no_mfa_device', first_observed: '2026-09-10T00:00:00Z', exception_ref: null }],
  population_definition: 'p', query_ref: 'q', coverage_basis: 'c', confidence_tier: 4,
};

test('the payload carries the population, not just a pass/fail flag', () => {
  const p = toScytalePayload(assertion, control);
  assert.equal(p.status, 'fail');
  assert.equal(p.population_total, 47);
  assert.equal(p.failing_subjects.length, 1);
  assert.equal(p.evidence_reference.system_of_record, 'github.com/reco/reco-grc');
});

test('dry run is the default and sends nothing', async () => {
  const res = await push({ assertions: [assertion], controls: [control] });
  assert.equal(res.dryRun, true);
  assert.equal(res.pushed, 0);
});

test('a live push refuses until the JSON contract has been confirmed against the Scytale UI', async () => {
  await assert.rejects(
    push({ assertions: [assertion], controls: [control], dryRun: false, baseUrl: 'https://x', token: 't' }),
    /contract has not been confirmed/,
  );
});
