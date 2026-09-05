/**
 * Scytale push adapter — the load-bearing architectural decision in this repo.
 *
 * ADR-0001 in full: as of 2026-08-21 Scytale publishes NO API reference. docs.scytale.ai,
 * developer.scytale.ai, api.scytale.ai and help.scytale.ai do not resolve. The only confirmed
 * programmatic surface is the Custom Integrations feature, which is inbound-only — the vendor's
 * own words are "sending data from your tools directly to Scytale's API ... script your own
 * automations to gather and push data in the required format", with the required JSON structure
 * shown in the UI at integration-creation time. A pricing-table line item reading "Open API
 * integration suite" is the sole hint that a read path exists; it is undocumented and its tier
 * gating is unknown.
 *
 * Consequence: Scytale is an evidence SINK. It cannot be the system of record, because a system
 * of record you cannot read from is a system of record you do not own. This repo is the system
 * of record; Scytale is a rendering and auditor-workflow layer fed by push.
 *
 * That posture is also the lock-in answer. Everything of value — control definitions, assertion
 * history, variance timestamps, OSCAL packages — lives here. Replacing Scytale becomes a
 * rewrite of this one file rather than a program.
 *
 * TODO-ON-DAY-1 (tracked, not hidden): the field names below are a PLACEHOLDER contract. The real
 * contract is displayed in the Scytale UI when a Custom Integration is created. Run
 * `node src/cli.mjs push --dry-run` and reconcile against that screen before first live push.
 * This adapter deliberately refuses to send until the contract is confirmed — see CONTRACT_CONFIRMED.
 */

const CONTRACT_CONFIRMED = false; // flip to true only after reconciling against the Scytale UI

export function toScytalePayload(assertion, control) {
  return {
    integration_key: control.control_id,
    collected_at: assertion.as_of,
    status: assertion.failing_count === 0 ? 'pass' : 'fail',
    // Population figures, not a sample. If Scytale's contract only accepts a boolean, we still
    // send these so the numbers exist on their side for the auditor's benefit.
    population_total: assertion.total,
    passing_count: assertion.passing_count,
    failing_count: assertion.failing_count,
    failing_subjects: assertion.failing.map((f) => ({
      id: f.subject_id,
      reason: f.reason,
      failing_since: f.first_observed,
      exception: f.exception_ref,
    })),
    evidence_reference: {
      system_of_record: 'github.com/RootCawsLLC/grc-program',
      query: assertion.query_ref,
      population_definition: assertion.population_definition,
      coverage_basis: assertion.coverage_basis,
    },
  };
}

export async function push({ assertions, controls, baseUrl, token, dryRun = true, fetchImpl = globalThis.fetch }) {
  const byId = new Map(controls.map((c) => [c.control_id, c]));
  const payloads = assertions.map((a) => toScytalePayload(a, byId.get(a.control_id)));

  if (dryRun) {
    return { pushed: 0, dryRun: true, payloads };
  }
  if (!CONTRACT_CONFIRMED) {
    throw new Error(
      'Refusing to push: the Scytale Custom Integration JSON contract has not been confirmed against the UI. ' +
      'Sending a guessed schema produces silently wrong evidence in the auditor-facing system, which is worse ' +
      'than no evidence. Confirm the contract, update toScytalePayload, set CONTRACT_CONFIRMED = true.'
    );
  }
  if (!baseUrl || !token) throw new Error('push requires baseUrl and token');

  const results = [];
  for (const body of payloads) {
    const res = await fetchImpl(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    results.push({ control_id: body.integration_key, ok: res.ok, status: res.status });
  }
  return { pushed: results.filter((r) => r.ok).length, dryRun: false, results };
}
