# ADR-0004 — Agents may run probes; they may not conclude a control works

**Status:** accepted · **Date:** 2026-08-21

## Context

This program is one person plus agents. That ratio only works if agents do real work, which
creates pressure to let them do the one thing they must not: judge whether a control is effective.

Control efficacy is a relationship between control state, threat behaviour, asset value and
compensating controls. It is highly context-sensitive, and the labelled training data that would
let a model learn it does not exist. A model asked whether a control is effective will produce a
fluent, confident, unfalsifiable answer — which is the most dangerous possible output, because it
is indistinguishable in form from a correct one and it flows directly into an SSP, a trust-center
claim and eventually a customer contract.

There is a particular irony to get right here: Reco sells AI-driven security analytics. The same
skepticism applies to our own product when it is pointed at our own program. Dogfooding
(ADR-0005) means using Reco to *collect state*, not to *conclude efficacy*.

## Decision

Three guardrails, enforced in code and in the PR template rather than in a document.

1. **Derivation level on every output.** `measured`, `derived`, `calibrated-estimate`, `assumed`.
   Unlabelled numbers are rejected. Guard G9 enforces this on scenario parameters.
2. **A pull request is the only path to normative.** No agent writes to `controls/`, `policies/`
   or any auditor-facing surface. Agents open PRs; a human merges; the merge is the control.
3. **No agent evaluates control efficacy.** An agent may execute a probe and record what happened.
   It may not conclude the control works. Efficacy parameters are set by a named human and carry
   a confidence tier.

The general form: **the LLM is the interface to the analysis, not the analyst.** Agents are
credible for loss-magnitude forecasting over abundant public loss data, and for natural-language
reporting over completed analyses. Not for this.

## Consequences

Slower than letting an agent fill in efficacy parameters, and that slowness is the product.

It also draws the line the ISO 42001 audit will look for. An AIMS that governs the organisation's
own use of AI in its assurance function — with documented refusals, not just documented
permissions — is a stronger artifact than a policy asserting responsible use. We are the test case
for our own AI governance claims.
