# IS Program Gap Assessment

State of the tooling portfolio across four repositories. 27 August 2026.

> "An installer for a GRC engineering program. Clone the repo, answer the
> questions, get a working information security program."

The vision is a product family that lets a startup install a complete, working IS
program from a single repo. The customer answers questions about their environment;
the tool generates a tailored control inventory, evidence collectors, compliance
artifacts, policies, and a CI pipeline. The success metric is **human-touch minutes
per control per quarter**, falling by an order of magnitude.

Four repositories implement this vision for different audiences. This assessment maps
what is built against what the vision requires.

## Portfolio snapshot

| | |
|---|---|
| Tests passing | 1,556 across 4 repos |
| Repos, all green | 4 |
| Controls (grc-wizard) | 44 |
| Collectors built | 22 |
| Collector families missing | 2 (IdP, HRIS) |
| ISO 27001 crosswalk edges | 85 (64 high, 21 medium) |

## Vision documents

The vision lives in four documents, each covering a different layer:

| Document | What it covers |
|---|---|
| `grc-program/PROPOSAL.md` | The 30/60/90 plan: complete end-state for a one-person GRC program at a specific organization |
| `grc-wizard/docs/roadmap.md` | The installer roadmap: 13 items across four phases (now/next/then/later) |
| `grc-program/BUILD-ORDER.md` | Implementation manual: 22 build units across five phases |
| `grc-program/docs/OPERATING-MODEL.md` | The operating cadence: daily/weekly/monthly/quarterly/annual rhythms |

---

## Repository status

### grc-wizard — the installer

637 tests, 0 failures.

Interview → profile → tailored compliance repo. The startup-scale product: 20 people,
AWS, need SOC 2 for an acquisition.

| Capability | Status | Detail |
|---|---|---|
| Control inventory | **Done** | 44 controls, 15 domains, house IDs (`RC-*`), testable assertions |
| Process catalog | **Done** | 34 processes grouped by NIST CSF 2.0 functions (W6.1) |
| Interview → generation | **Done** | 38 questions across 5 stages; generates full compliance repo |
| SOC 2 crosswalk | **Done** | All 44 controls mapped to TSC criteria |
| ISO 27001 crosswalk | **Done** | 85 edges (64 high, 21 medium), verified against purchased standard |
| AWS collectors | **Done** | 14 collectors covering IAM, encryption, networking, logging, backup, vuln scanning |
| GitHub collectors | **Done** | 3 collectors: change review, branch protection, dependency scanning |
| Tracker collectors | **Done** | 2 collectors: incident register, remediation SLA |
| MDM collector | **Done** | 1 collector: device compliance (Kandji/Jamf/Fleet/Intune/Workspace One) |
| Manual evidence | **Done** | Ceremony collector with artifact pattern-matching |
| Prowler integration | **Done** | W5.3: reuses upstream CIS/NIST checks instead of reimplementing |
| Multi-account AWS | **Done** | Cross-account role assumption, population across accounts |
| Evidence signing | **Done** | KMS-backed, auditor-verifiable, SDK-free verification path |
| Product security controls | **Done** | W7.9: AI/ML, PSIRT, in-product authz, customer SSO (4 domains, 8 controls) |
| Readiness report | **Done** | Gaps ordered blocking → important → observation |
| Compliance calendar + RACI | **Done** | Markdown + iCal, runbook stubs |
| Process matrix | **Done** | W6.5: per-function breakdown of processes, cadence, owner, evidence posture |
| Policy stubs | **Done** | Pre-filled from profile answers |
| System description draft | **Done** | SOC 2 Section III scaffolding |
| CI workflow generation | **Done** | GitHub Actions: scheduled collection, exception expiry gate |
| Exception register + enforcement | **Done** | Time-bound exceptions, CI fails on expired |
| Conflict detection | **Done** | W6.6: regeneration detects customer edits, refuses to overwrite |
| Golden snapshot CI | **Done** | Drift detection on demo profile output |
| IdP collectors | **Gap** | No `collectors/idp/` directory. Okta, Google Workspace, Entra, JumpCloud all uncollectable |
| HRIS collectors | **Gap** | No `collectors/hris/` directory. Roster reconciliation requires manual CSV |
| M365 / ScubaGear | Backlogged | W5.2: no M365 tenant at this organization |
| Second cloud (GCP/Azure) | Blocked | W7.4: needs credentials and profile schema changes |
| Preventive layer | Blocked | W7.6: policy-as-code at PR time, needs evidence history |
| OSCAL export from wizard | **Gap** | Roadmap item 13, deliberately last |

### grc-program — the system of record

282 tests, 0 failures.

The organizational deployment: control inventory, evidence pipeline, risk layer, OSCAL,
FAIR. Built for a specific certified SaaS vendor's one-person GRC program.

| Phase | Status | Units | Detail |
|---|---|---|---|
| Phase 0 — machinery | **Done** | B18–B22 | OSCAL package, MCP server, probe harness, FAIR simulation, warehouse demo. All pre-credential work complete |
| Phase 1 — days 1–30 | Blocked | B1–B4 | Warehouse with real data, live AWS collector, audit intake for real reports. **Blocked on:** read access to AWS, IdP, GitHub credentials; real audit reports; Statement of Applicability |
| Phase 2 — days 31–60 | Blocked | B5–B9, B14 | IdP/GitHub/HRIS collectors, self-dogfooding, variance layer, FAIR calibration, AI probes, security training. **Blocked on:** credentials, product agreement, calibration workshop |
| Phase 3 — days 61–90 | Partial | B10–B15, B17 | B10/B11 (OSCAL + MCP) already landed via Phase 0. Attestation, management review, policy generation, third-party risk remain. **Blocked on:** controls reaching `status: operating` |
| Phase 4 — beyond 90 | Not started | B16 | Incident response and loss magnitude modeling. **Blocked on:** calibrated scenarios, executed contracts |

**What Phase 0 delivered:** 9 seed controls, control health classification (12
deficiency codes), 4-direction gap assessment, audit finding intake with
reconciliation, OSCAL assessment-results emission, FAIR-CAM efficacy math (reliability,
operational efficacy, variance decomposition, ROSI), deterministic RFC 4122 v5 UUIDs,
assertion builder with exception handling, requirement index (38 SOC 2 + 93 ISO 27001),
Scytale push adapter, 6 subagents, 4 slash commands, 3 skills.

### ksi-harness — FedRAMP 20x

399 tests, 0 failures.

Continuous control monitoring for FedRAMP 20x. Pins machine-readable rules, reconciles
populations, gates IaC before merge.

Foundational machinery is built (vendor rules pinned, evidence integrity model,
zero-automated sufficiency model). Checks directory is empty — the framework for checks
exists but individual checks have not been authored. This repo is structurally complete
but content-sparse; it is waiting for FedRAMP 20x to stabilize.

### cui-control-plane — DoD CUI

238 tests, 0 failures.

One control inventory for five NDAA-driven regimes (CMMC, DFARS, Section 889, SCRM,
ITAR). Emits OSCAL, SPRS, per-control variance.

The most mature pipeline: demo runs end-to-end, producing 9 OSCAL artifacts from
synthetic assertions. Variance computation, SPRS derivation, policy generation (with
deliberate refusal), Section 889 representation all built. Real data requires a DoD
contract and a CUI environment.

---

## Consolidated gap matrix

Capabilities a complete IS program needs, mapped to what exists and what does not —
across the whole family.

| IS Program Capability | State | Where it lives | Gap |
|---|---|---|---|
| Control inventory | **Done** | grc-wizard (44), grc-program (9), cui-control-plane (6) | — |
| Framework crosswalk | **Done** | SOC 2 + ISO 27001 (wizard), CMMC/DFARS/889/SCRM/ITAR (ccp) | — |
| Evidence collection — AWS | **Done** | grc-wizard: 14 collectors, multi-account | — |
| Evidence collection — GitHub | **Done** | grc-wizard: 3 collectors | — |
| Evidence collection — IdP | **Gap** | — | No IdP collector exists in any repo. MFA policy, user lifecycle, SSO config all require manual evidence or CSV export |
| Evidence collection — HRIS | **Gap** | — | No HRIS collector. Roster reconciliation — the denominator for access reviews, training, offboarding — is manual |
| Evidence collection — endpoint | **Done** | grc-wizard: MDM collector (5 platforms) | — |
| Evidence collection — tracker | **Done** | grc-wizard: incident register + remediation SLA | — |
| Evidence collection — upstream tools | **Done** | grc-wizard: Prowler integration (W5.3) | — |
| Evidence signing & verification | **Done** | grc-wizard: KMS-backed, SDK-free auditor verification | — |
| Policy framework | **Done** | grc-wizard: 9 policy stubs from profile; grc-program: generation guarded by G2 | — |
| Risk quantification (FAIR) | **Done** | grc-program: 10k-trial Monte Carlo, efficacy math, ROSI | Not calibrated — needs real parameters from calibration workshop |
| OSCAL export | **Done** | grc-program (assessment-results), cui-control-plane (full 9-artifact suite) | grc-wizard has no OSCAL export (roadmap item 13) |
| Variance & trending | **Done** | cui-control-plane: VF/VD computation. grc-program: variance layer designed | Needs two collection cycles of real data |
| Control health classification | **Done** | grc-program: 12 deficiency codes, 4 severity bands | — |
| Audit intake & reconciliation | **Done** | grc-program: finding intake with reconciliation | Needs real SOC 2 / ISO reports |
| Exception management | **Done** | grc-wizard: register + CI enforcement; grc-program: assertion builder handles exceptions | — |
| Compliance reporting | **Done** | grc-wizard: readiness, matrix, calendar, RACI, process matrix, system description | — |
| CI/CD integration | **Done** | grc-wizard: generates GitHub Actions workflows; ksi-harness: IaC gating | — |
| AI agent control probes | **Done** | grc-program: 3 probes (tool allowlist, indirect injection, egress) | Ported from proofplane; needs real agents to test against |
| MCP server | **Done** | grc-program: 8 read-only tools over the control graph | — |
| Continuous monitoring (FedRAMP) | Partial | ksi-harness: framework built, checks empty | Waiting on FedRAMP 20x stabilization |
| DoD CUI / CMMC | **Done** | cui-control-plane: end-to-end pipeline, 9 OSCAL artifacts | Needs real CUI environment and DoD contract |
| Product security (AI/ML, PSIRT) | **Done** | grc-wizard: 8 controls across AIS, PSR, PAZ, SSO domains | Evidence is periodic review (bucket B), not automated |
| Vendor / third-party risk | Partial | grc-wizard: 2 vendor controls; grc-program: B17 designed | No automated third-party risk platform integration (ProcessUnity deferred) |
| Security training management | Partial | grc-wizard: training control exists, manual evidence | No training platform collector; B14 blocked on HRIS roster + platform decision |
| Incident response + loss modeling | Partial | grc-wizard: IR planning + tracking controls; grc-program: B16 designed | Loss magnitude modeling blocked on calibrated scenarios |
| Operating cadence automation | Partial | grc-program: OPERATING-MODEL.md defines daily/weekly/monthly/quarterly/annual | Not implemented — the cadence is documented but the routing, alerting, and reporting machinery does not exist yet |
| Attestation surface | **Gap** | grc-program: B12 designed | Questionnaire answers from measured state not built |
| Management review pack | **Gap** | grc-program: B13 designed | ISO 27001/42001 Cl. 9.3 generator not built |
| Self-dogfooding collector | **Gap** | grc-program: B6 designed | Product-graph mechanism for using the org's own product as collector |
| Second cloud provider | **Gap** | grc-wizard: W7.4 | Profile schema, collectors, and interview for GCP or Azure |
| Preventive layer | **Gap** | grc-wizard: W7.6 | Policy-as-code at PR time from detective findings |

---

## Insights & recommendations

### The installer is substantially complete for v1

44 controls, 22 collectors, 34 processes, 85 ISO edges, full generation pipeline,
evidence signing, multi-account AWS, Prowler integration, product security controls.
Every wave except the explicitly blocked/backlogged items is done. The demo produces a
working repo a consultant could hand to a customer today.

### The IdP and HRIS gaps are the highest-leverage missing pieces

The HRIS roster is the *denominator* for access reviews (RC-IAM-03), offboarding
(RC-IAM-04), training (RC-HR-02), and endpoint compliance (RC-HR-03). Without an HRIS
collector, every one of those reconciliations is manual — and manual reconciliation is
the work the operating model says should fall by an order of magnitude. Similarly, no
IdP collector means MFA policy, SSO configuration, and user lifecycle evidence all
require manual exports. These two collectors would convert 6–8 controls from bucket B
to bucket A.

### grc-program has built all the machinery it can without being inside the organization

Phase 0 is complete (282 tests). Everything from Phase 1 onward is blocked on access to
real systems: AWS credentials, IdP API access, HRIS access, real audit reports, and a
Statement of Applicability. The 30/60/90 plan starts its clock on day one at the
organization. Until then, this repo is a loaded gun with no target.

### The four repos share architecture but not code

grc-wizard, grc-program, ksi-harness, and cui-control-plane all implement the same
pattern (house control IDs, framework crosswalks, population-based evidence,
deterministic assertions) but share no runtime code. The collector implementations in
grc-wizard don't transfer to grc-program. The OSCAL machinery in cui-control-plane was
rebuilt in grc-program. This is by design — different audiences, different schemas,
different deployment models — but it means improvements to one don't automatically flow
to the others.

### The operating cadence exists as documentation, not as automation

OPERATING-MODEL.md describes daily/weekly/monthly/quarterly/annual rhythms with specific
time budgets (0 min daily, 90 min weekly, half-day monthly, 3 days quarterly). But the
routing (new failures to owning team's channel), the denomination drift alarms, the
repeat-offender escalation, and the management review pack generation are all designs,
not running code. The gap between "what the program does" and "what the code does" is
widest here.

### Consider whether grc-wizard should become the single entry point

Today the repos serve different audiences (startup vs. specific org vs. FedRAMP vs.
DoD). But the installer metaphor — answer questions, get a program — could unify them.
A profile answer like `framework: [soc2, iso27001, cmmc]` could route to different
control catalogs and collector sets from one interview. The crosswalk-edge architecture
was designed for exactly this: "adding ISO 27001 later is adding a crosswalk entry to
existing controls plus a handful of ISO-only controls. It is not a re-key." Whether this
consolidation is worth the complexity is a strategic call.

---

## What's next

| # | Action | Impact | Blocked on |
|---|---|---|---|
| 1 | Build HRIS collector (Rippling, Gusto, BambooHR, etc.) | Converts 4+ controls from B→A; provides the roster denominator for access reviews, training, offboarding | API access to any supported HRIS |
| 2 | Build IdP collector (Okta, Google Workspace, Entra) | Converts 2+ controls from B→A; MFA policy evidence, user lifecycle, SSO config become automated | API access to any supported IdP |
| 3 | Start grc-program Phase 1 (day one at the org) | Unlocks everything from B1 through B17; the entire 30/60/90 starts | Organization start date + credentials |
| 4 | OSCAL export from grc-wizard | The generated customer repo can produce machine-readable compliance packages | Nothing — the OSCAL machinery exists in two sibling repos |
| 5 | Operating cadence automation in grc-program | The documented daily/weekly/monthly rhythm becomes running code | Phase 1 completion (real data flowing) |

---

*Gap assessment generated 27 August 2026 from the state of grc-wizard, grc-program,
ksi-harness, and cui-control-plane. 1,556 tests passing across all four repositories.
All findings verified by reading code and running tests.*
