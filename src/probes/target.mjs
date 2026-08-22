/**
 * HTTP client for the probe target.
 *
 * The target is proofplane's own deliberately non-compliant agent
 * (https://github.com/RootCawsLLC/proofplane, `target/`), which exists to be attacked. It runs
 * locally with a mock model provider — no API key, no external call, no production system.
 *
 * NOTHING HERE MAY POINT AT A REAL SYSTEM. `assertLoopback()` refuses any base URL that is not
 * loopback, and it is not a formality: a probe is an attack, and the difference between running
 * one against a test agent and running one against a live agent is a security incident and
 * possibly a crime. The check lives at the transport layer so no probe can opt out of it.
 */

const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?$/;

export function assertLoopback(baseUrl) {
  const origin = String(baseUrl).replace(/\/+$/, '');
  if (!LOOPBACK.test(origin)) {
    throw new Error(
      `refusing to probe ${JSON.stringify(baseUrl)}: probe targets must be loopback.\n` +
      '  A probe is an attack. It runs against proofplane\'s own instrumented target and nothing else.',
    );
  }
  return origin;
}

async function call(baseUrl, method, path, body, { timeoutMs = 20_000 } = {}) {
  const origin = assertLoopback(baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${origin}${path}`, {
      method,
      signal: controller.signal,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
    return { status: res.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

export const reset = (baseUrl) => call(baseUrl, 'POST', '/reset', {});
export const chat = (baseUrl, payload) => call(baseUrl, 'POST', '/chat', payload);
export const audit = (baseUrl) => call(baseUrl, 'GET', '/audit');
export const aibom = (baseUrl) => call(baseUrl, 'GET', '/aibom');
export const createTicket = (baseUrl, payload) => call(baseUrl, 'POST', '/tickets', payload);

/**
 * What the run records about the target it attacked.
 *
 * NOTE WHAT IS ABSENT: any claim about which guardrails are enabled. The target would happily tell
 * us, and believing it would turn this harness back into attestation — "the config says the
 * allowlist is on" is precisely the evidence B20 and the control record both refuse. Guardrail
 * state is inferred from what the target DID, in the observations, and nowhere else.
 */
export async function describeTarget(baseUrl) {
  const origin = assertLoopback(baseUrl);
  const [bom, log] = await Promise.all([aibom(origin), audit(origin)]);

  const component = bom.body?.components?.[0] ?? bom.body?.metadata?.component ?? {};
  return {
    base_url: origin,
    model: {
      name: component.name ?? 'unknown',
      version: component.version ?? 'unknown',
      // "Pinned" means the target reports a fixed model rather than a floating alias. Recorded
      // because an unpinned model makes every result unreproducible.
      pinned: Boolean(component.version) && component.version !== 'latest',
    },
    audit_chain: {
      recording: Boolean(log.body?.recording),
      intact: log.body?.verification?.intact ?? null,
      length_at_start: log.body?.verification?.length ?? null,
    },
  };
}

/** Is the target up and answering? Used to fail with a useful message instead of a fetch error. */
export async function reachable(baseUrl) {
  try {
    const res = await audit(baseUrl);
    return res.status < 500;
  } catch {
    return false;
  }
}
