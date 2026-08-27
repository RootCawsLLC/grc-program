import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessControl, assessAll } from '../src/health.mjs';

const ctl = (over = {}) => ({
  control_id: 'ctl.iam.enterprise-sso.mfa',
  status: 'operating',
  owner: 'it-identity',
  population_definition: 'All active human identities in the enterprise identity provider, excluding service principals.',
  query_ref: 'models/controls/x.sql',
  scenarios: ['scn.a.b'],
  cost: { opex_annual: 48000 },
  collection: { cadence: 'daily', mechanism: 'api', variance_started_at_quality: 'source-timestamp' },
  policy_ref: 'policies/access.md',
  ...over,
});
const assertion = (over = {}) => ({
  control_id: 'ctl.iam.enterprise-sso.mfa', as_of: '2026-09-15T00:00:00Z', confidence_tier: 4, total: 412, ...over,
});
const AS_OF = '2026-09-16T00:00:00Z';

test('a fully instrumented control carries no deficiencies', () => {
  const r = assessControl({ control: ctl(), assertions: [assertion()], asOf: AS_OF });
  assert.equal(r.band, 'instrumented');
  assert.deepEqual(r.deficiencies, []);
});

test('no assertion means declared, not instrumented', () => {
  const r = assessControl({ control: ctl(), assertions: [], asOf: AS_OF });
  assert.equal(r.band, 'declared');
  assert.ok(r.deficiencies.includes('H1-no-evidence'));
});

test('a planned control with no evidence is aspirational, not a failure', () => {
  const r = assessControl({ control: ctl({ status: 'planned' }), assertions: [], asOf: AS_OF });
  assert.equal(r.band, 'aspirational');
  assert.ok(r.deficiencies.includes('H12-planned-indefinite'));
});

test('evidence older than two cadences is stale', () => {
  const r = assessControl({ control: ctl(), assertions: [assertion()], asOf: '2026-09-20T00:00:00Z' });
  assert.ok(r.deficiencies.includes('H2-stale'));
  assert.equal(r.band, 'attested');
});

test('attestation-grade evidence drops the band even when it is current', () => {
  const r = assessControl({ control: ctl(), assertions: [assertion({ confidence_tier: 2 })], asOf: AS_OF });
  assert.ok(r.deficiencies.includes('H3-tier-floor'));
  assert.equal(r.band, 'attested');
});

test('a vague population definition is flagged for human review', () => {
  const r = assessControl({ control: ctl({ population_definition: 'users' }), assertions: [assertion()], asOf: AS_OF });
  assert.ok(r.deficiencies.includes('H4-population-vague'));
});

test('variance-blind collection is flagged and demotes the band', () => {
  const c = ctl({ collection: { cadence: 'daily', mechanism: 'api', variance_started_at_quality: 'equals-detected' } });
  const r = assessControl({ control: c, assertions: [assertion()], asOf: AS_OF });
  assert.ok(r.deficiencies.includes('H5-variance-blind'));
  assert.equal(r.band, 'attested');
});

test('a person-owned control is flagged — they leave and the control dies with them', () => {
  for (const owner of ['Susan Shepard', 'user@example.com', 'Platform']) {
    const r = assessControl({ control: ctl({ owner }), assertions: [assertion()], asOf: AS_OF });
    assert.ok(r.deficiencies.includes('H6-owner-is-a-person'), `expected flag for owner "${owner}"`);
  }
});

test('a team-named owner is not flagged', () => {
  const r = assessControl({ control: ctl({ owner: 'platform-engineering' }), assertions: [assertion()], asOf: AS_OF });
  assert.ok(!r.deficiencies.includes('H6-owner-is-a-person'));
});

test('an open finding attaches to the control it maps to', () => {
  const r = assessControl({
    control: ctl(), assertions: [assertion()], asOf: AS_OF,
    findings: [{ finding_id: 'FND-0001', control_id: 'ctl.iam.enterprise-sso.mfa', disposition: 'open' }],
  });
  assert.ok(r.deficiencies.includes('H11-open-finding'));
  assert.deepEqual(r.open_findings, ['FND-0001']);
});

test('a remediated finding does not attach', () => {
  const r = assessControl({
    control: ctl(), assertions: [assertion()], asOf: AS_OF,
    findings: [{ finding_id: 'FND-0002', control_id: 'ctl.iam.enterprise-sso.mfa', disposition: 'remediated' }],
  });
  assert.ok(!r.deficiencies.includes('H11-open-finding'));
});

test('no aggregate score is emitted, and the refusal is stated in the output', () => {
  const r = assessAll({ controls: [ctl()], assertions: [assertion()], asOf: AS_OF });
  assert.equal(r.score, undefined);
  assert.equal(r.maturity, undefined);
  assert.match(r.scoring_note, /cannot\s+validly enter arithmetic/);
});
