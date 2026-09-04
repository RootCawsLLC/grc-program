/**
 * Dispatch host — run plan → present → decide against one event envelope.
 *
 * This is the process a Slack/GitHub/Linear adapter would call. It produces
 * presenter payloads. It does not post them. A `--live` / `send: true` flag is
 * refused rather than implemented, because a send that is "not wired yet" and
 * a send that quietly no-ops are indistinguishable in a log, and the next
 * person to "fix" the no-op would be the person who first contacts a real
 * channel from this repo.
 *
 * `executed` is always false. Consent recorded here is not a merge.
 */

import { readFile } from 'node:fs/promises';

import { FIXTURE_STAMP, isUnderFixtures } from './lib/load.mjs';
import { planDispatch } from './orchestrate.mjs';
import { openGate, presentGate, decideGate, interpretInteraction } from './gate.mjs';
import { resolveInteractionActor } from './inbound.mjs';
import {
  DEFAULT_GATES,
  loadGateLog,
  latestGate,
  pendingGates,
  rememberOpened,
  rememberDecision,
} from './gates.mjs';

export { DEFAULT_GATES };

function summaryFrom(event, plan) {
  const p = event.payload ?? {};
  if (p.cve && p.component) return `${p.cve} matches ${p.component}`;
  if (plan.reason) return plan.reason;
  return plan.gate?.action ?? event.kind;
}

function fixtureFlag(event) {
  return event?._stamp === FIXTURE_STAMP || event?.fixture === true;
}

/**
 * Load an event envelope. A path under `fixtures/` without the stamp is refused —
 * an unstamped fixture is indistinguishable from a real alert.
 */
export async function loadEvent(path) {
  const raw = JSON.parse(await readFile(path, 'utf8'));
  if (isUnderFixtures(path) && raw._stamp !== FIXTURE_STAMP) {
    throw new Error(
      `refusing unstamped fixture event ${path}. ` +
        `Expected _stamp: "${FIXTURE_STAMP}". An unstamped fixture is indistinguishable from a real alert.`,
    );
  }
  return raw;
}

/**
 * @param {object} event
 * @param {{ decision?: object, roster?: object, send?: boolean }} [opts]
 */
export function dispatch(event, { decision, roster, send } = {}) {
  if (send) {
    return {
      ok: false,
      code: 'send-refused',
      message:
        'This host does not send. Presenters are payloads. --live / send:true would contact ' +
        'Slack, GitHub or Linear and is refused.',
      executed: false,
      sent: false,
      fixture: fixtureFlag(event),
      plan: null,
      gate: null,
      presenter: null,
      decision: null,
    };
  }

  const plan = planDispatch(event);
  const opened = plan.gate
    ? openGate({ plan, event, summary: summaryFrom(event, plan) })
    : { opened: false, pending: null };
  const presenter = opened.pending ? presentGate(opened.pending) : null;
  const decided = decision && opened.pending
    ? decideGate(opened.pending, decision, { roster })
    : null;

  const ok = Boolean(plan.accepted) && (!decided || decided.ok);
  return {
    ok,
    code: decided && !decided.ok ? decided.code : plan.accepted ? null : plan.refusals?.[0]?.code ?? 'refused',
    message: decided && !decided.ok ? decided.message : null,
    executed: false,
    sent: false,
    fixture: fixtureFlag(event),
    plan,
    gate: opened.pending,
    presenter,
    decision: decided,
  };
}

/**
 * Slack (or any presenter) button → decideGate. The host looks up the pending
 * record; the payload only names the button and the gate_id.
 */
export function handleInteraction(pending, payload, extras = {}) {
  const { verdict, gate_id } = interpretInteraction(payload);
  if (!verdict) {
    return {
      ok: false,
      code: 'unknown-action',
      message: `action_id ${JSON.stringify(payload?.action_id)} is not a gate button.`,
      record: { ...pending, executed: false, executed_action: null },
    };
  }
  if (gate_id !== pending.gate_id) {
    return {
      ok: false,
      code: 'gate-mismatch',
      message: `payload gate_id ${JSON.stringify(gate_id)} does not match ${pending.gate_id}.`,
      record: { ...pending, executed: false, executed_action: null },
    };
  }
  return decideGate(pending, { ...extras, verdict }, extras);
}

/**
 * Persist an opened gate, then optionally decide the stored row — never a
 * detached clone. A Slack click in another process calls `handleStoredInteraction`.
 */
export async function runGate({
  event,
  gate_id,
  decision,
  store,
  roster,
  send,
} = {}) {
  if (send) {
    return dispatch(event ?? { event_id: '?', kind: 'auditor.request', source: 'send', as_of: new Date().toISOString() }, { send: true });
  }

  let opened = null;
  if (event) {
    opened = dispatch(event);
    if (store && opened.gate) {
      const mem = await rememberOpened(store, opened.gate, opened.fixture);
      if (mem.error === 'already-decided') {
        return {
          ...opened,
          ok: false,
          code: 'already-decided',
          message: `${opened.gate.gate_id} is already ${mem.stored.status}. Mint a new event_id.`,
          gate: mem.stored,
          presenter: presentGate(mem.stored),
          stored: true,
          reused: false,
        };
      }
      opened = { ...opened, gate: mem.stored, stored: true, reused: mem.reused };
    }
  }

  if (!decision) {
    return opened ?? {
      ok: false,
      code: 'missing-event',
      message: 'runGate needs an event to open, or a gate_id to decide.',
      executed: false,
      sent: false,
      plan: null,
      gate: null,
      presenter: null,
      decision: null,
    };
  }

  return decideStored({
    store,
    pending: opened?.gate,
    gate_id: gate_id ?? opened?.gate?.gate_id,
    decision,
    roster,
    plan: opened?.plan,
    fixture: opened?.fixture,
  });
}

export async function decideStored({
  store,
  pending,
  gate_id,
  decision,
  roster,
  plan = null,
  fixture = false,
} = {}) {
  let record = pending;
  if (store) {
    const { entries } = await loadGateLog(store);
    record = latestGate(entries, gate_id);
    if (!record) {
      return {
        ok: false,
        code: 'unknown-gate',
        message: `No gate ${gate_id} in ${store}.`,
        executed: false,
        sent: false,
        plan,
        gate: null,
        presenter: null,
        decision: null,
        stored: true,
      };
    }
  }
  if (!record) {
    return {
      ok: false,
      code: 'unknown-gate',
      message: 'No pending record to decide.',
      executed: false,
      sent: false,
      plan,
      gate: null,
      presenter: null,
      decision: null,
    };
  }

  const decided = decideGate(record, decision, { roster });
  if (store && decided.ok) {
    await rememberDecision(store, decided.record, record.fixture ?? fixture);
  }

  return {
    ok: decided.ok,
    code: decided.ok ? null : decided.code,
    message: decided.ok ? null : decided.message,
    executed: false,
    sent: false,
    fixture: Boolean(record.fixture ?? fixture),
    plan,
    gate: record,
    presenter: presentGate(record),
    decision: decided,
    stored: Boolean(store),
  };
}

export async function handleStoredInteraction({ store, payload, extras = {}, map } = {}) {
  const { verdict, gate_id } = interpretInteraction(payload);
  if (!verdict || !gate_id) {
    return handleInteraction({ gate_id: null, status: 'pending', executed: false }, payload, extras);
  }
  const resolved = resolveInteractionActor({ payload, map, actor: extras.actor });
  if (!resolved.ok) {
    return {
      ok: false,
      code: resolved.code,
      message: resolved.message,
      executed: false,
      sent: false,
      plan: null,
      gate: null,
      presenter: null,
      decision: null,
    };
  }
  return decideStored({
    store,
    gate_id,
    decision: { ...extras, actor: resolved.actor, verdict },
    roster: extras.roster,
  });
}

export async function listStored(store = DEFAULT_GATES) {
  const { entries } = await loadGateLog(store);
  return pendingGates(entries);
}

/**
 * Dispatch every envelope `eventsFromRoute` produced. Continuing subjects
 * are not in that list. A held cycle opens one drift gate and no tickets.
 */
export async function dispatchRoute({ routed, assertions, store, send } = {}) {
  const { eventsFromRoute } = await import('./from-route.mjs');
  const events = eventsFromRoute(routed, { assertions });
  const results = [];
  for (const event of events) {
    results.push(await runGate({ event, store, send }));
  }
  return {
    ok: results.every((r) => r.ok),
    executed: false,
    sent: false,
    events,
    results,
  };
}
