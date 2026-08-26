import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guards } from '../src/validate.mjs';
import { heldScopeOn, findApprovers, uncoveredScopes } from '../src/lib/authority.mjs';

const control = {
  control_id: 'ctl.iam.enterprise-sso.mfa',
  owner: 'it-identity',
  status: 'building',
  faircam: [{ function: 'resistance', primary: true }],
  scenarios: ['scn.x.y'],
  query_ref: 'models/controls/x.sql',
  _file: 'controls/x.yaml',
};
const scenarios = [{ scenario_id: 'scn.x.y', parameters: {}, _file: 's.yaml' }];

const roster = (people = [], teams = [{ team_id: 'it-identity', name: 'IT' }]) => ({
  people: { records: people, present: true, _file: 'roster/people.yaml' },
  teams: { records: teams, present: true, _file: 'roster/teams.yaml' },
});

const approver = (over = {}) => ({
  person_id: 'per.approver',
  full_name: 'A Approver',
  role: 'Head of Security',
  authority: [{ scope: 'exception.approve', from: '2026-01-01' }],
  ...over,
});

const exception = (over = {}) => ({
  exception_id: 'EX-0001',
  control_id: 'ctl.iam.enterprise-sso.mfa',
  approved_by: 'per.approver',
  approved_on: '2026-06-01',
  expires_on: '2099-01-01',
  _file: 'exceptions/EX-0001.yaml',
  ...over,
});

const run = (opts) => guards({ controls: [control], exceptions: [], scenarios, ...opts });
const find = (p, rule) => p.filter((x) => x.rule === rule);
const has = (p, rule) => find(p, rule).length > 0;

// ---- heldScopeOn: the temporal core --------------------------------------------------

test('a grant does not authorise an approval dated before it began', () => {
  const v = heldScopeOn(approver(), 'exception.approve', '2025-12-31');
  assert.equal(v.held, false);
  assert.equal(v.reason, 'grant-not-yet-effective');
});

test('a grant does not authorise an approval dated after it ended', () => {
  const p = approver({ authority: [{ scope: 'exception.approve', from: '2026-01-01', until: '2026-03-01' }] });
  const v = heldScopeOn(p, 'exception.approve', '2026-06-01');
  assert.equal(v.held, false);
  assert.equal(v.reason, 'grant-expired');
});

test('a departed person did not approve anything after their last day', () => {
  const v = heldScopeOn(approver({ departed_on: '2026-05-01' }), 'exception.approve', '2026-06-01');
  assert.equal(v.held, false);
  assert.equal(v.reason, 'departed');
});

test('grant boundaries are inclusive on both ends', () => {
  const p = approver({ authority: [{ scope: 'exception.approve', from: '2026-01-01', until: '2026-03-01' }] });
  assert.equal(heldScopeOn(p, 'exception.approve', '2026-01-01').held, true);
  assert.equal(heldScopeOn(p, 'exception.approve', '2026-03-01').held, true);
});

test('wildcard satisfies any scope', () => {
  const p = approver({ authority: [{ scope: 'wildcard', from: '2026-01-01' }] });
  assert.equal(heldScopeOn(p, 'breach.determine', '2026-06-01').held, true);
});

// ---- G10: owner referential integrity ------------------------------------------------

test('G10 rejects a control owned by a team that does not exist', () => {
  const p = run({ roster: roster([], [{ team_id: 'someone-else', name: 'X' }]) });
  assert.ok(has(p, 'G10-unknown-owner'));
});

test('G10 rejects a control owned by a dissolved team', () => {
  const p = run({ roster: roster([], [{ team_id: 'it-identity', name: 'IT', dissolved_on: '2026-01-01' }]) });
  assert.ok(has(p, 'G10-unknown-owner'));
});

test('G10 accepts a control whose owner resolves to a live team', () => {
  assert.ok(!has(run({ roster: roster() }), 'G10-unknown-owner'));
});

// ---- G11: delegation coverage --------------------------------------------------------

test('G11 reports a scope nobody can approve', () => {
  const p = run({ roster: roster([]), scopes: ['exception.approve', 'wildcard'] });
  assert.ok(has(p, 'G11-undelegated-scope'));
});

test('G11 does not accept the principal as delegation', () => {
  const principal = approver({ person_id: 'per.founder', is_principal: true, authority: [{ scope: 'wildcard', from: '2020-01-01' }] });
  const p = run({ roster: roster([principal]), scopes: ['exception.approve', 'wildcard'] });
  assert.ok(has(p, 'G11-undelegated-scope'), 'a scope only the principal can approve is still undelegated');
});

test('G11 is quiet once a non-principal holds the scope', () => {
  const p = run({ roster: roster([approver()]), scopes: ['exception.approve', 'wildcard'] });
  assert.ok(!has(p, 'G11-undelegated-scope'));
});

// ---- G12: entitlement at time of approval --------------------------------------------

test('G12 rejects a placeholder approver - the EX-0001 case', () => {
  const p = run({ roster: roster([approver()]), exceptions: [exception({ approved_by: 'PLACEHOLDER-approver' })] });
  const hit = find(p, 'G12-unentitled-approval');
  assert.equal(hit.length, 1);
  assert.match(hit[0].message, /no such person_id/);
});

test('G12 rejects an approval signed before the delegation began', () => {
  const p = run({ roster: roster([approver()]), exceptions: [exception({ approved_on: '2025-06-01' })] });
  assert.match(find(p, 'G12-unentitled-approval')[0].message, /did not exist yet/);
});

test('G12 rejects an approval signed after the approver left', () => {
  const p = run({ roster: roster([approver({ departed_on: '2026-05-01' })]), exceptions: [exception()] });
  assert.match(find(p, 'G12-unentitled-approval')[0].message, /already left/);
});

test('G12 rejects an approver holding no relevant grant', () => {
  const p = run({ roster: roster([approver({ authority: [{ scope: 'policy.issue', from: '2020-01-01' }] })]), exceptions: [exception()] });
  assert.match(find(p, 'G12-unentitled-approval')[0].message, /no exception\.approve grant/);
});

test('G12 accepts an approval by an entitled person on a date they held the grant', () => {
  const p = run({ roster: roster([approver()]), exceptions: [exception()] });
  assert.ok(!has(p, 'G12-unentitled-approval'));
});

test('G12 warns rather than errors when the roster is empty - the gap is named, not hidden', () => {
  const p = run({ roster: roster([]), exceptions: [exception()] });
  assert.ok(has(p, 'G12-unverifiable-approval'));
  assert.equal(find(p, 'G12-unverifiable-approval')[0].severity, 'warning');
});

// ---- back-compat ----------------------------------------------------------------------

test('guards() called without a roster emits no authority findings', () => {
  const p = guards({ controls: [control], exceptions: [exception()], scenarios });
  for (const rule of ['G10-unknown-owner', 'G11-undelegated-scope', 'G12-unentitled-approval', 'G12-unverifiable-approval']) {
    assert.ok(!has(p, rule), rule + ' must not fire without a roster');
  }
});

// ---- helpers --------------------------------------------------------------------------

test('findApprovers puts non-principals ahead of the principal', () => {
  const principal = approver({ person_id: 'per.founder', is_principal: true, authority: [{ scope: 'wildcard', from: '2020-01-01' }] });
  const ordered = findApprovers([principal, approver()], 'exception.approve', '2026-06-01');
  assert.equal(ordered[0].person_id, 'per.approver');
});

test('uncoveredScopes never reports wildcard itself', () => {
  assert.ok(!uncoveredScopes([], ['exception.approve', 'wildcard'], '2026-06-01').includes('wildcard'));
});

// ---- nearest-grant reporting -----------------------------------------------------------
// These pin the fix for reason selection: the verdict was always right, but the explanation
// used to come from whichever grant sat first in the array.

const twoMisses = [
  { scope: 'exception.approve', from: '2030-01-01' },              // begins years later
  { scope: 'exception.approve', from: '2020-01-01', until: '2026-05-28' }, // ended days ago
];

test('a near-miss is explained by the closest grant, not the first one listed', () => {
  const v = heldScopeOn(approver({ authority: twoMisses }), 'exception.approve', '2026-06-01');
  assert.equal(v.held, false);
  assert.equal(v.reason, 'grant-expired');
  assert.match(v.detail, /2026-05-28/);
});

test('the explanation does not depend on grant order', () => {
  const forward = heldScopeOn(approver({ authority: twoMisses }), 
    'exception.approve', '2026-06-01');
  const reversed = heldScopeOn(approver({ authority: [...twoMisses].reverse() }), 
    'exception.approve', '2026-06-01');
  assert.deepEqual(forward, reversed);
});

test('a near-miss says how many grants were weighed, so one date does not read as the whole story', () => {
  const v = heldScopeOn(approver({ authority: twoMisses }), 'exception.approve', '2026-06-01');
  assert.match(v.detail, /nearest of 2 grants/);
});

test('a single missed grant is reported without the count', () => {
  const v = heldScopeOn(approver(), 'exception.approve', '2025-12-31');
  assert.ok(!v.detail.includes('nearest of'));
});
