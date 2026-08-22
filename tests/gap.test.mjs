import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessGaps } from '../src/gap.mjs';

const ctl = (over = {}) => ({
  control_id: 'ctl.a.b.c', status: 'operating', query_ref: 'models/controls/x.sql',
  scenarios: ['scn.x.y'], crosswalk: { soc2: ['CC6.1'] },
  collection: { mechanism: 'api' }, ...over,
});
const dirs = (r, d) => r.gaps.filter((g) => g.direction === d);

test('a scenario with no operating control is a risk gap', () => {
  const r = assessGaps({ controls: [ctl({ status: 'building' })], scenarios: [{ scenario_id: 'scn.x.y' }] });
  assert.equal(dirs(r, 'risk').length, 1);
  assert.match(dirs(r, 'risk')[0].statement, /none of which are operating/);
});

test('a scenario with no controls at all is a different, sharper risk gap', () => {
  const r = assessGaps({ controls: [], scenarios: [{ scenario_id: 'scn.orphan.one' }] });
  assert.match(dirs(r, 'risk')[0].statement, /no controls joined to it at all/);
});

test('an operating control fully covering its scenario produces no risk gap', () => {
  const r = assessGaps({ controls: [ctl()], scenarios: [{ scenario_id: 'scn.x.y' }] });
  assert.equal(dirs(r, 'risk').length, 0);
});

test('a manual control is an assurance gap even though it is legitimate', () => {
  const r = assessGaps({ controls: [ctl({ collection: { mechanism: 'manual-procedure' } })], scenarios: [{ scenario_id: 'scn.x.y' }] });
  assert.equal(dirs(r, 'assurance').length, 1);
  assert.match(dirs(r, 'assurance')[0].severity_basis, /scarce resource/);
});

test('an unmapped open finding is the sharpest remediation gap', () => {
  const r = assessGaps({
    controls: [ctl()], scenarios: [{ scenario_id: 'scn.x.y' }],
    findings: [{ finding_id: 'FND-0001', disposition: 'open', control_id: null, kind: 'exception', source: { document: 'soc2' } }],
  });
  assert.match(dirs(r, 'remediation')[0].statement, /maps to no control/);
  assert.match(dirs(r, 'remediation')[0].severity_basis, /hole/);
});

test('a closed finding produces no remediation gap', () => {
  const r = assessGaps({
    controls: [ctl()], scenarios: [{ scenario_id: 'scn.x.y' }],
    findings: [{ finding_id: 'FND-0001', disposition: 'remediated', control_id: 'ctl.a.b.c' }],
  });
  assert.equal(dirs(r, 'remediation').length, 0);
});

test('an in-scope requirement with no control mapped is a coverage gap', () => {
  const r = assessGaps({
    controls: [ctl()], scenarios: [{ scenario_id: 'scn.x.y' }],
    requirementIndex: { soc2: { requirements: [{ id: 'CC6.1', in_scope: true }, { id: 'CC6.2', in_scope: true }] } },
  });
  assert.equal(dirs(r, 'coverage').length, 1);          // CC6.1 is claimed, CC6.2 is not
  assert.equal(dirs(r, 'coverage')[0].subject, 'CC6.2');
});

test('a requirement excluded in the SoA is not a gap', () => {
  const r = assessGaps({
    controls: [ctl()], scenarios: [{ scenario_id: 'scn.x.y' }],
    requirementIndex: { soc2: { requirements: [{ id: 'CC6.2', in_scope: false }] } },
  });
  assert.equal(dirs(r, 'coverage').length, 0);
});

test('an undetermined scope is reported as a discovery gap, not a control gap', () => {
  const r = assessGaps({
    controls: [ctl()], scenarios: [{ scenario_id: 'scn.x.y' }],
    requirementIndex: { soc2: { requirements: [{ id: 'CC6.2', in_scope: null }] } },
  });
  assert.match(dirs(r, 'coverage')[0].severity_basis, /DISCOVERY gap/);
  assert.match(dirs(r, 'coverage')[0].severity_basis, /meaningless/);
});

test('work ordering is stated in the output, not left to the reader', () => {
  const r = assessGaps({ controls: [], scenarios: [] });
  assert.match(r.ordering_note, /remediation, then risk, then assurance, then coverage/);
});
