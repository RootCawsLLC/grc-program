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

// ── an unverified mapping is its own gap (issue #3) ──────────────────────────────────────────
//
// THE BUG THIS PINS. The remediation loop had exactly two branches: unmapped, or mapped to a
// non-operating control. A finding mapped to an OPERATING control produced no gap at all — so a
// mapping somebody guessed at was most invisible precisely when the control looked healthiest.
// If the mapping is wrong, the remediation is aimed at the wrong control and the right one reads
// clean.

const finding = (over = {}) => ({
  finding_id: 'FND-0001', kind: 'exception', disposition: 'open',
  source: { document: 'doc' }, control_id: 'ctl.a.b.c',
  mapping_confidence: 'high', mapped_by: 'A Person', ...over,
});

const mappingGaps = (r) => dirs(r, 'remediation').filter((g) => /unverified/i.test(g.statement));

test('a high-confidence mapping to an operating control produces no gap', () => {
  const r = assessGaps({ controls: [ctl()], scenarios: [], findings: [finding()] });
  assert.equal(dirs(r, 'remediation').length, 0);
});

test('a LOW-confidence mapping is a gap even when the control is operating', () => {
  // The case that was completely invisible before.
  const r = assessGaps({ controls: [ctl()], scenarios: [], findings: [finding({ mapping_confidence: 'low' })] });
  const g = mappingGaps(r);
  assert.equal(g.length, 1);
  assert.match(g[0].statement, /mapped to ctl\.a\.b\.c at "low" confidence by A Person/);
  assert.match(g[0].severity_basis, /misdirects the remediation/);
  assert.deepEqual(g[0].related, ['ctl.a.b.c']);
});

test('medium is also unverified — only "high" means somebody checked', () => {
  const r = assessGaps({ controls: [ctl()], scenarios: [], findings: [finding({ mapping_confidence: 'medium' })] });
  assert.equal(mappingGaps(r).length, 1);
});

test('NO recorded confidence is weaker than "low", not stronger', () => {
  // Absence must not read as "fine". A mapping where nobody said how sure they were is the least
  // defensible of all, and treating null as acceptable is how an unlabelled judgement acquires the
  // authority of a checked one.
  const r = assessGaps({ controls: [ctl()], scenarios: [], findings: [finding({ mapping_confidence: null, mapped_by: null })] });
  const g = mappingGaps(r);
  assert.equal(g.length, 1);
  assert.match(g[0].statement, /NO recorded confidence/);
  assert.match(g[0].statement, /by nobody named/);
});

test('an unmapped finding gets the unmapped gap, NOT a mapping-confidence gap', () => {
  // control_id is null, so there is no attribution to verify — the hole is the point.
  const r = assessGaps({ controls: [ctl()], scenarios: [], findings: [finding({ control_id: null, mapping_confidence: null })] });
  assert.equal(mappingGaps(r).length, 0);
  assert.equal(dirs(r, 'remediation').length, 1);
  assert.match(dirs(r, 'remediation')[0].statement, /maps to no control in the inventory/);
});

test('a non-operating control AND a weak mapping produce both gaps, and the caveat travels', () => {
  // Two independent problems, so two gaps — and the status gap carries the caveat inline so the
  // number is not read without it.
  const r = assessGaps({
    controls: [ctl({ status: 'building' })], scenarios: [],
    findings: [finding({ mapping_confidence: 'low' })],
  });
  assert.equal(dirs(r, 'remediation').length, 2);
  const status = dirs(r, 'remediation').find((g) => /rather than operating/.test(g.statement));
  assert.match(status.statement, /Mapping confidence is "low"; treat the attribution as unverified/);
});

test('a closed finding raises nothing, however weak its mapping', () => {
  for (const disposition of ['remediated', 'risk-accepted', 'superseded']) {
    const r = assessGaps({ controls: [ctl()], scenarios: [], findings: [finding({ disposition, mapping_confidence: 'low' })] });
    assert.equal(dirs(r, 'remediation').length, 0, disposition);
  }
});

// ── a finding can implicate more than one control (issue #2) ─────────────────────────────────
//
// THE BUG THIS PINS. `control_id` was the only mapping the gap layer read. A real exception —
// "access to the cloud platform AND the source repository was not revoked" — is one finding against
// two controls, and the second survived only in notes prose: no gap query saw it, and it read as
// clean while an auditor had already found otherwise.

const two = (over = {}) => ({
  finding_id: 'FND-M001', kind: 'exception', disposition: 'open', source: { document: 'doc' },
  control_id: 'ctl.a.b.c', mapping_confidence: 'high', mapped_by: 'A Person',
  also_implicates: [{ control_id: 'ctl.d.e.f', mapping_confidence: 'high', mapped_by: 'A Person' }],
  ...over,
});
const other = (over = {}) => ({ ...ctl({ control_id: 'ctl.d.e.f' }), ...over });

test('a secondary control that is not operating raises its own gap', () => {
  const r = assessGaps({
    controls: [ctl(), other({ status: 'building' })], scenarios: [], findings: [two()],
  });
  const g = dirs(r, 'remediation');
  assert.equal(g.length, 1, 'the operating primary raises nothing; the building secondary raises one');
  assert.match(g[0].statement, /ctl\.d\.e\.f \(also_implicates\)/);
  assert.match(g[0].statement, /"building" rather than operating/);
  assert.deepEqual(g[0].related, ['ctl.d.e.f']);
});

test('a secondary mapping carries its OWN confidence, not the primary\'s', () => {
  // The reason also_implicates holds objects rather than bare ids. A single scalar on the finding
  // would apply the primary's certainty to a secondary nobody checked as carefully.
  const r = assessGaps({
    controls: [ctl(), other()], scenarios: [],
    findings: [two({ also_implicates: [{ control_id: 'ctl.d.e.f', mapping_confidence: 'low', mapped_by: 'Someone Else' }] })],
  });
  const g = dirs(r, 'remediation');
  assert.equal(g.length, 1, 'primary is high and operating — only the secondary is unverified');
  assert.match(g[0].statement, /mapped to ctl\.d\.e\.f \(also_implicates\) at "low" confidence by Someone Else/);
});

test('both controls raise gaps when both are weak, and each names itself', () => {
  const r = assessGaps({
    controls: [ctl({ status: 'building' }), other({ status: 'planned' })], scenarios: [],
    findings: [two({ mapping_confidence: 'low', also_implicates: [{ control_id: 'ctl.d.e.f', mapping_confidence: null }] })],
  });
  const g = dirs(r, 'remediation');
  // two status gaps + two unverified-mapping gaps
  assert.equal(g.length, 4);
  assert.equal(g.filter((x) => /ctl\.a\.b\.c/.test(x.statement)).length, 2);
  assert.equal(g.filter((x) => /ctl\.d\.e\.f/.test(x.statement)).length, 2);
  assert.ok(g.some((x) => /NO recorded confidence/.test(x.statement)));
});

test('an unmapped finding never reaches the per-mapping loop', () => {
  // control_id null means there is no attribution to verify; also_implicates on an unmapped
  // finding would be a contradiction, and the unmapped gap is the sharper signal anyway.
  const r = assessGaps({
    controls: [ctl(), other()], scenarios: [],
    findings: [two({ control_id: null, also_implicates: [{ control_id: 'ctl.d.e.f' }] })],
  });
  const g = dirs(r, 'remediation');
  assert.equal(g.length, 1);
  assert.match(g[0].statement, /maps to no control in the inventory/);
});

test('a finding with no also_implicates behaves exactly as before', () => {
  const withField = assessGaps({ controls: [ctl({ status: 'building' })], scenarios: [], findings: [two({ also_implicates: [] })] });
  const without = assessGaps({ controls: [ctl({ status: 'building' })], scenarios: [], findings: [two({ also_implicates: undefined })] });
  assert.deepEqual(dirs(withField, 'remediation').map((g) => g.statement), dirs(without, 'remediation').map((g) => g.statement));
});
