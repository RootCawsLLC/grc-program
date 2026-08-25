import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile } from '../src/intake.mjs';

const controls = [{ control_id: 'ctl.a.b.c' }];
const base = { finding_id: 'FND-0001', kind: 'exception', description: 'something happened', disposition: 'open', _file: 'f.yaml' };
const has = (p, rule) => p.some((x) => x.rule === rule);

test('a finding mapped to a control not in the inventory is an error', () => {
  const { problems } = reconcile({ controls, findings: [{ ...base, control_id: 'ctl.nope.nope.nope' }] });
  assert.ok(has(problems, 'F2-dangling-control'));
});

test('a mapping with no named human is flagged — mapping is a judgement', () => {
  const { problems } = reconcile({ controls, findings: [{ ...base, control_id: 'ctl.a.b.c' }] });
  assert.ok(has(problems, 'F3-unattributed-mapping'));
});

test('risk acceptance requires a person and an expiry', () => {
  const { problems } = reconcile({ controls, findings: [{ ...base, disposition: 'risk-accepted' }] });
  assert.ok(has(problems, 'F4-unnamed-acceptance'));
  assert.ok(has(problems, 'F5-open-ended-acceptance'));
});

test('a properly bounded acceptance passes', () => {
  const { problems } = reconcile({
    controls,
    findings: [{ ...base, disposition: 'risk-accepted', accepted_by: 'A Person', accepted_until: '2027-01-01' }],
  });
  assert.ok(!has(problems, 'F4-unnamed-acceptance'));
  assert.ok(!has(problems, 'F5-open-ended-acceptance'));
});

test('an ISO nonconformity with no clause reference cannot be closed out', () => {
  const { problems } = reconcile({ controls, findings: [{ ...base, kind: 'nonconformity-minor' }] });
  assert.ok(has(problems, 'F7-unclaused-nonconformity'));
});

test('duplicate finding ids are caught', () => {
  const { problems } = reconcile({ controls, findings: [base, { ...base }] });
  assert.ok(has(problems, 'F1-duplicate'));
});

test('unmapped open findings are counted separately — that count is the headline', () => {
  const { summary } = reconcile({
    controls,
    findings: [base, { ...base, finding_id: 'FND-0002', control_id: 'ctl.a.b.c', mapped_by: 'x' }],
  });
  assert.equal(summary.open, 2);
  assert.equal(summary.unmapped_open, 1);
});

// ── unverified mappings are counted in the summary (issue #3) ────────────────────────────────

test('the summary counts open findings whose mapping is unverified', () => {
  // Same shape as unmapped_open, and for the same reason: a count in the summary is what turns a
  // soft signal into something somebody sees.
  const f = (over) => ({
    finding_id: 'F', kind: 'exception', disposition: 'open', source: { document: 'd' },
    control_id: 'ctl.a.b.c', description: 'd', ...over,
  });
  const controls = [{ control_id: 'ctl.a.b.c', status: 'operating' }];

  const high = reconcile({ findings: [f({ mapping_confidence: 'high' })], controls });
  assert.equal(high.summary.unverified_mapping_open, 0);

  for (const weak of ['low', 'medium', null]) {
    const r = reconcile({ findings: [f({ mapping_confidence: weak })], controls });
    assert.equal(r.summary.unverified_mapping_open, 1, `confidence ${weak} must count as unverified`);
  }

  // Unmapped is a different signal and must not be double-counted here.
  const unmapped = reconcile({ findings: [f({ control_id: null, mapping_confidence: null })], controls });
  assert.equal(unmapped.summary.unmapped_open, 1);
  assert.equal(unmapped.summary.unverified_mapping_open, 0);

  // A closed finding is not open, so it is in neither count.
  const closed = reconcile({ findings: [f({ disposition: 'remediated', mapping_confidence: 'low' })], controls });
  assert.equal(closed.summary.unverified_mapping_open, 0);
});

// ── guards run over every mapping, not just the primary (issue #2) ───────────────────────────

test('F2 and F3 check secondary mappings, and F8 catches a control named twice', () => {
  const controls = [{ control_id: 'ctl.a.b.c', status: 'operating' }, { control_id: 'ctl.d.e.f', status: 'operating' }];
  const f = (over) => ({
    finding_id: 'F', kind: 'exception', disposition: 'open', source: { document: 'd' },
    description: 'd', control_id: 'ctl.a.b.c', mapped_by: 'A Person', mapping_confidence: 'high', ...over,
  });
  const rules = (r) => r.problems.map((p) => p.rule);

  // A dangling SECONDARY is exactly as broken as a dangling primary.
  const dangling = reconcile({ findings: [f({ also_implicates: [{ control_id: 'ctl.nope.nope.nope', mapped_by: 'X' }] })], controls });
  assert.ok(rules(dangling).includes('F2-dangling-control'));
  assert.match(dangling.problems.find((p) => p.rule === 'F2-dangling-control').message, /also_implicates names ctl\.nope\.nope\.nope/);

  // A secondary with no mapped_by is exactly as much of an unattributed judgement.
  const unattributed = reconcile({ findings: [f({ also_implicates: [{ control_id: 'ctl.d.e.f' }] })], controls });
  assert.ok(rules(unattributed).includes('F3-unattributed-mapping'));
  assert.match(unattributed.problems.find((p) => p.rule === 'F3-unattributed-mapping').message, /also_implicates to ctl\.d\.e\.f/);

  // The same control named twice is a record disagreeing with itself.
  const dupe = reconcile({ findings: [f({ also_implicates: [{ control_id: 'ctl.a.b.c', mapped_by: 'X' }] })], controls });
  assert.ok(rules(dupe).includes('F8-duplicate-mapping'));
  assert.equal(dupe.problems.find((p) => p.rule === 'F8-duplicate-mapping').severity, 'error');

  // A clean multi-control finding raises nothing.
  const clean = reconcile({ findings: [f({ also_implicates: [{ control_id: 'ctl.d.e.f', mapped_by: 'A Person', mapping_confidence: 'high' }] })], controls });
  assert.deepEqual(clean.problems, []);
});

test('the unverified count fires on a weak SECONDARY even when the primary is high', () => {
  const controls = [{ control_id: 'ctl.a.b.c', status: 'operating' }, { control_id: 'ctl.d.e.f', status: 'operating' }];
  const base = {
    finding_id: 'F', kind: 'exception', disposition: 'open', source: { document: 'd' },
    description: 'd', control_id: 'ctl.a.b.c', mapped_by: 'A Person', mapping_confidence: 'high',
  };
  const strong = reconcile({ findings: [{ ...base, also_implicates: [{ control_id: 'ctl.d.e.f', mapping_confidence: 'high', mapped_by: 'A' }] }], controls });
  assert.equal(strong.summary.unverified_mapping_open, 0);

  const weak = reconcile({ findings: [{ ...base, also_implicates: [{ control_id: 'ctl.d.e.f', mapping_confidence: 'low', mapped_by: 'A' }] }], controls });
  assert.equal(weak.summary.unverified_mapping_open, 1, 'a weak secondary makes the finding unverified');
});
