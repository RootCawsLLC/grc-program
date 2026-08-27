# ADR-0005 — Self-dogfooding: the GRC program runs on the organization's own product

**Status:** proposed · **Date:** 2026-08-21 · **Needs:** product agreement on a self-dogfooding tenant

## Context

The organization's product discovers SaaS applications, maps identities and permissions across roughly 260
integrations, detects SaaS-to-SaaS OAuth connections and shadow AI, and continuously monitors
configuration state — mapping findings to SOC 2, ISO 27001, NIST and other frameworks.

That is, substantially, an evidence-collection pipeline for the SaaS half of a GRC program.
The organization already built it. The GRC program is currently not using it.

Meanwhile the published subprocessor register lists five entities, and the vendor-management
function overlaps a separate ProcessUnity surface.

## Decision

Point the organization at its own tenant and treat the product knowledge graph as a **collector** —
`mechanism: product-graph` in the control record — sitting alongside the AWS, IdP and GitHub
collectors, subject to the same assertion schema and the same guardrails.

Three controls take it first, chosen because the product's strength maps directly onto them:

- `ctl.vendor.procurement.subprocessor-register` — observed OAuth grants and SaaS-to-SaaS
  connections give the subprocessor denominator from what is actually connected, rather than from
  a spreadsheet someone maintains.
- `ctl.ai.inference.model-inventory` — shadow AI discovery gives the model and endpoint inventory.
- SaaS configuration drift controls generally, once the first two are proven.

**Explicit boundary, per ADR-0004:** the organization supplies observed state. Efficacy conclusions and
framework mapping decisions stay in this repo, under human authorship. We use the product's
collection, not the product's judgement — and we would tell a customer to do the same.

## Consequences

**Good.** Collection capability that already exists and costs nothing incremental. A reference
story with unusual weight — "our SOC 2 evidence is collected by our own product" is a claim
almost no security vendor can make, and it converts the GRC function from a cost centre into
product proof. It also makes the GRC lead design partner zero: every gap found while
instrumenting the organization's own controls is a real customer-workflow gap found before a customer finds it.

**Bad.** Circularity to be honest about with the auditor. If the organization's product is the collection
mechanism for the organization's controls, a defect in the product is a defect in the evidence. The
mitigation is that the highest-consequence controls — cloud IAM, CI/CD, tenant isolation — are
collected from primary APIs independently of the product, and the product-graph collector is
reconciled against those where they overlap. Say this to the auditor before they ask.

**Open.** Requires product and security agreement on a dedicated internal tenant and on how
findings from it are triaged. Not unilaterally decidable by GRC.
