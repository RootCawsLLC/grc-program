# Verification record

Everything asserted in `PROPOSAL.md` and in the control inventory, checked on **21 August 2026**,
separated into confirmed, corrected, and unverifiable.

This file exists because a proposal that goes to a CTO should be auditable in the same way the
program it proposes is. Two claims in an earlier draft were wrong. They are recorded here rather
than quietly overwritten.

---

## Corrected

**1. Trivy supply-chain advisory identifier — was wrong.**

| | |
|---|---|
| Asserted in draft | `GHSA-cxm3-wv7p-598c`, at `github.com/aquasecurity/trivy-action/security/advisories/...` |
| Actual | **`GHSA-69fq-xp46-6x23`** / **`CVE-2026-33634`**, at [github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23) — the advisory is on the `trivy` repo, not `trivy-action` |
| Corrected in | `PROPOSAL.md`, `.github/workflows/ci.yml`, `controls/ctl.appsec.ci-cd.branch-protection.yaml`, `scenarios/scn.supply-chain.ci-action-compromise.yaml`, `src/collectors/github.mjs` |

The underlying incident is confirmed and the substance was right. On **19 March 2026** an attacker
used compromised credentials to publish a malicious Trivy v0.69.4 release, force-push **76 of 77
version tags** in `aquasecurity/trivy-action` to credential-stealing commits, and replace **all 7
tags** in `aquasecurity/setup-trivy`. The payload ran before the legitimate scan, dumped
`Runner.Worker` process memory via `/proc/<pid>/mem`, and swept 50+ filesystem paths for SSH keys,
AWS/GCP/Azure credentials, Kubernetes tokens, Docker configs, `.env` files and database
credentials. Because the tags were rewritten rather than newly released, there was no visible
change on GitHub to alert consumers.

*Minor discrepancy worth knowing:* sources vary between "75" and "76" tags force-pushed. The
advisory summary says 76 of 77; some vendor write-ups say 75 existing tags. The argument does not
turn on the number.

Corroborating coverage: [Microsoft Security Blog](https://www.microsoft.com/en-us/security/blog/2026/03/24/detecting-investigating-defending-against-trivy-supply-chain-compromise/) ·
[CrowdStrike](https://www.crowdstrike.com/en-us/blog/from-scanner-to-stealer-inside-the-trivy-action-supply-chain-compromise/) ·
[Socket](https://socket.dev/blog/trivy-under-attack-again-github-actions-compromise)

**2. EU AI Act high-risk applicability date — the draft was silent, and silence would have been wrong.**

An earlier draft treated the Annex III high-risk obligations as live. They are not.

**Regulation (EU) 2026/1744 — the Digital Omnibus on AI — was published in the Official Journal on
24 July 2026 and entered into force on 27 July 2026**, six days before the original 2 August 2026
deadline. It defers:

- Annex III standalone high-risk obligations → **2 December 2027**
- Annex I embedded-product high-risk obligations → **2 August 2028**

It did **not** defer the **Article 50 transparency obligations**, which applied from **2 August
2026** as originally scheduled — chatbot disclosure, deepfake labelling, emotion-recognition
notices, synthetic-content marking.

This is now enacted law, not a pending proposal. Reflected in `PROPOSAL.md` (days 31–60) and in an
`applicability_note` on both AI controls. A new `applicability_note` field was added to
`schemas/control.schema.json` to carry this properly — the schema rejected it first, which is the
guard working.

Sources: [Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/) ·
[Jones Walker](https://www.joneswalker.com/en/insights/blogs/ai-law-blog/yes-august-2-still-matters-the-eu-approved-a-high-risk-ai-delay-but-most-trans.html) ·
[CSA research note](https://labs.cloudsecurityalliance.org/research/csa-research-note-eu-ai-act-high-risk-deadline-omnibus-20260/)

**3. SCF commercial licence pricing — softened.**

The CC BY-ND 4.0 licence and the AI-derivatives clause are **confirmed verbatim** (below). The
"$25,000/year Tier 1" figure appears in secondary sources and could **not** be confirmed from SCF
directly. It is now labelled as unconfirmed in `docs/adr/0003-no-framework-text.md` and removed
from `PROPOSAL.md`. Verify before putting it in a budget.

---

## Confirmed

**SCF licence and the AI clause** — confirmed. SCF is CC BY-ND 4.0. Its terms state that the
prohibition on derivative works *"includes utilizing Artificial Intelligence (AI) (or similar
technologies) to leverage SCF content to generate policies, standards, procedures, metrics, risks,
threats or other derivative content,"* and that a commercial licence is required to offer
derivative SCF content. This is the entire basis of ADR-0003.
[Terms](https://securecontrolsframework.com/terms-and-conditions) ·
[Commercial licence](https://securecontrolsframework.com/commercial-license)

**Reco on Amazon Bedrock** — confirmed, and stronger than the draft claimed. The
[AWS ML blog post](https://aws.amazon.com/blogs/machine-learning/how-reco-transforms-security-alerts-using-amazon-bedrock/)
of **23 March 2026** is co-authored by **Tal Shapira (Co-founder & CTO)** and Tamir Friedman of
Reco. It states the Alert Story Generator runs on **Anthropic Claude Sonnet in Amazon Bedrock**,
on EKS with RDS for PostgreSQL, CloudFront and WAF, using Bedrock prompt caching. Friedman's
biography describes him leading "Reco's generative-AI solutions, built on Amazon Bedrock and
Anthropic Claude, **including multiple production AI agents**."

Two things follow. The AI agent control work is not speculative — production agents are processing
customer security alerts today. And the subprocessor register names AWS but neither Bedrock nor
Anthropic, which makes the model-provider disclosure question concrete rather than theoretical.

**RFC 4122 v5 UUID derivation** — confirmed by execution, not by citation.
`tests/uuid5.test.mjs` asserts the canonical DNS-namespace vector
(`uuid5(6ba7b810-9dad-11d1-80b4-00c04fd430c8, "python.org") = 886313e1-3b8a-5372-9b90-0c9aee199e5d`)
and passes. All 34 tests pass; `npm run validate` returns 0 errors, 0 warnings.

**FAIR-CAM operational efficacy** — verified by test, with a documented divergence. The exact
arithmetic for the standard worked example (intended 0.90, variant 0.60, VF 1.0, VD 30 days) is
**0.87534**, which rounds to 0.875. A commonly circulated props example shows **0.876**, which is
reproducible only by rounding reliability to two decimals (0.92) *before* multiplying. We do not
round intermediates; over a few hundred controls that drift is indistinguishable from real control
movement. Both behaviours are asserted in `tests/faircam.test.mjs` so anyone diffing against the
published figure finds the explanation immediately.

**Trust center contents, certifications, subprocessors, RTO/RPO, SafeBase-by-Drata footer** —
confirmed by direct fetch of [trust.reco.ai](https://trust.reco.ai/).

**Scytale's absent API** — confirmed by negative result. `docs.scytale.ai`,
`developer.scytale.ai`, `api.scytale.ai` and `help.scytale.ai` do not resolve. The
["Custom Integrations"](https://scytale.ai/resources/custom-integrations-update/) push language and
the "Open API integration suite" pricing line are confirmed present.

---

## Unverifiable from outside — open items, not negative findings

These could not be confirmed. That is different from being false, and the distinction is preserved
deliberately in `PROPOSAL.md` and `docs/DISCOVERY.md`.

| Claim | Status |
|---|---|
| SOC 2 observation window runs 1 Dec – 30 Nov | **Inferred** from the published bridge letter (1 Dec 2024 – 30 Nov 2025). The report period is behind the NDA gate. **This drives the entire phasing — confirm first.** |
| SOC 2 audit firm | Not named on any public surface |
| ISO 27001 / 42001 certification body, certificate numbers, expiry dates | Not published; certificates are NDA-gated |
| Whether the ISO certificates appear in an accreditation registry | IAF CertSearch is JS-rendered and account-gated; UKAS and ANAB directories returned nothing for "Recolabs"/"Reco". **Could not query — not a finding of non-accreditation.** |
| CISO seat currently vacant | **Inferred.** The June 2024 CISO announcement is live; that person is no longer on the leadership page and holds a role elsewhere; the June 2026 seven-leader expansion named no CISO. No successor announced. |
| Reco headcount (~141–170) | Aggregator sources only (PitchBook, Unify). No company-published figure. Not used in the proposal. |
| Whether Scytale has any read API at all | One undocumented pricing line. Genuinely unknown. |
| Scytale API tier gating | Pricing-table checkmarks render as images; three extraction methods failed |
| Scytale first-party endpoint agent | Absent from the site, from 710 G2 reviews, and from every review blog. Probably absent; not provably so. |
| Reported mid-contract platform suspension by Scytale | Single PeerSpot review, reviewer is competitor-adjacent, n=1. Referenced in ADR-0001 as a contractual precaution, not asserted as fact. |
| Framework control identifiers in `crosswalk` blocks | Asserted at clause level from working knowledge. **Must be verified against the licensed standard text before appearing in any auditor-facing artifact.** Flagged in the control files themselves. |
| ISO 42001 Annex A mappings | Asserted at **objective level only** (A.4, A.6, A.9, A.10). Sub-control numbering not asserted. |
| GitHub Action SHA pins in the workflows | **Written from recall and NOT verified.** Both workflow files carry an explicit warning to verify before first run. A wrong-but-plausible SHA is the exact failure mode the practice exists to prevent. |
| FedRAMP RFC-0024 machine-readable deadlines | Referenced directionally in `PROPOSAL.md` without dates. Not independently confirmed in this pass — confirm before quoting any date. |

---

## Deliberately empty, not missing

Two categories of blank in this repo are decisions, not omissions:

- **`cost.opex_annual` is 0 with a `PLACEHOLDER` basis on every control.** Guessing a cost produces
  a ROSI ranking that looks authoritative and is arbitrary. Guard G6 flags it rather than computing
  a meaningless infinity.
- **Every scenario parameter is `derivation_level: assumed`, `confidence_tier: 1`.** That is the
  accurate state of an estimate before calibration. Publishing an `assumed` range with a
  confident-looking min/most-likely/max is the exact failure mode FAIR exists to prevent. See
  `scenarios/_CALIBRATION-STATUS.md`.

Both get filled from Reco's own data, by a named human, in weeks 2 and 6.
