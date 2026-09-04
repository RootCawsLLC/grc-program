import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadContext } from '../src/mcp/tools.mjs';
import { planDispatch } from '../src/orchestrate.mjs';
import { loadEvent } from '../src/host.mjs';
import {
  hydrateTask,
  materializePacks,
  assertPackDir,
  defaultPackDir,
  DEFAULT_PACK_DIR,
  DEFAULT_FIXTURE_PACK_DIR,
} from '../src/pack.mjs';
import { FIXTURE_STAMP } from '../src/lib/load.mjs';

const run = promisify(execFile);

let ctx;
before(async () => { ctx = await loadContext(process.cwd()); });

const failing = (over = {}) => ({
  event_id: 'evt.pack.failing',
  kind: 'control.failing',
  source: 'pipeline.route',
  as_of: '2026-08-15T00:00:00Z',
  derivation_level: 'measured',
  payload: { control_id: 'ctl.iam.cloud-platform.mfa', subject_id: 'acct:erin' },
  ...over,
});

test('hydrate fills MCP reads and names save_issue without calling it', async () => {
  const event = failing({ fixture: true, _stamp: FIXTURE_STAMP });
  const plan = planDispatch(event);
  const pack = await hydrateTask(plan.tasks[0], event, { ctx, fixture: true });
  assert.equal(pack.shared_state_file, null);
  assert.equal(pack.executed, false);
  assert.equal(pack.specialist, 'exception-triage');
  assert.ok(pack.reads.get_control?.control?.control_id === 'ctl.iam.cloud-platform.mfa');
  assert.ok(pack.reads.list_failing);
  assert.ok(pack.reads.get_variance);
  assert.equal(pack.reads.save_issue, undefined);
  assert.ok(pack.skipped.some((s) => s.tool === 'save_issue' && s.reason === 'draft-not-read'));
  assert.equal(pack._stamp, FIXTURE_STAMP);
});

test('a threat-intel event does not invent a control_id for get_control', async () => {
  const event = await loadEvent('fixtures/events/threat-intel-match.json');
  const plan = planDispatch(event);
  const scout = plan.tasks.find((t) => t.agent === 'evidence-scout');
  const pack = await hydrateTask(scout, event, { ctx, fixture: true });
  assert.equal(pack.reads.get_control, undefined);
  assert.ok(pack.skipped.some((s) => s.tool === 'get_control' && s.reason === 'missing-control-id'));
  assert.ok(pack.reads.list_failing, 'list_failing does not require a control_id');
  assert.equal(pack.executed, false);
});

test('materialize writes one file per specialist, never a shared state file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'grc-pack-'));
  const event = await loadEvent('fixtures/events/threat-intel-match.json');
  const plan = planDispatch(event);
  const r = await materializePacks({ plan, event, dir, ctx, fixture: true });
  assert.equal(r.shared_state_file, null);
  assert.equal(r.executed, false);
  assert.equal(r.files.length, 2);
  const names = (await readdir(join(dir, event.event_id))).sort();
  assert.deepEqual(names, ['evidence-scout.json', 'scenario-scoper.json']);
  assert.ok(!names.includes('state.json'));
  const scout = JSON.parse(await readFile(join(dir, event.event_id, 'evidence-scout.json'), 'utf8'));
  assert.equal(scout.shared_state_file, null);
  assert.equal(scout.executed, false);
  assert.equal(scout.specialist, 'evidence-scout');
  await rm(dir, { recursive: true, force: true });
});

test('packs cannot land under controls/ or the real warehouse when synthetic', async () => {
  assert.throws(() => assertPackDir('controls/packs'), /under controls\//);
  assert.throws(() => assertPackDir('policies'), /under policies\//);
  const event = failing({ fixture: true, _stamp: FIXTURE_STAMP });
  await assert.rejects(
    () => materializePacks({
      plan: planDispatch(event),
      event,
      dir: DEFAULT_PACK_DIR,
      ctx,
      fixture: true,
    }),
    /Synthetic and real packs do not share a directory/,
  );
  assert.equal(defaultPackDir(true), DEFAULT_FIXTURE_PACK_DIR);
  assert.equal(defaultPackDir(false), DEFAULT_PACK_DIR);
});

test('CLI --pack writes per-task files and does not send', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'grc-pack-cli-'));
  const { stdout } = await run('node', [
    'src/cli.mjs', 'orchestrate',
    '--event', 'fixtures/events/threat-intel-match.json',
    '--pack',
    '--pack-dir', dir,
    '--no-store',
  ]);
  assert.match(stdout, /PACK — 2 file/);
  assert.match(stdout, /shared_state_file=null/);
  assert.match(stdout, /executed=false/);
  assert.match(stdout, /sent=false/);
  const names = (await readdir(join(dir, 'evt.fixture.threat-intel-leftpad'))).sort();
  assert.deepEqual(names, ['evidence-scout.json', 'scenario-scoper.json']);
  await rm(dir, { recursive: true, force: true });
});
