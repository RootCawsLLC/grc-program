import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOOLS, findTool, loadContext } from '../src/mcp/tools.mjs';
import { assertReadOnly, buildServer } from '../src/mcp/server.mjs';

const CONTROL = 'ctl.iam.cloud-platform.mfa';

let ctx;
before(async () => { ctx = await loadContext(process.cwd()); });

/** Arguments that exercise a tool meaningfully rather than just not crashing. */
const argsFor = (name) =>
  ['get_control', 'get_assertion_history', 'get_variance'].includes(name) ? { control_id: CONTROL } : {};

// ── read-only, three ways ────────────────────────────────────────────────────────────────────

test('every tool declares effect: read', () => {
  assert.equal(TOOLS.length, 8);
  for (const t of TOOLS) assert.equal(t.effect, 'read', `${t.name} must be read-only`);
});

test('the server REFUSES TO START if any tool declares a write effect', () => {
  // The label is not the protection — this is. Writes go through pull requests; a model that can
  // write to controls/ has removed the only human step in the chain.
  assert.throws(
    () => assertReadOnly([...TOOLS, { name: 'apply_fix', effect: 'write' }]),
    /refusing to start: apply_fix/,
  );
  assert.throws(() => assertReadOnly([{ name: 'x', effect: 'propose' }]), /read-only/);
  assert.doesNotThrow(() => assertReadOnly(TOOLS));
});

test('exercising every tool leaves the working tree byte-for-byte unchanged', async () => {
  // The test that would actually catch a regression, because it checks behaviour rather than a
  // label. If any handler ever writes, this fails regardless of what its `effect` claims.
  const status = () => execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
  const before = status();

  for (const t of TOOLS) await t.handler(argsFor(t.name), ctx);

  assert.equal(status(), before, 'a tool modified the working tree');
});

// ── the descriptions, which B19 says matter as much as the code ──────────────────────────────

test('every tool description says what the answer is NOT', () => {
  // A description decides which tool gets called and how the answer is read. Each of these carries
  // an explicit disclaimer because the failure mode is a true number understood as a wider claim
  // than it supports.
  const disclaimers = /not|never|excludes|does not|say nothing|unknown|deliberately/i;
  for (const t of TOOLS) {
    assert.ok(t.description.length > 200, `${t.name}: description is too thin to disambiguate`);
    assert.match(t.description, disclaimers, `${t.name}: must say what the answer does not claim`);
    assert.ok(t.title, `${t.name}: needs a title`);
    assert.equal(t.inputSchema.type, 'object');
  }
});

test('required arguments are declared, and optional ones are genuinely optional', async () => {
  assert.deepEqual(findTool('get_control').inputSchema.required, ['control_id']);
  assert.deepEqual(findTool('get_assertion_history').inputSchema.required, ['control_id']);
  // These must work with no arguments at all, or the obvious question cannot be asked.
  for (const name of ['list_controls', 'list_failing', 'health_summary', 'gap_summary', 'get_findings']) {
    assert.equal(findTool(name).inputSchema.required, undefined, `${name} must be callable bare`);
    await findTool(name).handler({}, ctx);
  }
});

// ── provenance ───────────────────────────────────────────────────────────────────────────────

test('every answer names the files it came from', async () => {
  for (const t of TOOLS) {
    const r = await t.handler(argsFor(t.name), ctx);
    assert.ok(r._source, `${t.name} returned no provenance`);
    assert.ok(Array.isArray(r._source.files) && r._source.files.length, `${t.name}: no files named`);
    assert.equal(typeof r._source.evidence_is_fixture, 'boolean');
  }
});

test('a fixture-derived assertion set warns on every answer that touches it', async () => {
  const synthetic = { ...ctx, assertions: ctx.assertions.map((a) => ({ ...a, fixture: true })) };
  const r = await findTool('list_failing').handler({}, synthetic);
  assert.equal(r._source.evidence_is_fixture, true);
  assert.match(r._source.warning, /NOT REAL EVIDENCE/);

  const real = { ...ctx, assertions: ctx.assertions.map(({ fixture, ...a }) => a) };
  const r2 = await findTool('list_failing').handler({}, real);
  assert.equal(r2._source.evidence_is_fixture, false);
  assert.equal(r2._source.warning, undefined);
});

// ── the semantics that are easy to get wrong ─────────────────────────────────────────────────

test('list_failing separates UNMEASURED from passing', async () => {
  // The most common way this question is answered wrongly. A control with no assertion is not
  // passing; it is unknown, and reporting it as a zero would be a fabrication.
  const r = await findTool('list_failing').handler({}, ctx);
  assert.ok(Array.isArray(r.unmeasured));
  assert.ok(r.controls_unmeasured > 0, 'the seed inventory has controls with no assertion');
  assert.match(r.note, /UNKNOWN, not passing/);
  for (const id of r.unmeasured) assert.ok(!r.measured.some((m) => m.control_id === id));
});

test('an unknown control_id is an explained answer, not a crash', async () => {
  const r = await findTool('get_control').handler({ control_id: 'ctl.nope.nope.nope' }, ctx);
  assert.match(r.error, /No control ctl\.nope\.nope\.nope/);
  assert.match(r.error, /list_controls/);
  assert.ok(r._source);
});

test('get_control does not imply operation when there is no evidence', async () => {
  // A control record read on its own is the most likely thing to be mistaken for a measurement:
  // `status: operating` is a lifecycle state a human set, not evidence. When there is no assertion
  // the answer must say so in the answer itself, not rely on the reader knowing the difference.
  const unmeasured = ctx.controls.find(
    (c) => !ctx.assertions.some((a) => a.control_id === c.control_id),
  );
  assert.ok(unmeasured, 'the seed inventory should contain a control with no assertion');

  const r = await findTool('get_control').handler({ control_id: unmeasured.control_id }, ctx);
  assert.equal(r.latest_assertion, null);
  assert.ok(r.note, 'an unmeasured control must carry a note');
  assert.match(r.note, /no assertion record exists/i);
  assert.match(r.note, /not a measurement|nothing here is a measurement/i);
});

test('list_controls filters compose and never exceed the inventory', async () => {
  const all = await findTool('list_controls').handler({}, ctx);
  assert.equal(all.count, ctx.controls.length);
  const planned = await findTool('list_controls').handler({ status: 'planned' }, ctx);
  assert.ok(planned.count <= all.count);
  for (const c of planned.controls) assert.equal(c.status, 'planned');
  assert.equal(planned.of_total, ctx.controls.length, 'the denominator must stay visible when filtering');
});

// ── variance ─────────────────────────────────────────────────────────────────────────────────

test('get_variance refuses to infer an episode from a single observation', async () => {
  const r = await findTool('get_variance').handler({ control_id: CONTROL }, ctx);
  assert.deepEqual(r.episodes, []);
  assert.match(r.note, /at least two observations/);
});

test('get_variance derives episodes across a real history, and leaves the ticket timestamp null', async () => {
  const mk = (as_of, failing) => ({
    control_id: CONTROL, as_of, population_definition: 'p', source_system: 's', query_ref: 'q',
    total: 3, passing_count: 3 - failing.length, failing_count: failing.length,
    failing: failing.map((s) => ({ subject_id: s, reason: 'r', first_observed: as_of, exception_ref: null })),
    coverage_basis: 'c', confidence_tier: 4,
  });
  const history = {
    ...ctx,
    assertions: [
      mk('2026-06-15T00:00:00Z', []),
      mk('2026-07-15T00:00:00Z', ['a', 'b']),
      mk('2026-08-15T00:00:00Z', ['b']),
    ],
  };
  const r = await findTool('get_variance').handler({ control_id: CONTROL }, history);

  assert.equal(r.closed_episodes.length, 1, 'a closed episode for the subject that recovered');
  assert.equal(r.closed_episodes[0].subject_id, 'a');
  assert.equal(r.closed_episodes[0].remediation_completed_at, '2026-08-15T00:00:00Z');

  assert.equal(r.open_episodes.length, 1, 'the subject still failing stays open');
  assert.equal(r.open_episodes[0].subject_id, 'b');
  assert.equal(r.open_episodes[0].total_duration_days, null, 'an open episode has no duration');

  // The fourth timestamp is not in an assertion record and must not be invented.
  for (const e of [...r.closed_episodes, ...r.open_episodes]) {
    assert.equal(e.remediation_started_at, null);
  }
  assert.match(r.remediation_started_at_note, /ticketing system/);
});

// ── the server surface ───────────────────────────────────────────────────────────────────────

test('the server builds and advertises every tool with its effect tag', () => {
  const server = buildServer(ctx);
  assert.ok(server, 'buildServer returned nothing');
  // The effect is surfaced in the description so a model can see nothing here mutates anything.
  for (const t of TOOLS) assert.ok(`[${t.effect}] ${t.description}`.startsWith('[read]'));
});

test('importing the server module does not open a transport', () => {
  // If it did, `node --test` would hang holding stdio, and the failure would look like a broken
  // test runner rather than a broken guard.
  assert.equal(typeof buildServer, 'function');
  assert.equal(typeof assertReadOnly, 'function');
});

// ── the end-to-end proof ─────────────────────────────────────────────────────────────────────
// B19's done-when is "the server RUNS". Everything above tests the handlers in-process, which
// would still pass if the transport were broken, the module crashed on start, or something wrote
// to stdout and corrupted the JSON-RPC stream. This spawns the real server as a subprocess and
// talks to it over stdio, which is the only test that would catch those.

test('the server runs as a subprocess and answers over stdio', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['src/mcp/server.mjs'],
    cwd: process.cwd(),
  });
  const client = new Client({ name: 'reco-grc-test', version: '0' }, { capabilities: {} });

  try {
    await client.connect(transport);

    const { tools } = await client.listTools();
    assert.equal(tools.length, 8);
    for (const t of tools) assert.ok(t.description.startsWith('[read]'), `${t.name} must advertise its effect`);

    // The question B19 names explicitly: "which controls are failing".
    const res = await client.callTool({ name: 'list_failing', arguments: {} });
    assert.ok(!res.isError, 'list_failing errored over the wire');
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(typeof parsed.failing_subjects, 'number');

    // Traceable to a file in this repo — the other half of the done-when.
    assert.ok(parsed._source.files.includes('fixtures/assertions.json'));

    const unknown = await client.callTool({ name: 'definitely_not_a_tool', arguments: {} });
    assert.equal(unknown.isError, true);
    assert.match(unknown.content[0].text, /no such tool/);
  } finally {
    await client.close();
  }
});

// ── refusing a root that is not this repo ────────────────────────────────────────────────────
//
// THE BUG THESE PIN. Every loader degrades gracefully to an empty result, so pointed at the wrong
// directory the server used to start cleanly, report "0 controls", and answer list_failing with
// zero failing subjects — indistinguishable from good news. It shipped that way: registered at
// local scope with no RECO_GRC_ROOT, it launched with cwd set to the parent workspace directory
// and showed "✔ Connected" while knowing about nothing at all.

test('loadContext REFUSES a directory that is not the reco-grc repo', async () => {
  const parent = join(process.cwd(), '..');
  await assert.rejects(() => loadContext(parent), /is not the reco-grc repository/);
});

test('the refusal names the root and says how to fix it', async () => {
  let err;
  try { await loadContext(tmpdir()); } catch (e) { err = e; }
  assert.ok(err, 'a temp directory must be refused');
  assert.ok(err.message.includes(tmpdir()), 'must name the offending root');
  assert.match(err.message, /RECO_GRC_ROOT/, 'must say how to point it at the repo');
  assert.match(err.message, /claude mcp add/, 'must give the actual command');
  // The reasoning travels with the refusal, or it reads as a bug to route around.
  assert.match(err.message, /indistinguishable\s+from good news/);
});

test('a directory with the right shape but the wrong package name is still refused', async () => {
  // Guards against a sibling checkout — cui-control-plane also has schemas/ and controls/.
  const dir = mkdtempSync(join(tmpdir(), 'grc-fakeroot-'));
  try {
    mkdirSync(join(dir, 'schemas'), { recursive: true });
    writeFileSync(join(dir, 'schemas', 'control.schema.json'), '{}');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'cui-control-plane' }));
    await assert.rejects(() => loadContext(dir), /is not the reco-grc repository/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the real repo root is still accepted', async () => {
  const c = await loadContext(process.cwd());
  assert.ok(c.controls.length > 0, 'the repo root must load a non-empty inventory');
});
