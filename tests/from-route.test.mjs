import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assessDrift } from '../src/drift.mjs';
import { route } from '../src/route.mjs';
import { eventsFromRoute } from '../src/from-route.mjs';
import { dispatchRoute, listStored } from '../src/host.mjs';
import { FIXTURE_STAMP } from '../src/lib/load.mjs';

const a = (control_id, as_of, total, failing = [], extra = {}) => ({
  control_id,
  as_of,
  total,
  passing_count: total - failing.length,
  failing_count: failing.length,
  failing: failing.map((s) => (typeof s === 'string' ? { subject_id: s, reason: 'r', first_observed: as_of } : s)),
  population_definition: 'p',
  source_system: 's',
  query_ref: 'q',
  coverage_basis: 'c',
  confidence_tier: 4,
  ...extra,
});

const ctl = () => ({
  control_id: 'ctl.a.b.c',
  owner: 'platform-engineering',
  scenarios: ['scn.x.y'],
  population_definition: 'every widget',
});

test('only NEW subjects become control.failing events — continuing stays silent', () => {
  const assertions = [
    a('ctl.a.b.c', '2026-01-01T00:00:00Z', 10, ['s1']),
    a('ctl.a.b.c', '2026-02-01T00:00:00Z', 10, ['s1', 's2']),
  ];
  const routed = route({ assertions, controls: [ctl()], drift: assessDrift({ assertions }) });
  const events = eventsFromRoute(routed, { assertions });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'control.failing');
  assert.equal(events[0].payload.subject_id, 's2');
  assert.equal(events[0].derivation_level, 'measured');
  assert.equal(events[0].event_id, 'evt.route.ctl.a.b.c.s2');
});

test('a held cycle emits one denominator.drift event and no failure events', () => {
  const assertions = [
    a('ctl.a.b.c', '2026-01-01T00:00:00Z', 60, ['s1']),
    a('ctl.a.b.c', '2026-02-01T00:00:00Z', 45, ['s1']),
  ];
  const drift = assessDrift({ assertions });
  const routed = route({ assertions, controls: [ctl()], drift });
  const events = eventsFromRoute(routed, { assertions });
  assert.equal(routed.held, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'denominator.drift');
  assert.equal(events[0].as_of, '2026-02-01T00:00:00Z');
});

test('nothing new produces no events', () => {
  const assertions = [a('ctl.a.b.c', '2026-01-01T00:00:00Z', 10)];
  const routed = route({ assertions, controls: [ctl()], drift: assessDrift({ assertions }) });
  assert.deepEqual(eventsFromRoute(routed, { assertions }), []);
});

test('an untimed route result is refused', () => {
  assert.throws(
    () => eventsFromRoute({ held: false, items: [] }, { assertions: [] }),
    /as_of is required/,
  );
});

test('a synthetic assertion set stamps every event', () => {
  const assertions = [a('ctl.a.b.c', '2026-01-01T00:00:00Z', 10, ['s1'], { fixture: true })];
  const routed = route({ assertions, controls: [ctl()], drift: assessDrift({ assertions }) });
  const [event] = eventsFromRoute(routed, { assertions });
  assert.equal(event._stamp, FIXTURE_STAMP);
  assert.equal(event.fixture, true);
});

test('dispatchRoute on a hold opens a slack page gate and does not send', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'grc-route-'));
  const store = join(dir, 'gates.json');
  const assertions = [
    a('ctl.a.b.c', '2026-01-01T00:00:00Z', 60, ['s1'], { fixture: true }),
    a('ctl.a.b.c', '2026-02-01T00:00:00Z', 45, ['s1'], { fixture: true }),
  ];
  const routed = route({ assertions, controls: [ctl()], drift: assessDrift({ assertions }) });
  const r = await dispatchRoute({ routed, assertions, store });
  assert.equal(r.ok, true);
  assert.equal(r.sent, false);
  assert.equal(r.executed, false);
  assert.equal(r.results[0].gate.kind, 'human-page');
  assert.equal(r.results[0].gate.presenter, 'slack');
  const pending = await listStored(store);
  assert.equal(pending.length, 1);
  await rm(dir, { recursive: true, force: true });
});

test('dispatchRoute on a new failure packs exception-triage and opens no gate', async () => {
  const assertions = [a('ctl.a.b.c', '2026-01-01T00:00:00Z', 10, ['s1'], { fixture: true })];
  const routed = route({ assertions, controls: [ctl()], drift: assessDrift({ assertions }) });
  const r = await dispatchRoute({ routed, assertions, store: null });
  assert.equal(r.results[0].plan.tasks[0].agent, 'exception-triage');
  assert.equal(r.results[0].gate, null);
  assert.equal(r.sent, false);
});
