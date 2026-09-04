import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadContext } from '../src/mcp/tools.mjs';
import { planDispatch } from '../src/orchestrate.mjs';
import { loadEvent } from '../src/host.mjs';
import { hydrateTask, materializePacks } from '../src/pack.mjs';
import { draftFromPack, materializeDrafts, assertDraftDir } from '../src/draft.mjs';
import { FIXTURE_STAMP } from '../src/lib/load.mjs';

const run = promisify(execFile);

let ctx;
before(async () => { ctx = await loadContext(process.cwd()); });

const failing = () => ({
  event_id: 'evt.draft.failing',
  kind: 'control.failing',
  source: 'pipeline.route',
  as_of: '2026-08-15T00:00:00Z',
  derivation_level: 'measured',
  fixture: true,
  _stamp: FIXTURE_STAMP,
  payload: {
    control_id: 'ctl.iam.cloud-platform.mfa',
    subject_id: '444455556666:erin',
    item_id: 'ctl.iam.cloud-platform.mfa|444455556666:erin',
    days_failing: 31,
  },
});

test('exception-triage drafts a save_issue payload and does not post or close', async () => {
  const event = failing();
  const pack = await hydrateTask(planDispatch(event).tasks[0], event, { ctx, fixture: true });
  const d = draftFromPack(pack);
  assert.equal(d.ok, true);
  assert.equal(d.tool, 'save_issue');
  assert.equal(d.posted, false);
  assert.equal(d.executed, false);
  assert.equal(d.closes_item, false);
  assert.equal(d.approves_exception, false);
  assert.equal(d.issue.team, 'platform-engineering');
  assert.match(d.issue.title, /erin/);
  assert.match(d.issue.description, /first_observed|failing_for_days/);
  assert.match(d.issue.description, /not an exception approval/);
});

test('evidence-scout refuses a building control rather than answering', async () => {
  const event = await loadEvent('fixtures/events/auditor-request.json');
  const pack = await hydrateTask(planDispatch(event).tasks[0], event, { ctx, fixture: true });
  const d = draftFromPack(pack);
  assert.equal(d.ok, false);
  assert.equal(d.code, 'not-operating');
  assert.equal(d.posted, false);
  assert.match(d.message, /under construction/);
});

test('evidence-scout on an operating control reports 43 of 47 and does not round', () => {
  const pack = {
    specialist: 'evidence-scout',
    event_id: 'evt.draft.ev',
    kind: 'auditor.request',
    as_of: '2026-09-15T00:00:00Z',
    derivation_level: 'measured',
    fixture: true,
    _stamp: FIXTURE_STAMP,
    payload: { control_id: 'ctl.example.operating.x' },
    reads: {
      get_control: {
        control: {
          control_id: 'ctl.example.operating.x',
          status: 'operating',
          title: 'Example',
          query_ref: 'models/example.sql',
          source_system: 'aws',
          collection: { cadence: 'daily' },
        },
        latest_assertion: {
          as_of: '2026-09-15T00:00:00Z',
          total: 47,
          passing_count: 43,
          failing_count: 4,
          coverage_basis: '47 principals',
        },
      },
    },
    shared_state_file: null,
    executed: false,
  };
  const d = draftFromPack(pack);
  assert.equal(d.ok, true);
  assert.equal(d.package.population, '43 of 47');
  assert.equal(d.screenshot, false);
  assert.equal(d.rounded, false);
  const blob = JSON.stringify(d);
  assert.equal(/approximately|91%|100%/.test(blob), false);
});

test('evidence-scout refuses a stale assertion and a FedRAMP question', () => {
  const base = {
    specialist: 'evidence-scout',
    event_id: 'evt.draft.stale',
    kind: 'auditor.request',
    as_of: '2026-09-20T00:00:00Z',
    derivation_level: 'measured',
    payload: { control_id: 'ctl.example.operating.x' },
    reads: {
      get_control: {
        control: {
          control_id: 'ctl.example.operating.x',
          status: 'operating',
          query_ref: 'q.sql',
          collection: { cadence: 'daily' },
        },
        latest_assertion: { as_of: '2026-09-15T00:00:00Z', total: 10, passing_count: 10, failing_count: 0 },
      },
    },
  };
  assert.equal(draftFromPack(base).code, 'stale-assertion');
  assert.equal(draftFromPack({
    ...base,
    as_of: '2026-09-15T00:00:00Z',
    payload: { control_id: 'ctl.example.operating.x', question: 'Are you FedRAMP authorized?' },
  }).code, 'no-fedramp');
});

test('a CVE match is a control deficiency, not a calibrated scenario', async () => {
  const event = await loadEvent('fixtures/events/threat-intel-match.json');
  const plan = planDispatch(event);
  const scoper = plan.tasks.find((t) => t.agent === 'scenario-scoper');
  const pack = await hydrateTask(scoper, event, { ctx, fixture: true });
  const d = draftFromPack(pack);
  assert.equal(d.ok, true);
  assert.equal(d.scenario, null);
  assert.equal(d.redirect, 'control-deficiency');
  assert.equal(d.parameters_populated, false);
  assert.equal(d.posted, false);
});

test('a scoped incident drafts zeros at assumed / tier 1 and does not write scenarios/', () => {
  const d = draftFromPack({
    specialist: 'scenario-scoper',
    event_id: 'evt.draft.incident',
    kind: 'incident',
    as_of: '2026-09-04T00:00:00Z',
    payload: {
      threat_actor: 'external financially-motivated actor',
      asset: 'the production cloud environment',
      effect: 'confidentiality',
      control_id: 'ctl.iam.cloud-platform.mfa',
    },
  });
  assert.equal(d.ok, true);
  assert.equal(d.writes_to_scenarios, false);
  assert.equal(d.parameters_populated, false);
  assert.equal(d.scenario.parameters.loss_event_frequency.min, 0);
  assert.equal(d.scenario.parameters.loss_event_frequency.provenance.derivation_level, 'assumed');
  assert.equal(d.scenario.parameters.loss_event_frequency.provenance.confidence_tier, 1);
  assert.match(d.scenario.statement, /acting against/);
});

test('design-time specialists are not drafted here, and send is refused', () => {
  const d = draftFromPack({ specialist: 'policy-generator', event_id: 'e', kind: 'policy.generate' });
  assert.equal(d.code, 'not-mechanical');
  assert.equal(draftFromPack({ specialist: 'exception-triage', event_id: 'e' }, { send: true }).code, 'send-refused');
});

test('drafts cannot land under scenarios/', () => {
  assert.throws(() => assertDraftDir('scenarios/drafts'), /under scenarios\//);
});

test('CLI --draft writes payloads next to packs and does not send', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'grc-draft-cli-'));
  const { stdout } = await run('node', [
    'src/cli.mjs', 'orchestrate',
    '--event', 'fixtures/events/threat-intel-match.json',
    '--draft',
    '--pack-dir', dir,
    '--no-store',
  ]);
  assert.match(stdout, /DRAFT — 2/);
  assert.match(stdout, /posted=false/);
  assert.match(stdout, /executed=false/);
  const scout = JSON.parse(await readFile(join(dir, 'evt.fixture.threat-intel-leftpad', 'evidence-scout.draft.json'), 'utf8'));
  const scoper = JSON.parse(await readFile(join(dir, 'evt.fixture.threat-intel-leftpad', 'scenario-scoper.draft.json'), 'utf8'));
  assert.equal(scout.code, 'missing-control');
  assert.equal(scoper.redirect, 'control-deficiency');
  assert.equal(scout.posted, false);
  await rm(dir, { recursive: true, force: true });
});

test('materializeDrafts writes the exception-triage issue beside the pack', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'grc-draft-mat-'));
  const event = failing();
  const packed = await materializePacks({ plan: planDispatch(event), event, dir, ctx, fixture: true });
  const r = await materializeDrafts({
    packs: packed.plan.tasks.map((t) => t.input_pack),
    dir,
    fixture: true,
  });
  assert.equal(r.posted, false);
  assert.equal(r.drafts[0].tool, 'save_issue');
  await rm(dir, { recursive: true, force: true });
});
