# reco-grc — working agreement

This repository is the **system of record** for Reco's control inventory, evidence and risk layer.
Scytale, the trust center, every framework baseline and every OSCAL package are projections of what
is here. Read `PROPOSAL.md` for why, and `docs/adr/` for the decisions.

You are supporting a staff-level GRC engineer who builds these systems. Assume fluency in SOC 2,
ISO 27001/42001, NIST CSF and 800-53, FedRAMP, GDPR, FAIR and OSCAL. **Do not explain them.**
Default to schemas, queries and code over prose.

---

## The three hard guardrails

**1. Never conclude that a control works.** You may run a probe and record what happened. You may
not judge efficacy. Control efficacy is a relationship between control state, threat behaviour,
asset value and compensating controls; it is highly context-sensitive and the training data to
learn it does not exist. A fluent, confident answer here is the most dangerous possible output,
because it is indistinguishable in form from a correct one and it flows into an SSP, a trust-center
claim and eventually a customer contract. Efficacy parameters are set by a named human with a
confidence tier. See `docs/adr/0004-agents-do-not-evaluate-efficacy.md`.

**2. A pull request is the only path to normative.** Do not write directly to `controls/`,
`policies/`, `exceptions/` or any auditor-facing artifact on a shared branch. Open a PR. A human
merges. The merge is the control.

**3. Label every number with its derivation.** `measured`, `derived`, `calibrated-estimate` or
`assumed`. An unlabelled number is rejected. A range with no provenance and a range with six
sourced parameters must not look equally authoritative.

---

## Standing positions — apply as defaults

- **Controls are the substrate.** Governance, risk, compliance and policy are lenses over it. A risk
  register is an inventory of control gaps. An incident is a control failure that produced harm. A
  policy is a written expectation about a control. Every framework requirement, scenario, policy
  paragraph and piece of evidence is a foreign key to a `control_id`. Nothing else is first-class.
- **Split controls by layer, not by category.** The test: different owners, costs, threat models or
  failure modes? Then different controls. Platform IAM, enterprise SSO, in-product authz and
  customer SSO are four controls, not one "Access Control".
- **Do not over-split.** Same owner, same cost, same failure mode, same evidence? One control with
  two framework mappings.
- **Policy last.** Build the control → instrument it → observe it holding → then generate the
  policy from the control record. Guard G2 fails the build on a policy for a non-operating control.
- **Populations, not samples.** Every control test returns `total`, a fully enumerated `failing[]`,
  `coverage_basis` and `query_ref`. Never a screenshot, never a sampled *n*.
- **Time-index everything.** If the landing layer overwrites, the pipeline is a dashboard, not an
  instrument, and Variance Duration is unreachable.
- **Ordinal values never enter arithmetic.** A maturity 3 is not three times a 1. `src/health.mjs`
  emits a classification, not a score, deliberately.
- **Usefully precise beats precise.** $10M–$500M means research was skipped. $748K–$752K is false
  precision.

## Vocabulary — use it exactly

requirement ≠ control ≠ control objective ≠ control activity. risk ≠ threat ≠ issue ≠ finding.
Susceptibility (not "Vulnerability") · Resistance Strength (not "Control Strength", deprecated) ·
Loss Magnitude (not "Impact") · frequency, not "probability", for annualised rates that can exceed
100%. Evidence **populations**, not samples. **Active testing** (exercise the control), not
attestation (check it exists).

---

## Licensing — enforced by CI, not by good intentions

**No framework text in this repository, ever.** Identifiers only. SCF is CC BY-ND 4.0 and its terms
explicitly prohibit using AI to generate derivative content from SCF — which is precisely what you
would be doing. `.github/workflows/ci.yml` greps for `description:`, `requirement_text:` and
`control_text:` under `controls/` and `reference/` and fails the build. Do not work around it.
See `docs/adr/0003-no-framework-text.md`.

FAIR-CAM and FAIR-MAM are CC BY-NC-ND 4.0. Implement and cite; never redistribute or remix.

---

## Working rules

- **Run `npm run validate` after touching anything in `controls/`, `scenarios/` or `exceptions/`.**
  A PostToolUse hook does this automatically; do not disable it.
- **Never patch a test to make it pass.** Fix the thing it caught. `tests/faircam.test.mjs` contains
  a worked example of doing this correctly — a published figure disagreed with our arithmetic, and
  the resolution was to document the divergence in a test, not to change the assertion.
- **Never stub to green.** An empty dbt staging model returning no rows makes `dbt run` succeed
  while proving nothing. That is worse than a missing file. If something is not built, say so.
- **Placeholders are declared, not silent.** `cost.opex_annual: 0` with a `PLACEHOLDER` basis and
  `derivation_level: assumed` are deliberate. Do not fill them with plausible numbers.
- **Pin every third-party GitHub Action to a full commit SHA.** See
  `controls/ctl.appsec.ci-cd.branch-protection.yaml` for why (GHSA-69fq-xp46-6x23).
- Do not commit anything to `intake/source/`. Audit reports are NDA-gated and watermarked.

## Commands

```
npm run baseline   intake + health + gap, in reading order. Start here.
npm run validate   schema + the nine guards
npm run intake     validate extracted audit findings, reconcile against the inventory
npm run health     control health as a classification
npm run gap        four-direction gap assessment
npm run oscal      OSCAL assessment-results, deterministic UUIDs
npm test           75 tests
```

## Day one

If Susan is in her first week, `docs/SOP-DAY-ONE.md` is the operative document — a checkbox
procedure. Work from its unticked boxes rather than from `docs/DAY-ONE.md`, which is the narrative
behind it.

## Open questions that change the work

`docs/DISCOVERY.md` holds 17. Six of them block phasing. If you are asked to do something that
depends on one of those answers, say which one and ask rather than assuming.
