# Automating Reco's GRC program

**A 30/60/90 build plan for a one-person function**
Susan Shepard · 21 August 2026

---

## The shape of the problem

Reco is already certified. SOC 2 Type 2, ISO/IEC 27001:2022 with a published Statement of Applicability, ISO/IEC 42001:2023, CSA STAR Level 1, GDPR, DPDPA and EU AI Act materials are live on the trust center today. The job is not to get Reco certified.

The job is that the program behind those certificates is currently sized for a team, and it is about to be run by one person — across three legal jurisdictions, two audit regimes on separate clocks, an ISO 42001 AI management system, a growing enterprise customer base that sends security questionnaires, and a company that added roughly seventy people and a US office in the last year.

There is exactly one way that works. Every control becomes a query against a system that already knows the answer, exceptions route to the team that owns them, and the only thing a human touches is the delta. The measure of success is not how many controls exist or what the pass rate is. It is **human-touch minutes per control per quarter**, and it has to fall by an order of magnitude.

The secondary claim in this proposal is that doing it this way produces something Reco can sell. A compliance program whose evidence is collected continuously and whose attestations are generated from measured state — rather than from static PDFs — is exactly the thing Reco's product promises its customers. Running it internally makes the GRC function product proof rather than overhead.

---

## Where Reco actually is

Everything below is from public sources. Items marked **inferred** need confirmation in week one; `docs/DISCOVERY.md` tracks all seventeen open questions with their consequences.

**Confirmed, from the trust center and company sources**

| | |
|---|---|
| Certifications | SOC 2 Type 2 · ISO/IEC 27001:2022 + SoA · ISO/IEC 42001:2023 · CSA STAR Level 1 · GDPR · DPDPA · EU AI Act materials |
| Compliance platform | Scytale |
| Trust center | SafeBase — a Drata product, i.e. a Scytale competitor |
| TPRM | ProcessUnity, listed separately |
| Security ratings | SecurityScorecard (A), BitSight, Black Kite |
| Subprocessors published | ClickHouse, Amplitude, Segment, Datadog, AWS — five entities |
| Infrastructure | AWS (EKS, RDS for PostgreSQL, CloudFront, WAF). **Anthropic Claude Sonnet via Amazon Bedrock**, plus "multiple production AI agents" — stated in an AWS ML blog post of 23 March 2026 co-authored by Reco's CTO |
| Published recovery objectives | RTO 5 days · RPO 22 hours |
| Jurisdictions | US (RecoLabs, Inc., FL registration; new Texas office) · Israel (Tel Aviv) · **Moldova (Chișinău)** |
| Funding | $85M total; $30M Series B, February 2026, led by Zeev Ventures, with Workday Ventures, TIAA Ventures, S Ventures and Quadrille Capital joining |
| Latest audit artifact | SOC 2 bridge letter covering 1 Dec 2024 – 30 Nov 2025 |

**Inferred, needs confirmation**

- **The SOC 2 observation window runs 1 December – 30 November.** Bridge letters run forward from the report period end, so the underlying Type 2 period most likely ended 30 November. The report period itself is behind the NDA gate. This inference drives the entire phasing below; if it is wrong, the phasing moves with it.
- **The CISO seat is vacant.** Reco announced its first CISO in June 2024. That person is no longer on the leadership page and now holds a security leadership role at another company. The June 2026 executive-expansion announcement named seven new leaders and did not name a CISO. No successor has been announced publicly.
- **No FedRAMP, GovRAMP, HIPAA or PCI claim exists.** Absent from every public surface searched, including the FedRAMP Marketplace at any status.

**Not verifiable from outside** — the audit firm, the ISO certification body, certificate numbers and expiry dates, and whether the ISO certificates appear in an accreditation registry. IAF CertSearch is account-gated and returned nothing queryable. This is an **open item, not a negative finding**: it means the certificates could not be verified externally, not that they are unaccredited. Week-one ask is the certificate PDFs plus the CB name, then independent verification in the CB's own registry.

---

## Three findings that shape everything below

### 1. Scytale is an evidence sink. It cannot be the system of record.

Scytale publishes no API reference. `docs.scytale.ai`, `developer.scytale.ai`, `api.scytale.ai` and `help.scytale.ai` do not resolve. There is no developer portal, no OpenAPI document, no published object model, no documented webhooks.

The one confirmed programmatic surface is **Custom Integrations**, and it is inbound only. Scytale's own words: *"you'll be sending data from your tools directly to Scytale's API… you can quickly script your own automations to gather and push data in the required format."* The required JSON structure is shown in the UI at integration-creation time. No read path is described anywhere.

A single line in the pricing feature matrix reads "Open API integration suite." Its tier gating could not be determined — the checkmarks render as images. That line is the only evidence a read API exists, and it is not enough to architect against.

An independent audit firm — one that sells audits, not software — assesses the platform this way: *"The product is thinner than the service… If you want to hand compliance work to a vendor and receive outputs rather than operate a platform, Scytale fits that model. If you want control, it doesn't."* G2's own computed dislike themes corroborate it: 43 reviews citing integration difficulty, 32 citing limited integrations, 21 citing limited configuration options for evidence collection.

**Consequence.** A system of record you cannot read from is a system of record you do not own. The control inventory and the evidence warehouse live in Git and in a time-indexed store that Reco controls. Scytale becomes a rendering and auditor-workflow layer, fed by push. Replacing it later becomes a rewrite of one adapter file rather than a program. This is ADR-0001, and `src/push/scytale.mjs` refuses to send until the JSON contract is confirmed against the UI — a guessed schema puts silently wrong evidence into the auditor-facing system, which is worse than no evidence.

### 2. The observation window closes at roughly day 90. Do not re-cut controls inside it.

If the window runs to 30 November, a start around 1 September puts day 90 within days of the period closing. That is the worst possible moment to restructure a control inventory.

The failure mode is specific. Split one control into four mid-window and the auditor tests something that existed for part of the period and not the rest. Evidence for the old shape stops; evidence for the new shape has no history. The likely outcomes are a scope qualification, or a large volume of unplanned reconstruction work — for a company whose customers read that report before signing.

**Consequence.** Build in parallel; change nothing normative until the window closes. Every control record starts at `status: building` or `planned`. Assertions accumulate history alongside the live program. At window close, reconcile: for each control the auditor tested, show the pipeline's own measurement across the same period. Where they agree, that is the cutover argument. Where they disagree, that is worth more than the cutover. Cut over on day 91, into the fresh window, so the new shapes have full-period evidence from day one of the period they will be tested against. This is ADR-0002.

The ISO 27001 and ISO 42001 surveillance cycles sit on their own certificate dates and are **not** governed by this freeze. Confirming those dates is a week-one task, because they may permit earlier movement on exactly the AI governance work that is most differentiated.

### 3. Reco already built most of the collection layer. It is called Reco.

Reco's product discovers SaaS applications, maps identities and permissions across roughly 260 integrations, detects SaaS-to-SaaS OAuth connections and shadow AI, and continuously monitors configuration state against framework mappings.

That is, substantially, an evidence pipeline for the SaaS half of a GRC program. It exists, it is maintained by a product team, and the GRC function is not using it.

**Consequence.** Point Reco at Reco. The knowledge graph becomes a collector — `mechanism: reco-graph` — sitting alongside the AWS, IdP and GitHub collectors under the same assertion schema and the same guardrails. Three controls take it first: the subprocessor register, the AI model inventory, and SaaS configuration drift.

The boundary matters and is stated explicitly in ADR-0005: **Reco supplies observed state; efficacy conclusions and mapping decisions stay under human authorship.** We use the product's collection, not the product's judgement — which is precisely what we would tell a customer to do.

Two things fall out of this that are worth more than the engineering saved. First, "our SOC 2 evidence is collected by our own product" is a claim almost no security vendor can make, and it belongs in the sales motion. Second, every gap found while instrumenting Reco's own controls is a real customer-workflow gap found before a customer finds it — the GRC lead becomes design partner zero.

There is a circularity to be honest with the auditor about: if the product collects the evidence, a product defect is an evidence defect. The mitigation is that the highest-consequence controls — cloud IAM, CI/CD, tenant isolation — are collected from primary APIs independently, and the reco-graph collector is reconciled against them where they overlap. Say this before the auditor asks.

---

## The architecture

```
EXTRACT    AWS APIs · IdP · GitHub · HRIS · Reco knowledge graph · CSV inbox fallback
   │       full state, never samples; scheduled, never triggered
   ▼
LAND       time-indexed store — must answer "what was true on 14 March",
   │       not only "what is true now". If it overwrites, the risk layer is unreachable.
   ▼
TRANSFORM  dbt — one model per control_id
   │       models are the assertions · tests are the control tests · lineage is the audit trail
   ▼
ASSERT     the canonical assertion record: total, failing[] fully enumerated,
   │       coverage_basis, confidence_tier, query_ref
   │
   ├─► EXCEPTIONS  → the owning team's channel and tracker. Everything else self-attests.
   ├─► VARIANCE    → four timestamps → VF/VD → FAIR-CAM operational efficacy → ROSI
   ├─► ATTEST      → OSCAL assessment-results + POA&M, deterministic UUIDs
   └─► PUSH        → Scytale, for the auditor-facing surface
```

Three properties do the work.

**Populations, not samples.** Every control test returns `total`, a fully enumerated `failing[]`, `coverage_basis` and `query_ref`. A count derived from a reproducible query over the full population *is* a population statement — the auditor re-runs the query and gets the same answer. That is strictly stronger than a sample and strictly stronger than a screenshot. A certification claims full coverage; the auditor sampled a fraction of a percent. This closes that gap.

**Time-indexing is load-bearing.** Point-in-time state answers "are we compliant now." Time-indexed state answers "how long were we not," which is Variance Duration, which is the only thing that turns compliance data into risk data.

**Deterministic UUIDs.** RFC 4122 v5 over a committed namespace, keyed on the control ID. An unchanged warehouse re-exports OSCAL byte-identically, so the diff shows only real change. This is the direct answer to the strongest published criticism of OSCAL — that the format makes review impractical. It is tested in CI as a blocking gate.

---

## Days 1–30 — measure before changing anything

**Discovery closes.** All seventeen questions in `docs/DISCOVERY.md` answered, starting with the six that block phasing: the real SOC 2 period, the audit firm, the ISO certificate dates and body, who owns the ISMS and AIMS management review, whether Scytale has a read API, and the Custom Integration JSON contract.

**The ISMS/AIMS ownership question is raised in week one, not saved for a report.** ISO 27001 Clause 9.3 and ISO 42001 Clause 9.3 both require top-management review. If no one currently owns it following the CISO transition, that is a nonconformity waiting to be raised at the next surveillance audit, and it costs nothing to fix now and a great deal to fix in front of an auditor.

**Baseline the metric.** Human-touch minutes per control per quarter, measured on paper, before automating anything. Without a baseline, the automation cannot be shown to have worked, and the field's characteristic failure is automating the wrong thing and calling the speed an improvement.

**First control end to end.** `ctl.iam.cloud-platform.mfa` — AWS credential report to assertion record to OSCAL. Chosen because the denominator is unambiguous, it is one API call, it carries native timestamps that give real Variance Duration rather than an interpolation, and it has genuine scenario weight. One system, one control, one cycle, then compound.

**Control inventory, layer-split.** Roughly 40–60 controls, `status: building`. The discipline is splitting by layer rather than category: platform IAM, enterprise SSO, in-product authorization and customer SSO are four controls with four owners, four cost profiles and four threat models. Collapsing them into "Access Control" and scoring it a 3 destroys the ability to measure, price or remediate any of them — and it is the mechanism by which framework scores become unusable in quantification.

**Two findings written up.** The RTO/RPO reconciliation and the marketing claims inconsistency. Both are cheap, both are visible, and both belong to the new person's first month.

> **Day 30 deliverables** — discovery answered · one control in production end to end · layer-split inventory in Git with CI gates · ISMS/AIMS ownership resolved or escalated · touch-time baseline · RTO and claims findings written

### The two early findings, stated plainly

**The published RTO is five days.** For a security vendor selling to Fortune 500 enterprises and to a health system, a five-day recovery time objective is outside what enterprise procurement typically accepts, and it is plausibly inconsistent with availability terms already signed. Two separate things have to happen: confirm whether the figure is the measured capability or a conservative placeholder nobody revisited, and reconcile it against executed MSAs. If the real capability is materially better, republishing it is a same-week revenue-facing win that costs engineering nothing. If it is not, this is a genuine risk that belongs in the register with a quantified loss scenario attached — not in a remediation backlog.

**Four different integration counts are live simultaneously** — 270+, 260+, 235+ and 215+ appear across the site navigation, the about page, and press releases still published on the newsroom. For a company certified to ISO 42001 and publishing EU AI Act materials, a defensible-claims process is inside the management system's scope, and stale boilerplate in live releases is the kind of thing a transparency review flags. It is also a two-week fix with a visible owner.

---

## Days 31–60 — instrument the risk-weighted set, and build the AI governance layer

**Ten to fifteen controls producing assertions daily**, chosen in scenario-weight order rather than framework order. Cloud IAM, enterprise SSO, CI/CD branch protection and third-party action pinning, workforce training, and the subprocessor register.

**Two of those run on Reco.** The subprocessor register and the AI model inventory, via the reco-graph collector. This is where the dogfooding case gets made with evidence rather than with a pitch.

**The subprocessor reconciliation is a real deliverable, not a formality.** Three independent sources — SaaS spend from finance, observed OAuth grants and SaaS-to-SaaS connections from Reco's own product pointed at the Reco tenant, and the DPA repository — reconciled against a register that currently publishes five entities. GDPR Article 28 and Article 30 obligations attach to what is actually processing, not to what is listed. The register is expected to grow; that is the point.

**Model and endpoint inventory.** Every model endpoint invocable from production, discovered from egress telemetry and infrastructure-as-code rather than from a spreadsheet.

This one has more behind it than a documentation gap. In an AWS ML blog post of 23 March 2026, co-authored by Reco's own CTO, Reco states that its Alert Story Generator runs on **Anthropic Claude Sonnet via Amazon Bedrock**, and the author biography describes a team leading "Reco's generative-AI solutions, built on Amazon Bedrock and Anthropic Claude, **including multiple production AI agents**." The published subprocessor register names AWS and four others; it does not name Bedrock, Anthropic, or any model provider.

That is not a nitpick. It means the AI governance work below is not speculative — there are production AI agents processing customer security alerts today — and it means the model-provider disclosure question is live for ISO 42001 and for AI Act transparency, where disclosure is normally expected to be explicit rather than inherited under a cloud entry. Whether the AWS entry is legally sufficient is a real question with a real answer, and the inventory produces the facts to answer it instead of arguing about it.

**The EU AI Act role determination**, written as a defensible analysis rather than a marketing line. Provider, deployer, or both; which obligations actually attach; and on what date.

The dates moved recently and it matters. **Regulation (EU) 2026/1744 — the Digital Omnibus on AI — was published in the Official Journal on 24 July 2026 and entered into force on 27 July, six days before the original deadline.** It defers the Annex III standalone high-risk obligations from 2 August 2026 to **2 December 2027**, and Annex I embedded-product high-risk to 2 August 2028. It did **not** defer the Article 50 transparency obligations, which applied from 2 August 2026 as originally scheduled.

Two consequences. First, if any Reco system would classify as Annex III high-risk, there is now eighteen months of runway rather than a deadline that has already passed — which changes the sequencing but not the work. Second, the obligations that are live *right now* are the transparency ones, and those are the ones a customer or a supervisory authority can ask about today. Most vendors are currently overclaiming in the opposite direction — publishing AI Act readiness language keyed to a high-risk regime that has been deferred. An overclaim in a published AI Act statement is worse than silence. This determination stays under human authorship and is the first AI governance deliverable.

**Calibration workshop.** Ten scenarios are already scoped in taxonomy grammar in `scenarios/`, and every parameter currently carries `derivation_level: assumed` with a confidence tier of 1. That is the accurate state of an estimate before calibration — not a placeholder anyone forgot. The workshop moves them to `calibrated-estimate` or `measured`, with named sources.

**Variance layer live.** The four timestamps — started, detected, remediation started, remediation completed — decomposed into their FAIR-CAM segments. This is the piece almost nobody emits and it is the whole point: it means the pipeline that satisfies the auditor also produces the inputs to control reliability, which is an input to loss event frequency. Knowing mean time to remediate is 30 days is not actionable. Knowing that 26 of those 30 days were detection latency is, because it says "remediate faster" was the wrong instruction.

> **Day 60 deliverables** — 10–15 controls asserting daily · reco-graph collector in production · subprocessor register reconciled · model inventory complete · EU AI Act role determination · variance layer producing VF/VD · scenarios calibrated

---

## Days 61–90 — close the window clean, then prove the cutover

**Reconciliation pack.** For every control the auditor tested this period, the pipeline's own measurement across the same period, side by side. Agreement is the cutover argument. Disagreement is a finding, and a more valuable one.

**OSCAL package complete.** Component definitions, catalog and profile, assessment results, POA&M generated from `failing[]` with the four variance timestamps attached — which converts the POA&M from a compliance artifact into a risk artifact. Determinism gated in CI.

The profile is what makes the Statement of Applicability defensible: it records *why* each control is in or out, which is what an SoA is supposed to prove and usually does not. The SSP is generated, never hand-authored; a hand-edited SSP is treated as a bug.

**AI agent control assurance in production.** `ctl.ai.agent.tool-allowlist` and the probe set behind it. An agent allowlist that exists in configuration but has never been exercised does not pass — the control is proved by an executed attempt that is denied and recorded, with paired guarded and unguarded evidence runs.

This is the deliverable that changes the ISO 42001 surveillance conversation. Most certified organisations bring documentation to an AIMS audit. Bringing executed probe results against the organisation's own AI systems is a different class of artifact, and it is the same evidence that makes a customer-facing AI governance claim defensible instead of aspirational.

**Attestation generation.** Trust-center content and security questionnaire answers generated from measured control state. "Our Access Control Policy requires MFA" is what every vendor says. "Phishing-resistant MFA is enforced on 412 of 412 active human identities as of Tuesday, measured daily, with two break-glass accounts excluded under an exception expiring in March and covered by detection" is a different answer, and it is generated rather than written. Security review latency is deal latency; this is where the program pays for itself in a currency the CRO recognises.

**Policy generation, after the fact.** Only for controls that reached `status: operating`. Never before — a policy written for a control that does not exist is a documented expectation with nothing behind it, and in front of an auditor it is a liability rather than an asset. CI enforces this; guard G2 fails the build on a `policy_ref` set against a non-operating control.

**Cutover plan and the 12-month view.** Which controls move to the new shape on day 91 at the start of the fresh window, and what the next three quarters look like.

> **Day 90 deliverables** — reconciliation pack · complete OSCAL package with CI determinism gate · AI agent probes in production · generated attestation surface · policy generation for operating controls · cutover plan

---

## Risk quantification, and where it actually attaches

FAIR is not a parallel workstream here and it is not a slide. It is the ranking function, and it is fed by the same pipeline that satisfies the auditor.

```
assertion → four variance timestamps → VF, VD → reliability → operational efficacy
                                                                      ↓
                            scenario loss magnitude  →  ALE before / after
                                                                      ↓
                                       control cost  →  ROSI → the remediation queue order
```

That chain is the argument that gets an evidence pipeline funded from a budget other than compliance. It is also the only defensible way for one person to sequence work, because it is the only ranking that survives the question *"why this and not that."*

Three commitments about how the numbers are handled:

**Provenance travels with every number.** A range with no provenance and a range with six sourced parameters must not look equally authoritative on a slide. Every parameter carries its derivation level, source and confidence tier, and CI rejects any that does not.

**Ordinal values never enter arithmetic.** A framework maturity score of 3 is not three times a 1, and only a minority of framework subcategories are loss event controls at all — most affect decisions *about* controls. Where a framework score has to be used quantitatively, it gets interrogated first and the translation is published.

**Usefully precise beats precise.** A \$10M–\$500M range means the research was skipped. A \$748K–\$752K range is false precision. An estimate is usefully precise when more precision would not change the decision.

The reporting output is a loss exceedance curve and a ROSI-ranked backlog, not a heat map. Reco is private and has no 8-K obligation of its own — but its enterprise customers do, and their contractual notification clocks run through Reco as a processor. That is where loss magnitude modelling attaches commercially: sizing notification exposure across the customer base, and sizing cyber insurance against something other than a broker's benchmark.

---

## What I bring on day one

This is not a plan to start from a blank repository. Four working codebases already implement this exact pattern, and the scaffold accompanying this proposal is derived from them.

| Asset | What transfers |
|---|---|
| **cui-control-plane** | The core pattern end to end — YAML control records with house IDs, collectors, DuckDB/dbt warehouse, assertion records, OSCAL O1–O5 emission with deterministic v5 UUIDs, variance derivation. All eight OSCAL artifacts validate against NIST's `oscal-cli` as a blocking CI gate. Includes the documented refusal set: unresolved inputs fail rather than pass, findings are never rounded up, nothing is annualised from a fortnight without being labelled extrapolation. |
| **ksi-harness** | Collectors already written against AWS (Config, CloudTrail, IAM credential report, S3, security groups), GCP, GitHub (branch protection, Dependabot, workflows) and a generic IdP. Evidence bundling with RFC 3161 timestamping and an anchor log. Rego policy gates. 26 test files. |
| **proofplane** | AI agent control assurance — 12 house-ID controls with 12 falsifiable probes mapped 1:1, including indirect injection, tenant isolation, tool allowlist, approval replay and egress destination. Already crosswalked to EU AI Act, ISO 42001, ISO 27002, ISO 27701 and NIST AI RMF; already carrying MITRE ATLAS and OWASP ASI threat mappings; already emitting OSCAL assessment-results; already shipping an MCP server. **This is the closest thing to a drop-in that exists for an ISO 42001-certified AI vendor.** |
| **u-dont-grc-me** | Control-centric data model with a 10,000-trial FAIR Monte Carlo engine. |

The SCF licensing problem is already solved in that work. SCF is CC BY-ND 4.0, and its terms state that the prohibition on derivative works *"includes utilizing Artificial Intelligence (AI) (or similar technologies) to leverage SCF content to generate policies, standards, procedures, metrics, risks, threats or other derivative content"* — a commercial licence is required to produce or share derivative SCF content. These repos carry identifiers only, resolve SCF at runtime from a local release, and never vendor the text. ADR-0003 preserves that decision here and CI enforces it with a grep, because an agent that ingests framework text and emits a policy is precisely the activity that clause names.

---

## Tooling and cost

**Nothing new is purchased in the first 90 days.** Every component below is either already paid for, open source, or a seat licence.

| Layer | Choice | Note |
|---|---|---|
| Control inventory | Git, YAML, JSON Schema | Already owned |
| Extract | Node collectors + Reco knowledge graph | Reco is already paid for |
| Cloud posture | **Prowler** (Apache-2.0, ~14.6k stars, weekly releases) and **Cloud Custodian** (CNCF Incubating) | Deliberately **not** Steampipe. Steampipe v1.0 removed `check` and `mod`; the compliance mods are Powerpipe-only, the AWS mod's last release was December 2025, and AGPL plus a trademark policy makes hosting dashboards for customers legally expensive. |
| Transform | **dbt** | Non-negotiable if the lineage argument is wanted |
| Warehouse | DuckDB locally; whatever Reco already runs in production | Time-indexing is the only hard requirement |
| Policy-as-code | **OPA / Conftest** (CNCF Graduated) | Preventive gates in CI |
| OSCAL | **metaschema-framework/oscal-cli** v3.2.0 | Not `usnistgov/oscal-cli`, whose newest tag is still v1.0.3 from February 2024 |
| Crosswalk spine | SCF 2026.2, resolved at runtime | Never vendored. See ADR-0003 |
| Agents | **Claude Agent SDK / Claude Code** with skills; an MCP server over the control graph, read-only | Scytale publishes open-source GRC Claude skills — vendor-neutral framework knowledge packs. Worth evaluating before writing our own. |
| Code | **Cursor** | Seat licence |
| CI | GitHub Actions, every third-party action SHA-pinned | See below |

**On SHA-pinning.** In March 2026 an attacker force-pushed 76 of 77 tags in `aquasecurity/trivy-action` to malicious commits carrying an infostealer that harvested AWS, GCP and Azure credentials, SSH keys and kubeconfigs from CI runners. Tag immutability did not prevent it. An evidence pipeline is a higher-value target than a product build, because it holds read credentials to every system it collects from. The pipeline that measures `ctl.iam.cloud-platform.mfa` does not get to violate it — collection runs on OIDC, not on long-lived keys.

**Two consolidation questions worth raising, not resolving, in the first quarter.** Scytale includes a trust center in every pricing tier and Reco is not using it, paying separately for SafeBase — a Drata product. ProcessUnity overlaps Scytale's own vendor risk module. Both are real duplication. The honest caveat is that SafeBase is materially more capable than Scytale's trust center, so the finding is *"Reco is paying twice,"* not necessarily *"switch."* Migrating would likely be a downgrade.

---

## The operating model, once it is built

**Exceptions route to humans. Everything else self-attests.** Full detail in `docs/OPERATING-MODEL.md`; the shape is:

- **Daily, zero human time.** Collect, assert, compute variance, route new failures to the owning team's channel deduplicated by subject, emit OSCAL.
- **Weekly, ~90 minutes.** Denominator drift alarms *first* — a population that silently shrank makes the pass rate improve while coverage gets worse. Then repeat offenders, escalated to root cause rather than remediated again. Then exceptions expiring within 30 days.
- **Monthly, ~half a day.** Refresh VF/VD, recompute efficacy, re-rank by ROSI, one generated page upward.
- **Quarterly, ~three days.** Management review pack generated for ISO 27001 Cl. 9.3 and ISO 42001 Cl. 9.3. Restore test with elapsed time recorded as measured. Access review run as a *diff* of HRIS against IdP entitlements — nobody reviews a 400-row spreadsheet honestly, and asking them to is a control that fails by design.
- **Annually.** Risk assessment refresh, SoA regenerated from the OSCAL profile rather than edited, policies regenerated from operating controls, pentest scoped from the scenario set rather than from last year's scope.

Five things stay manual deliberately: risk acceptance, efficacy parameters, exception approval, auditor relationships, and the EU AI Act classification. Automating any of them would be worse than doing them by hand.

---

## Success metrics

| Metric | Baseline | Day 90 | Why this one |
|---|---|---|---|
| **Human-touch minutes per control per quarter** | measured week 2 | −80% on instrumented controls | The only metric that says whether a one-person program is viable |
| Controls at confidence tier 4 (internal empirical) | ~0 | ≥ 15 | Distinguishes measurement from assertion |
| Controls with a population definition that is executable | unknown | 100% of instrumented | If the denominator cannot be written, the control cannot be measured |
| Mean detection latency (`started → detected`) | not currently measured | measured and trending | Separates monitoring failures from remediation failures |
| Security questionnaire turnaround | measure week 1 | −50% | The metric the CRO cares about, and the one that funds the next phase |
| Evidence requests answered with a query rather than a screenshot | ~0 | 100% of instrumented | *A questionnaire asks a human to attest; a query asks a system to prove* |

Deliberately **not** measured: control count, pass rate, or framework coverage percentage. All three go up while the program gets worse.

---

## What would change this plan

Stated up front rather than discovered later.

1. **The SOC 2 window is not Dec 1 – Nov 30.** Everything re-phases. Highest-priority confirmation.
2. **Scytale turns out to have a usable read API.** Reconciliation gets much cheaper and ADR-0001 is revisited — though the system-of-record decision holds regardless, on lock-in grounds.
3. **A FedRAMP or TX-RAMP mandate appears.** This becomes a different job. AppOmni holds a FedRAMP Moderate ATO and TX-RAMP and appears to be the only pure-play SSPM in the marketplace at any status; given the new Texas office, TX-RAMP is the cheaper near-term counter and the OSCAL work above is the substrate either way. FedRAMP RFC-0024 puts machine-readable packages on a clock, which is an argument for building OSCAL correctly now rather than later.
4. **A CISO is hired in the first 90 days.** Good outcome. The ISMS/AIMS ownership question resolves itself and this plan reports into it rather than around it.
5. **Product declines a Reco-on-Reco tenant.** The dogfooding controls fall back to primary APIs. More collector work, and the reference story is lost.

---

## The one-paragraph version

Reco holds the certificates; what it does not yet have is a program that runs itself. The build is a Git-housed control inventory as the system of record, a time-indexed evidence warehouse producing populations rather than samples, Scytale demoted to a rendering layer because it has no read path, Reco's own product pointed at Reco as a collector, and the variance data that satisfies the auditor reused as the input to quantified risk so that remediation is sequenced by loss reduction per dollar. The first 90 days deliberately change nothing normative, because the SOC 2 observation window closes at day 90 and re-cutting controls inside it is how audits get qualified. What ships instead is a parallel program with real evidence, a reconciliation that proves it, an AI governance layer that gives ISO 42001 something to look at beyond documentation, and an attestation surface that turns security review latency — the one GRC number the revenue side already cares about — into a metric that goes down.

---

### Sources

Reco trust center: [trust.reco.ai](https://trust.reco.ai/) · Reco [about](https://www.reco.ai/about-us), [careers](https://www.reco.ai/careers), [Series B announcement](https://www.reco.ai/blog/reco-raises-30m-b-round-for-a-total-of-85m-to-meet-rapidly-growing-demand-for-saas-ai-security-among-enterprises), [executive expansion](https://www.reco.ai/blog/reco-expands-executive-team-in-enterprise-ai-agent-security), [first CISO announcement (2024)](https://www.reco.ai/blog/reco-names-merritt-baer-chief-information-security-officer) · [Reco on Amazon Bedrock, AWS ML blog](https://aws.amazon.com/blogs/machine-learning/how-reco-transforms-security-alerts-using-amazon-bedrock/) · Scytale [custom integrations](https://scytale.ai/resources/custom-integrations-update/), [integrations](https://scytale.ai/integrations/), [pricing](https://scytale.ai/pricing/), [trust center product](https://scytale.ai/trust-center/), [audit partners](https://scytale.ai/find-a-partner/audit-partners/), [open-source Claude skills](https://github.com/scytale-labs/GRC-Claude-Skills) · [GRSee platform comparison](https://grsee.com/resources/compliance/compliance-automation-platform-comparison-vanta-drata-secureframe-sprinto-scytale-anecdotes/) · [Scytale G2 reviews](https://www.g2.com/products/scytale-g2/reviews?qs=pros-and-cons) · [AppOmni FedRAMP package FR2431264500](https://www.fedramp.gov/marketplace/products/FR2431264500/) · [Obsidian ISO 42001 certification](https://www.obsidiansecurity.com/news/obsidian-security-achieves-iso-iec-42001-2023-certification-for-ai-governance) · trivy-action compromise [GHSA-69fq-xp46-6x23 / CVE-2026-33634](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23), [Microsoft Security Blog analysis](https://www.microsoft.com/en-us/security/blog/2026/03/24/detecting-investigating-defending-against-trivy-supply-chain-compromise/) · SCF [terms and conditions](https://securecontrolsframework.com/terms-and-conditions), [commercial license](https://securecontrolsframework.com/commercial-license), [GitHub](https://github.com/securecontrolsframework/securecontrolsframework) · [NIST OSCAL](https://github.com/usnistgov/OSCAL) · EU AI Act deferral — Regulation (EU) 2026/1744, analysis by [Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/) and [Jones Walker](https://www.joneswalker.com/en/insights/blogs/ai-law-blog/yes-august-2-still-matters-the-eu-approved-a-high-risk-ai-delay-but-most-trans.html)

**Verification note.** Every URL above was fetched or search-confirmed on 21 August 2026, and `VERIFICATION.md` records what was checked, what was corrected, and what remains unverifiable. Two claims in an earlier draft were wrong and have been fixed: the Trivy advisory identifier, and the EU AI Act high-risk applicability date. Both corrections are recorded rather than quietly overwritten.
