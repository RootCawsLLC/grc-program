/**
 * Append-only log of human gates.
 *
 * A Slack click arrives in a different process than the one that opened the
 * gate. Without a log, `handleInteraction` has nothing to look up. This file
 * is that log.
 *
 * WHY APPEND-ONLY. Overwriting a pending row with a decision destroys the
 * only evidence that the gate was presented before it was decided. The latest
 * row for a `gate_id` is current; the earlier rows are the history. Same
 * shape as the warehouse: time-indexed, never overwritten.
 *
 * WHY `.warehouse/gates.json`, not the control repo. A pending consent is
 * operational state, not a normative control. Guardrail 2 still holds: this
 * log cannot merge a PR or write `exceptions/`.
 *
 * Synthetic and real gates never share a log. `assertNotMixed` is the same
 * function the assertion loader uses, for the same reason.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { assertNotMixed } from './lib/load.mjs';
import { stableStringify } from './oscal/assessment-results.mjs';

export const DEFAULT_GATES = '.warehouse/gates.json';

function asLog(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.entries)) return parsed.entries;
  throw new Error('gate log: expected { entries: [] }');
}

export async function loadGateLog(path = DEFAULT_GATES) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { path, entries: [] };
    throw new Error(`${path}: ${err.message}`);
  }
  const entries = asLog(parsed);
  assertNotMixed(entries, path);
  return { path, entries };
}

export function latestGate(entries, gateId) {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].gate_id === gateId) return entries[i];
  }
  return null;
}

export function pendingGates(entries) {
  const ids = [...new Set(entries.map((e) => e.gate_id))];
  return ids.map((id) => latestGate(entries, id)).filter((e) => e?.status === 'pending');
}

async function writeLog(path, entries) {
  assertNotMixed(entries, path);
  await mkdir(dirname(path) || '.', { recursive: true });
  await writeFile(path, stableStringify({ entries }));
}

/**
 * Record a newly opened gate. A retry with the same gate_id while still
 * pending is a no-op — the id is derived from event_id on purpose.
 * A retry after a decision is refused; mint a new event_id.
 */
export async function rememberOpened(path, pending, fixture) {
  if (!pending?.gate_id) return { error: 'missing-gate', stored: null, reused: false };
  const { entries } = await loadGateLog(path);
  const current = latestGate(entries, pending.gate_id);
  if (current && current.status === 'pending') {
    return { error: null, stored: current, reused: true };
  }
  if (current && current.status !== 'pending') {
    return { error: 'already-decided', stored: current, reused: false };
  }
  const stored = {
    ...pending,
    fixture: Boolean(fixture),
    stored_at: pending.opened_at,
  };
  await writeLog(path, [...entries, stored]);
  return { error: null, stored, reused: false };
}

export async function rememberDecision(path, record, fixture) {
  if (!record?.gate_id) return { error: 'missing-gate', stored: null };
  const { entries } = await loadGateLog(path);
  const current = latestGate(entries, record.gate_id);
  if (!current) return { error: 'unknown-gate', stored: null };
  if (current.status !== 'pending') return { error: 'not-pending', stored: current };
  const stored = {
    ...record,
    fixture: fixture ?? current.fixture ?? false,
    stored_at: record.decided_at ?? record.opened_at,
  };
  await writeLog(path, [...entries, stored]);
  return { error: null, stored };
}
