# ADR-0001 — Scytale is an evidence sink, not the system of record

**Status:** accepted · **Date:** 2026-08-21 · **Supersedes:** none

## Context

Reco runs Scytale as its compliance platform. The natural default — and what most one-person GRC
programs do — is to make the platform the system of record and work inside it.

As of 2026-08-21, Scytale publishes **no API reference**. `docs.scytale.ai`,
`developer.scytale.ai`, `api.scytale.ai` and `help.scytale.ai` do not resolve. There is no
developer portal, no OpenAPI document, no published object model, no documented webhooks, and no
published rate limits.

The one confirmed programmatic surface is the **Custom Integrations** feature, and it is
inbound-only. Scytale's own description: *"you'll be sending data from your tools directly to
Scytale's API… If you've got engineering capacity in-house, you can quickly script your own
automations to gather and push data in the required format."* The required JSON structure is
displayed in the UI when an integration is created. There is no described read path.

A single line in the pricing feature matrix reads "Open API integration suite." Its tier gating
could not be determined — the tier checkmarks render as images. That line is the only evidence a
read API exists at all, and it is not evidence enough to architect against.

Corroborating signal, from an audit firm that sells audits rather than software:
*"The honest assessment: the product is thinner than the service… If you want to hand compliance
work to a vendor and receive outputs rather than operate a platform, Scytale fits that model.
If you want control, it doesn't."*

## Decision

This repository is the system of record. Scytale is a rendering and auditor-workflow layer, fed
by push. All control definitions, assertion history, variance timestamps, exceptions, scenarios
and OSCAL packages originate here and are pushed outward.

`src/push/scytale.mjs` **refuses to send** until the Custom Integration JSON contract has been
reconciled against the UI and `CONTRACT_CONFIRMED` is flipped. A guessed schema produces silently
wrong evidence in the auditor-facing system, which is materially worse than no evidence at all.

## Consequences

**Good.** A system of record you cannot read from is a system of record you do not own. Keeping
it here means the evidence survives a platform change: replacing Scytale becomes a rewrite of one
adapter file rather than a program. It also neutralises the concentration risk in a single
documented account of Scytale suspending a customer's platform access mid-contract without
explanation — if that happened here, collection would continue uninterrupted and only the
auditor-facing surface would go dark.

**Bad.** Two surfaces to keep in sync, and a reconciliation job that would not exist if the
platform had a read API. Accepted deliberately.

**Revisit if** Scytale publishes an API reference with read coverage of controls, evidence,
policies and personnel. Three questions to put to them in writing, and the answers change this ADR:

1. Which objects are readable via GET, under what auth, at what rate limit, on which tier, and are there webhooks on control-state change?
2. What does bulk evidence export produce — format, completeness, and does collection metadata survive?
3. Will the order form carry a no-unilateral-suspension clause and numeric AI-agent quotas rather than "Limited"?
