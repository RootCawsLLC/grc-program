/**
 * Hydrate and materialize per-task packs.
 *
 * `planDispatch` names a specialist and hands them an envelope. That is not
 * yet a pack: the specialist would still have to re-query the control graph,
 * which is how shared context files start. This module fills each task with
 * the read-only MCP results it is allowed to see, then writes one file per
 * specialist.
 *
 * Draft tools (`save_issue`) are named, not invoked. Normative names cannot
 * appear. `shared_state_file` stays null. `executed` stays false. A pack is
 * context for a later session, not a merge and not a Linear post.
 *
 * Synthetic and real packs do not share a default directory.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { findTool, loadContext } from './mcp/tools.mjs';
import { FIXTURE_STAMP } from './lib/load.mjs';
import { NORMATIVE_ACTIONS } from './orchestrate.mjs';
import { stableStringify } from './oscal/assessment-results.mjs';

export const DEFAULT_PACK_DIR = '.warehouse/packs';
export const DEFAULT_FIXTURE_PACK_DIR = 'out-synthetic/packs';

const BLOCKED_SEGMENTS = Object.freeze(['controls', 'policies', 'exceptions']);
const SHARED_NAMES = Object.freeze(['state.json', 'shared.json', 'shared-state.json', 'state.md']);

function normalised(path) {
  return String(path).replace(/\\/g, '/');
}

function sameDir(a, b) {
  return normalised(a).replace(/\/+$/, '') === normalised(b).replace(/\/+$/, '');
}

export function defaultPackDir(fixture) {
  return fixture ? DEFAULT_FIXTURE_PACK_DIR : DEFAULT_PACK_DIR;
}

/**
 * Packs are operational. Writing them under the inventory would make a
 * specialist's working copy look like a control change.
 */
export function assertPackDir(dir) {
  if (!dir || typeof dir !== 'string') {
    throw new Error('materializePacks needs a directory. Packs are per-task files, not a shared state file.');
  }
  const parts = normalised(dir).split('/').filter(Boolean);
  for (const seg of BLOCKED_SEGMENTS) {
    if (parts.includes(seg)) {
      throw new Error(
        `refusing to write packs under ${seg}/. Packs are operational context, not a control record.`,
      );
    }
  }
}

function assertNotMixedDir(dir, fixture) {
  if (fixture && sameDir(dir, DEFAULT_PACK_DIR)) {
    throw new Error(
      `refusing to write a fixture pack into ${DEFAULT_PACK_DIR}. ` +
        'Synthetic and real packs do not share a directory.',
    );
  }
  if (!fixture && sameDir(dir, DEFAULT_FIXTURE_PACK_DIR)) {
    throw new Error(
      `refusing to write a real pack into ${DEFAULT_FIXTURE_PACK_DIR}. ` +
        'Synthetic and real packs do not share a directory.',
    );
  }
}

export function packFilePath(dir, eventId, agent) {
  const safeEvent = String(eventId).replace(/[^a-zA-Z0-9._-]+/g, '.');
  const safeAgent = String(agent).replace(/[^a-zA-Z0-9._-]+/g, '-');
  if (SHARED_NAMES.includes(`${safeAgent}.json`.toLowerCase()) || SHARED_NAMES.includes(safeAgent.toLowerCase())) {
    throw new Error('refusing to write a shared state file. Each specialist gets their own pack.');
  }
  return join(dir, safeEvent, `${safeAgent}.json`);
}

/**
 * Arguments for one MCP read. Missing required inputs are a skip, not a guess.
 */
export function toolArgs(name, event) {
  const tool = findTool(name);
  const required = tool?.inputSchema?.required ?? [];
  const control_id = event?.payload?.control_id ?? null;
  if (required.includes('control_id') && !control_id) {
    return {
      ok: false,
      code: 'missing-control-id',
      message: `${name} needs control_id. The envelope did not name one; refusing to invent it.`,
    };
  }
  const args = {};
  if (control_id && (required.includes('control_id') || name === 'list_failing')) {
    args.control_id = control_id;
  }
  return { ok: true, args };
}

/**
 * Fill one task's input_pack with read-only results. Draft tools stay names.
 */
export async function hydrateTask(task, event, { ctx, fixture = false } = {}) {
  const context = ctx ?? await loadContext();
  const reads = {};
  const skipped = [];

  for (const name of task.tools ?? []) {
    if (NORMATIVE_ACTIONS.includes(name)) {
      skipped.push({
        tool: name,
        reason: 'normative-unregistered',
        message: `${name} is not a tool this host will call.`,
      });
      continue;
    }
    const tool = findTool(name);
    if (!tool) {
      skipped.push({
        tool: name,
        reason: 'draft-not-read',
        message: `${name} is not an MCP read tool. Named in the pack, not invoked.`,
      });
      continue;
    }
    if (tool.effect !== 'read') {
      skipped.push({
        tool: name,
        reason: 'not-read',
        message: `${name} effect is ${tool.effect}. Packs only hydrate reads.`,
      });
      continue;
    }
    const args = toolArgs(name, event);
    if (!args.ok) {
      skipped.push({ tool: name, reason: args.code, message: args.message });
      continue;
    }
    reads[name] = await tool.handler(args.args, context);
  }

  const stamped = Boolean(
    fixture
    || event?._stamp === FIXTURE_STAMP
    || event?.fixture === true,
  );

  return {
    ...(task.input_pack ?? {}),
    event_id: event.event_id,
    kind: event.kind,
    as_of: event.as_of,
    source: event.source,
    derivation_level: event.derivation_level ?? task.input_pack?.derivation_level ?? null,
    payload: event.payload ?? {},
    specialist: task.agent,
    shared_state_file: null,
    reads,
    skipped,
    executed: false,
    fixture: stamped,
    ...(stamped ? { _stamp: FIXTURE_STAMP } : {}),
  };
}

export async function hydratePlan(plan, event, opts = {}) {
  const ctx = opts.ctx ?? await loadContext();
  const tasks = [];
  for (const task of plan.tasks ?? []) {
    tasks.push({
      ...task,
      input_pack: await hydrateTask(task, event, { ...opts, ctx }),
    });
  }
  return { ...plan, tasks, executed: false };
}

/**
 * Write one JSON file per specialist. No shared state file.
 */
export async function materializePacks({ plan, event, dir, ctx, fixture } = {}) {
  assertPackDir(dir);
  const stamped = Boolean(fixture || event?._stamp === FIXTURE_STAMP || event?.fixture === true);
  assertNotMixedDir(dir, stamped);

  const hydrated = await hydratePlan(plan, event, { ctx, fixture: stamped });
  const files = [];
  for (const task of hydrated.tasks) {
    const path = packFilePath(dir, event.event_id, task.agent);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, stableStringify(task.input_pack));
    files.push(path);
  }
  return {
    ok: true,
    executed: false,
    shared_state_file: null,
    fixture: stamped,
    files,
    plan: hydrated,
  };
}

/**
 * Materialize every dispatched event that actually packed a specialist.
 * Holds and freezes write nothing — silence is the pack.
 */
export async function materializeDispatch({ results = [], events = [], dir, ctx, fixture } = {}) {
  const context = ctx ?? await loadContext();
  const files = [];
  const packs = [];
  for (let i = 0; i < results.length; i += 1) {
    const event = events[i];
    const plan = results[i]?.plan;
    if (!event || !plan?.tasks?.length) continue;
    const packed = await materializePacks({
      plan,
      event,
      dir,
      ctx: context,
      fixture: fixture ?? event.fixture,
    });
    files.push(...packed.files);
    packs.push(...packed.plan.tasks.map((t) => t.input_pack));
  }
  return { ok: true, executed: false, shared_state_file: null, files, packs };
}
