import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAssertion, denominatorDrift } from '../src/lib/assertion.mjs';

const control = {
  control_id: 'ctl.iam.enterprise-sso.mfa',
  population_definition: 'all active human identities in the enterprise IdP',
  source_system: 'idp', query_ref: 'models/controls/x.sql',
};
const rows = [
  { subject_id: 'u3', passing: true },
  { subject_id: 'u1', passing: false, reason: 'no_factor_enrolled', first_observed: '2026-08-01T00:00:00Z' },
  { subject_id: 'u2', passing: true },
];

test('failing[] is always enumerated and deterministically ordered', () => {
  const a = buildAssertion({ control, asOf: '2026-09-01T00:00:00Z', rows });
  assert.equal(a.total, 3);
  assert.equal(a.passing_count, 2);
  assert.equal(a.failing_count, 1);
  assert.equal(a.failing[0].subject_id, 'u1');
  assert.equal(a.passing, null); // passing enumeration is storage, not evidence
});

test('an exception reduces coverage but does not leave the denominator', () => {
  const a = buildAssertion({
    control, asOf: '2026-09-01T00:00:00Z', rows,
    exceptions: [{ exception_id: 'EX-0001', control_id: control.control_id, subjects: ['u1'], expires_on: '2027-01-01' }],
  });
  assert.equal(a.total, 3);              // still counted
  assert.equal(a.failing_count, 1);      // still failing
  assert.equal(a.failing[0].exception_ref, 'EX-0001');
  assert.match(a.coverage_basis, /EX-0001/);
});

test('an expired exception throws instead of being honoured', () => {
  assert.throws(() => buildAssertion({
    control, asOf: '2026-09-01T00:00:00Z', rows,
    exceptions: [{ exception_id: 'EX-0002', control_id: control.control_id, subjects: ['u1'], expires_on: '2026-01-01' }],
  }), /expired/);
});

test('an exception with no expiry throws', () => {
  assert.throws(() => buildAssertion({
    control, asOf: '2026-09-01T00:00:00Z', rows,
    exceptions: [{ exception_id: 'EX-0003', control_id: control.control_id, subjects: ['u1'] }],
  }), /undocumented control change/);
});

test('denominator drift fires when the population shrinks — the pass rate would have "improved"', () => {
  const d = denominatorDrift({ total: 400 }, { total: 310 });
  assert.equal(d.drifted, true);
  assert.equal(d.direction, 'shrank');
  assert.match(d.reason, /asset inventory/);
});
