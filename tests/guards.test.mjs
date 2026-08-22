import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guards } from '../src/validate.mjs';

const base = {
  control_id: 'ctl.iam.enterprise-sso.mfa',
  status: 'building',
  faircam: [{ function: 'resistance', primary: true }],
  scenarios: ['scn.x.y'],
  query_ref: 'models/controls/x.sql',
  _file: 'controls/x.yaml',
};
const scenarios = [{ scenario_id: 'scn.x.y', parameters: {}, _file: 's.yaml' }];
const has = (p, rule) => p.some((x) => x.rule === rule);

test('G2 rejects a policy written before the control operates', () => {
  const p = guards({ controls: [{ ...base, policy_ref: 'policies/access.md' }], exceptions: [], scenarios });
  assert.ok(has(p, 'G2-policy-before-control'));
});

test('G2 allows a policy once the control is operating', () => {
  const p = guards({ controls: [{ ...base, status: 'operating', policy_ref: 'policies/access.md', cost: { opex_annual: 1 } }], exceptions: [], scenarios });
  assert.ok(!has(p, 'G2-policy-before-control'));
});

test('G3 rejects two primary FAIR-CAM functions — that means the layer split is wrong', () => {
  const p = guards({ controls: [{ ...base, faircam: [{ function: 'resistance', primary: true }, { function: 'event-detection', primary: true }] }], exceptions: [], scenarios });
  assert.ok(has(p, 'G3-primary-function'));
});

test('G4 flags an unpriced control and a dangling scenario reference', () => {
  const p = guards({ controls: [{ ...base, scenarios: [] }, { ...base, control_id: 'ctl.a.b.c', scenarios: ['scn.nope.nope'] }], exceptions: [], scenarios });
  assert.ok(has(p, 'G4-unpriced-control'));
  assert.ok(has(p, 'G4-dangling-scenario'));
});

test('G1 catches a duplicate control id', () => {
  const p = guards({ controls: [base, { ...base }], exceptions: [], scenarios });
  assert.ok(has(p, 'G1-duplicate-id'));
});

test('G7 refuses source-timestamp variance quality on a manual procedure', () => {
  const p = guards({ controls: [{ ...base, collection: { mechanism: 'manual-procedure', variance_started_at_quality: 'source-timestamp' } }], exceptions: [], scenarios });
  assert.ok(has(p, 'G7-impossible-variance-quality'));
});

test('G8 rejects an expired exception rather than quietly honouring it', () => {
  const p = guards({
    controls: [base], scenarios,
    exceptions: [{ exception_id: 'EX-9999', control_id: base.control_id, subjects: ['a'], expires_on: '2020-01-01', compensating: [], _file: 'e.yaml' }],
  });
  assert.ok(has(p, 'G8-expired-exception'));
});

test('G9 rejects an unprovenanced or inverted scenario parameter', () => {
  const p = guards({
    controls: [base], exceptions: [],
    scenarios: [{ scenario_id: 'scn.x.y', _file: 's.yaml', parameters: {
      lef: { min: 5, most_likely: 1, max: 9, provenance: {} },
    } }],
  });
  assert.ok(has(p, 'G9-unprovenanced-parameter'));
  assert.ok(has(p, 'G9-inverted-range'));
});
