# Build order

What is already built, what still has to be built, and — for each thing that has to be built — the
prompt to paste into Claude Code.

**22 units across five phases.** Phase 0 is buildable **right now**, before day one — five units of
pure machinery that need no credentials, documents or decisions from the organization. Everything from Phase 1 on is
gated on one of those three, which means the fastest way to move the rest of this roadmap is the
access-request table in `docs/SOP-DAY-ONE.md`, not an editor.

*Unit IDs are assigned when the unit is written and never reordered, so B14–B17 sit inside earlier
phases rather than at the end. Same reasoning as control IDs: a stable identifier you can point at
in a commit message beats a tidy sequence. Read by phase, not by number.*

## Why any of this is unbuilt

Everything in this repo that could be built without the organization's credentials, the organization's data, or a decision
only the organization can make **is built and tested**. What remains falls into exactly three categories:

**Phase 0 is the exception** — see below. It is everything that consumes a control inventory without
needing the organization's. What remains after that falls into exactly three categories:

1. **Needs credentials.** Collectors are written against the API shapes with injected clients, but
   have never run against a live tenant. A collector that has not seen real data is a hypothesis.
2. **Needs real data.** The dbt staging models are deliberately absent rather than stubbed. An empty
   `stg_*.sql` returning no rows makes `dbt run` succeed while proving nothing — worse than a
   missing file, because it looks like success.
3. **Needs a decision.** The Scytale JSON contract, the EU AI Act role determination, the dogfooding
   tenant. None of these are technical problems.

**Nothing here is a stub presented as finished.** Where something is scaffolding, `README.md` says
so in the "What is real here and what is scaffolding" section.

---

## Already built and tested — do not rebuild

| | |
|---|---|
| Control record schema + 9 layer-split seed controls | validating clean |
| Assertion, exception, scenario, finding, gap schemas | |
| Nine inventory guards (G1–G9) + CI licensing grep | enforced on every edit via hook |
| FAIR-CAM efficacy math — reliability, operational efficacy, variance decomposition, ROSI | tested, incl. a documented divergence from a published worked example |
| Deterministic RFC 4122 v5 UUIDs | verified against the canonical test vector |
| Assertion builder with exception handling and denominator drift | tested |
| OSCAL assessment-results emission | byte-identical re-export gated in CI |
| Control health classification (12 deficiency codes, 4 bands) | tested |
| Four-direction gap assessment | tested |
| Audit finding intake + reconciliation | tested |
| Scytale push adapter | refuses to send until the contract is confirmed |
| Requirement index — 38 SOC 2 + 93 ISO 27001 Annex A identifiers | |
| 6 subagents, 4 slash commands, 3 skills | |
| Cross-platform validation hook (Node), tested against its own failure modes | 9 tests pin the blocking path, and one pins that the tests themselves never mutate the working copy |

75 tests. `npm test`, `npm run validate`, `npm run baseline` all green on Windows, macOS and Linux.

---

# Phase 0 — before day one

> **Sequencing, effort and session-by-session deliverables: [`docs/PREP-PLAN.md`](docs/PREP-PLAN.md).**
> This section holds the full prompts; that one holds the order to run them in.

Everything here is buildable **today**, with no credentials from the organization, no internal documents, and no
decisions only the organization can make. That is the entry criterion: if a unit needs any of those three, it
belongs in Phase 1 or later.

**The organizing principle: build machinery, not content.**

Machinery — OSCAL emitters, the MCP server, the simulation engine, the probe harness — is portable.
It survives contact with whatever you actually find inside the organization, because it operates on whatever
control records exist rather than on assumptions about which ones will.

Content is the opposite. Writing the organization-specific controls, crosswalks or scenarios before reading the
SOC 2 report produces work you throw away, and it does something worse than waste time: it anchors
you. You will have spent a weekend deciding what the organization's control model looks like, and you will then
read the auditor's system description looking for confirmation rather than looking at what is there.

So: build the things that consume a control inventory. Do not build the inventory.

**What Phase 0 buys you.** Roughly half of Phase 3 lands before you start, so days 61–90 open up
for the work that actually needs the organization context — the reconciliation pack, the attestation surface,
the management review pack.

---

## B18. Complete the OSCAL package

**Blocked on:** nothing. This is the single largest unblocked unit and it is pure machinery.

Only `assessment-results` (O3) exists. The other four models are generated entirely from control
records — the shape of the records, not their content — so they can be built against the nine seed
controls and will work unchanged against the organization's real inventory.

```
Read src/oscal/assessment-results.mjs and docs/adr/ for the conventions, then build the rest:

- O1 component-definition: our controls as components, carrying the FAIR-CAM props extension
- O2 catalog + profile: our control catalog, and one profile per framework baseline importing it
  with EXPLICIT TAILORING. The profile is what makes a Statement of Applicability defensible — it
  records WHY each control is in or out, which an SoA is supposed to prove and usually does not.
- O4 POA&M: generated from failing[], with the four variance timestamps attached. Those timestamps
  are what convert a POA&M from a compliance artifact into a risk artifact.
- O5 SSP: GENERATED, never hand-authored. If it cannot be regenerated from catalog + profile +
  component definitions, the model is incomplete. Treat a hand-edited SSP as a bug.

Every UUID deterministic v5 over the committed namespace. Sort keys. Add each artifact to the CI
determinism gate that already covers assessment-results — an unchanged inventory must re-export
byte-identically or the diff becomes unreviewable.

Validate all of it against metaschema-framework/oscal-cli v3.2.0 as a BLOCKING CI step — NOT
usnistgov/oscal-cli, whose newest tag is still v1.0.3 from February 2024.

I have a working reference in RootCawsLLC/cui-control-plane where all eight artifacts validate
against oscal-cli as a CI gate. Read that first rather than starting cold.

Build against the nine seed controls. Do not add or modify any control record — this unit consumes
the inventory, it does not shape it.
```

**Done when:** all five models emit, validate against `oscal-cli` in CI, and re-export
byte-identically on unchanged input.

**Why it is safe to do early:** none of it encodes an assumption about the organization. It encodes the OSCAL
spec, which is not going to change based on what you find in the SOC 2 report.

---

## B19. MCP server over the control graph

**Blocked on:** nothing.

```
Build an MCP server exposing this repo read-only:

  get_control(control_id)
  list_controls(status?, layer?, owner?)
  list_failing(control_id?)
  get_assertion_history(control_id, from, to)
  get_variance(control_id)
  get_findings(disposition?, control_id?)
  health_summary()
  gap_summary(direction?)

READ-ONLY. Writes go through pull requests — guardrail 2, and it is not negotiable.

Reason for existing: it lets me answer an auditor's or a customer's question from Slack or from a
Claude conversation without opening the repo, while every answer still comes from the system of
record rather than from someone's memory.

RootCawsLLC/proofplane already ships an MCP server — read that implementation first.

Write tests. The tool descriptions matter as much as the code: they are what determines whether
the right tool gets called, so write them as carefully as you would write a control's
population_definition.
```

**Done when:** the server runs, tests pass, and you can ask "which controls are failing" in a Claude
conversation and get an answer traceable to a file in this repo.

---

## B20. Port the proofplane probe harness

**Blocked on:** nothing for the harness. Only *which of the organization's agents are in scope* is blocked, and that
is a Phase 2 conversation.

**This is the highest-differentiation work in the whole roadmap and you already own the source.**

The organization publicly states it runs "multiple production AI agents" on Bedrock and Anthropic Claude — an
AWS ML blog post of 23 March 2026 co-authored by the CTO. Walking in with a working AI-agent control
assurance harness, on day one, at a company whose ISO 42001 certificate is its clearest competitive
edge, is a different conversation from walking in with a plan to build one.

```
I own RootCawsLLC/proofplane: 12 house-ID controls (PP-C001..PP-C012) with 12 falsifiable probes
mapped 1:1, crosswalked to EU AI Act, ISO 42001, ISO 27002, ISO 27701 and NIST AI RMF, carrying
MITRE ATLAS and OWASP ASI threat mappings, emitting OSCAL assessment-results, with an MCP server.

Port the probe HARNESS into this repo — the runner, the evidence format, the paired
guarded/unguarded run structure — so probe results become assertion records conforming to
schemas/assertion.schema.json.

Start with the three probes that map to controls already scoped here: tool allowlist, indirect
prompt injection, egress destination. Run them against proofplane's own instrumented target agent,
which is what it is for. Do NOT point anything at a production system — I do not work there yet.

The control passes ONLY on an executed denial recorded in the audit chain. An allowlist present in
configuration but never exercised does not pass. Active testing, not attestation.

Keep the paired guarded/unguarded evidence runs. Proving a control works by showing both states is
what makes this different from a policy assertion, and it is the artifact that changes an ISO 42001
surveillance audit from documentation review into demonstrated capability.

Guardrail: the probe records what happened. It does not conclude the control is effective.
See docs/adr/0004-agents-do-not-evaluate-efficacy.md.
```

**Done when:** three probes run against the proofplane target and emit valid assertion records, with
paired evidence, in CI.

**What stays blocked:** which of the organization's agents are in scope, and whether product-engineering will run
these against them. Both are conversations, not code.

---

## B21. FAIR simulation engine — machinery only

**Blocked on:** nothing for the engine. **Everything for the parameters.**

The distinction is the whole unit. Build the machinery; make it refuse to run on uncalibrated
inputs. Then on day 45 the workshop fills in parameters and the curve appears the same afternoon,
rather than starting a build.

```
Read scenarios/_CALIBRATION-STATUS.md and schemas/scenario.schema.json.

Build src/simulate.mjs: PERT or lognormal sampling from the scenario parameters, 10,000 trials,
producing a loss exceedance curve per scenario and an aggregate.

Hard requirements:
- REFUSE to simulate any scenario whose parameters are still derivation_level: assumed. Name them
  and stop. A simulation over invented parameters produces a curve that looks authoritative and is
  fiction — that is precisely the failure mode FAIR exists to prevent, and it is worse than no
  curve because a curve ends the conversation.
- Carry confidence_tier through to the output.
- State the independence assumption explicitly in the aggregate. Aggregated risk reported without
  it is meaningless.
- Output percentiles and the curve, never a bare expected value.
- Wire to ROSI in src/faircam.mjs so the remediation backlog ranks by loss reduction per dollar.
  Any control with cost.opex_annual unpopulated is unrankable — flag it, never guess it.

Test it against a FIXTURE scenario with calibrated parameters, stamped NOT REAL DATA and stored in
fixtures/. Do NOT calibrate anything in scenarios/ — those stay at derivation_level: assumed until
a named human calibrates them with the organization's own data.

I have a working 10,000-trial engine in RootCawsLLC/u-dont-grc-me. Read it before writing from
scratch.
```

**Done when:** the engine runs on a labeled fixture, refuses every real scenario with a clear
message naming which parameters are uncalibrated, and ROSI ranks by loss reduction per dollar.

---

## B22. Warehouse skeleton on labeled fixtures

**Blocked on:** nothing, **with one sharp caveat.**

**The line, and it matters.** Writing an empty `stg_*.sql` that returns no rows so `dbt run`
succeeds is forbidden — it makes a control look instrumented while proving nothing, which is the
worst failure mode in this repo. Building the warehouse *machinery* and exercising it against
fixtures explicitly stamped NOT REAL DATA is legitimate and valuable: it proves the pipeline shape
end to end, so day one is credential wiring rather than architecture.

The test of which side you are on: **does anything in `controls/` change status because of it?** If
yes, you crossed the line.

```
Read models/README.md and models/controls/ctl_iam_cloud_platform_mfa.sql.

Stand up DuckDB as the local warehouse and prove the pipeline end to end on synthetic data:

  fixture rows -> staging -> control model -> assertion record -> variance -> OSCAL

Requirements:
- Fixtures live in fixtures/ and every file carries a NOT REAL DATA header. Follow the convention
  in RootCawsLLC/cui-control-plane.
- Time-indexed landing. The layer must answer "what was true on 14 March", not only "what is true
  now". If it overwrites, the entire variance layer is unreachable and this is a dashboard.
- Snapshot the control models so history accumulates.
- Generate at least two collection cycles of fixture history so the variance layer actually has
  something to compute, and the four-timestamp decomposition can be tested.
- Write the dbt tests: not_null on subject_id, unique on (as_of, subject_id), and a
  denominator-stability test.

Every control record stays at its current status. This unit builds the plumbing; it does not
instrument anything. Nothing here is evidence about the organization.

Add an `npm run demo` that runs the whole synthetic pipeline and prints the result, so the shape is
demonstrable to a CTO in ninety seconds without touching a production system.
```

**Done when:** `npm run demo` runs the full synthetic pipeline, the variance decomposition produces
real segment numbers from fixture history, and no control's `status` changed.

**The side benefit is the point.** `npm run demo` is the single most useful artifact you can walk
in with. It shows what the finished thing does, on data that is unambiguously not the organization's, in under
two minutes.

---

## Also worth doing, and not a build

**Refresh `client-context` before you start.** The skill carries facts verified on 21 August 2026.
Certifications, leadership and funding move. A week before your start date:

```
Read .claude/skills/client-context/SKILL.md, then re-verify every CONFIRMED fact against primary
sources — trust.reco.ai, reco.ai/about-us, reco.ai/careers, the newsroom.

Report only what CHANGED. Keep confirmed and inferred separate; do not promote an inference to a
fact because it would make the summary cleaner. If a fact can no longer be verified, mark it
unverified rather than deleting it — knowing something used to be true and now cannot be confirmed
is itself information.

Pay particular attention to: whether a CISO has been named, whether any new certification appears
on the trust center, and whether the subprocessor register has changed.
```

**Rehearse the intake workflow.** Find a publicly available SOC 2 Type 2 report — some vendors
publish redacted versions, and the AICPA publishes illustrative examples — and run `/intake-soc2`
against it end to end. Not for the content, which is irrelevant, but to shake out the extraction
schema and learn where the workflow is awkward *before* you are doing it against the organization's real report
with a calendar full of introductions.

**What NOT to do before day one**, and each is genuinely tempting:

- **Do not write the organization-specific control records.** You have not read the system description. Whatever
  you write will be wrong in ways you cannot see, and you will defend it because you wrote it.
- **Do not populate any crosswalk.** Same reason, plus it is the SCF licensing surface.
- **Do not calibrate a scenario.** Calibration is a workshop with named humans and the organization's data.
- **Do not draft policies.** Policy comes after controls operate. That is guard G2 and it is not
  advisory.
- **Do not build collectors against guessed API shapes.** The IdP, HRIS and training platform are
  all unknown. A collector written against the wrong vendor is worse than no collector, because it
  looks like progress.

---


# Phase 1 — days 1–30

## B1. Warehouse and staging models

**Blocked on:** read access to AWS, the IdP, and GitHub.
**Why Claude Code and not me:** the staging models have to match the actual shape the collectors
return from the organization's actual tenants, which nobody can know from outside.

```
Read models/README.md, models/controls/ctl_iam_cloud_platform_mfa.sql, and
src/collectors/aws-iam.mjs.

Set up DuckDB as the local warehouse and write the staging models the control models reference.
Start with stg_aws_iam_principals only — one system, one control, one cycle.

Requirements:
- Time-indexed. The landing layer must answer "what was true on 14 March", not only "what is true
  now". If it overwrites, the entire variance layer is unreachable and the pipeline is a dashboard.
- Snapshot the control models so history accumulates. Variance Duration comes from that history.
- Write the dbt tests too: not_null on subject_id, unique on (as_of, subject_id), and a
  denominator-stability test. The last one matters most — a silent drop in `total` means the asset
  inventory failed before the control did.

Do NOT stub the staging model to make dbt run succeed. If you cannot populate it from real data
yet, say so and stop.
```

**Done when:** `dbt run && dbt test` passes against real AWS data, and `total` in the resulting
assertion matches a manual count you did yourself. A query returning 0 rows and a query returning
0 failures look identical in a pass rate and are completely different in reality — check which one
you have.

---

## B2. Wire the AWS collector to live credentials

**Blocked on:** the OIDC role.
**Why Claude Code:** it needs to iterate against real API responses and real IAM edge cases.

```
src/collectors/aws-iam.mjs takes an injected client and has never run against a live account.

Write the real client using the AWS SDK v3 and OIDC — no long-lived keys, because this pipeline
measures ctl.iam.cloud-platform.mfa and does not get to violate it.

It must:
- enumerate every account in the production organization, not a hardcoded list
- pull the IAM credential report per account and handle the async generation state properly
- distinguish human-assumable roles from service roles by trust policy, NOT by name convention
- surface the root account explicitly — it is in the population and it is expected to fail loudly
- preserve access_key_1_last_rotated as first_observed, because that is what makes Variance
  Duration real rather than an artifact of collection cadence

Write tests with recorded fixtures. Then run it and show me the denominator before we trust it.
```

**Done when:** an assertion record whose `total` you have independently verified.

---

## B3. Audit intake for the real reports

**Blocked on:** the reports.
**Why Claude Code:** it is the extraction partner. This is not automatable and should not be.

Use `/intake-soc2` — it carries the discipline. See `docs/DAY-ONE.md` hours 2–4.

**Done when:** `npm run intake` reconciles clean and
`npm run gap -- --direction remediation` shows the real finding set.

---

## B4. Populate the requirement index from the SoA

**Blocked on:** the Statement of Applicability.

```
Read reference/requirement-index.yaml and the SoA I am pasting.

Set in_scope on every ISO 27001 Annex A requirement from the SoA, and on every SOC 2 criterion from
the report's TSC scope. Where the SoA records an exclusion justification, put it in a
`justification` field alongside — identifiers and our own words only, never the standard's text
(ADR-0003, and CI greps for it).

Then run `npm run gap -- --direction coverage` and tell me what the real coverage picture is. Do
not report a percentage for anything still marked null.
```

**Done when:** no `in_scope: null` remains, and the coverage number means something.

---

# Phase 2 — days 31–60

## B5. IdP, GitHub and HRIS collectors

Same pattern as B2. Three notes that will bite otherwise:

- **IdP:** exclude service principals **by type attribute, never by name pattern**. A human account
  named `svc-something` must not disappear from the denominator.
- **GitHub:** the SHA-pin check is the part with teeth. See
  `controls/ctl.appsec.ci-cd.branch-protection.yaml` for why (GHSA-69fq-xp46-6x23).
- **HRIS:** the roster is the population, **not** the training platform's user list. That inversion
  is the entire control — sourcing from the training platform makes completion look like 100% while
  every unenrolled worker is invisible. And the roster must cover **all three entities**, including
  Moldova.

```
Build the real client for src/collectors/idp.mjs against <IdP>, following the pattern established
in the AWS collector once B2 is done. Same rules: read-only, injected client, recorded fixtures,
show me the denominator before we trust it. Exclude service principals by type attribute only.
```

---

## B6. The self-dogfooding collector — the differentiated one

**Blocked on:** product agreement on an internal tenant (ADR-0005).
**Why Claude Code:** it needs the product's actual API surface.

```
Read docs/adr/0005-self-dogfooding.md.

Build src/collectors/product-graph.mjs — a collector that reads the organization's own knowledge graph for the
product tenant and returns the standard row shape.

Three controls take it first:
- ctl.vendor.procurement.subprocessor-register — observed OAuth grants and SaaS-to-SaaS connections
  give the subprocessor denominator from what is actually connected
- ctl.ai.inference.model-inventory — shadow AI discovery gives the model and endpoint inventory
- SaaS configuration drift generally, once those two are proven

Hard boundary from the ADR: the organization supplies OBSERVED STATE ONLY. Never import a product risk score, a
product compliance mapping, or a product severity into an assertion record. We use the product's
collection, not the product's judgment — which is exactly what we would tell a customer.

Where product-graph overlaps a primary API collector, reconcile the two and report divergence. That
reconciliation is the honesty mechanism for the circularity the auditor will ask about.
```

**Done when:** the subprocessor reconciliation runs across all three sources — finance SaaS spend,
observed connections, DPA repository — and you can say how many processors are actually operating
versus the five published.

---

## B7. Variance layer → FAIR-CAM

**Blocked on:** two collection cycles of history (you cannot compute duration from one snapshot).

```
Read models/variance/variance_events.sql and src/faircam.mjs.

Wire the variance table into the efficacy calculation: pull VF and VD per control, compute
reliability and operational efficacy, and attach the results to the OSCAL props on export.

Non-negotiable: any control whose variance_started_at_quality is 'equals-detected' must carry
upper_bound_only through to every downstream artifact — the OSCAL props, the management review
pack, and any slide. src/faircam.mjs already emits that flag; make sure nothing drops it on the way
to a human.

Also build the segment decomposition report: for each control, how much of Variance Duration was
detection latency (control monitoring), triage latency (treatment selection), and remediation
(implementation). Knowing VD is 30 days is not actionable. Knowing 26 of those days were detection
latency is.
```

---

## B8. FAIR Monte Carlo

**Blocked on:** the day-45 calibration workshop. Do not build before the parameters are real.

```
Read scenarios/_CALIBRATION-STATUS.md and schemas/scenario.schema.json.

Build src/simulate.mjs: PERT or lognormal sampling from the scenario parameters, 10,000 trials,
producing a loss exceedance curve per scenario and an aggregate.

Requirements:
- Refuse to simulate any scenario whose parameters are still derivation_level: assumed. Say which
  ones and stop. A simulation over invented parameters produces a curve that looks authoritative
  and is fiction — that is the failure mode FAIR exists to prevent.
- Carry the confidence tier through to the output.
- State the independence assumption explicitly in the aggregate. Aggregated risk reported without
  it is meaningless.
- Output percentiles and the curve, never a single expected value on its own.

Then wire it to ROSI in src/faircam.mjs so the remediation backlog ranks by loss reduction per
dollar. Any control with cost.opex_annual unpopulated is unrankable — flag it, never guess it.

I have a working reference implementation in RootCawsLLC/u-dont-grc-me (10,000-trial engine). Read
it before writing this from scratch.
```

---

## B9. AI agent control probes — port from proofplane

**Blocked on:** product-engineering capacity, and an answer on which agents are in scope.
**Highest differentiation in the whole plan.**

The organization publicly states it runs "multiple production AI agents" on Bedrock and Anthropic Claude — an
AWS ML blog post of 23 March 2026 co-authored by the CTO. These agents exist today.

```
I have an existing repo, RootCawsLLC/proofplane: 12 house-ID controls (PP-C001..PP-C012) with 12
falsifiable probes mapped 1:1, already crosswalked to EU AI Act, ISO 42001, ISO 27002, ISO 27701
and NIST AI RMF, already carrying MITRE ATLAS and OWASP ASI threat mappings, already emitting OSCAL
assessment-results, and already shipping an MCP server.

Port the probe harness into this repo so probe results become assertion records against
ctl.ai.agent.tool-allowlist and the AI controls that follow it.

Start with the three probes that map to controls already scoped here: tool allowlist, indirect
prompt injection, and egress destination.

The control passes ONLY on an executed denial that is recorded in the audit chain. An allowlist
present in configuration but never exercised does not pass — active testing, not attestation.

Keep the paired guarded/unguarded evidence runs. Proving the control works by showing both states
is what makes this different from a policy assertion, and it is the artifact that changes the
ISO 42001 surveillance conversation from documentation review to demonstrated capability.

Guardrail: the probe records what happened. It does not conclude the control is effective.
See docs/adr/0004-agents-do-not-evaluate-efficacy.md.
```

---

## B14. Security awareness training as an operating control

**Blocked on:** the HRIS roster (B5) and a decision on the training platform.
**Why this exists:** it was named in the original scope and the roadmap had a control record and a
collector for it, and nothing that makes the program actually run. That was a gap.

The control record `ctl.people.workforce.security-training` already carries the important design
decision — the population comes from **HRIS, not from the training platform's user list**. That
inversion is the whole control. Sourced from the platform, completion looks like 100% while every
unenrolled worker is invisible; sourced from HRIS, unenrolment becomes a visible failure. Nothing
else in this unit matters as much as preserving that.

**Decision to make before building.** Scytale ships native security, privacy and AI awareness
training, and connects to KnowBe4 and Phished. Its native *phishing simulation* capability is
unconfirmed — their own content describes phishing tests as run by "the organization's
cybersecurity team or a designated third-party service", which reads as absent. Confirm in a demo
rather than assuming. If the organization already pays for KnowBe4, the question is whether Scytale's native
module is duplicate spend; if it does not, the question is whether native training plus no
simulation is sufficient for the ISO 27001 A.6.3 and SOC 2 CC1.4 expectations you will be tested
against.

```
Read controls/ctl.people.workforce.security-training.yaml and src/collectors/idp.mjs.

Build the training program controls. Split by layer — these are NOT one control:

  ctl.people.workforce.security-training     baseline annual + 30-day new-hire, all workers
  ctl.people.engineering.secure-dev-training  engineers only, separate cadence and content
  ctl.people.ai-access.ai-training            anyone with production model or agent access
  ctl.people.workforce.phishing-simulation    a DIFFERENT control: measures susceptibility,
                                              not completion, and its population is the same
                                              roster but its passing condition is behavioral

The last one is the one people collapse into the others and should not. Completion is a
Communication of Expectations control. Simulation susceptibility is a Susceptibility MEASUREMENT
that feeds scn.phish.bec — it is a decision-support input, not a loss-event control, and treating
a click rate as a control pass rate is how a training metric becomes meaningless.

For each: population from HRIS, joined to the training platform by employee ID, never by email
(emails change, and a changed email silently drops someone from the denominator). All three
entities including Moldova. Contractors in scope.

Failure reasons must distinguish: not_enrolled, enrolled_not_started, overdue, and
completed_outside_sla. "Not complete" collapses four different problems with four different
owners into one number.

Write the dbt models and the collector. Do not stub the training platform client — if I do not
have credentials yet, say so and build the csv-inbox path instead, marked degraded at
confidence_tier 3.
```

**Done when:** four controls asserting weekly, and the first run reveals the number that matters —
how many active workers are absent from the training platform entirely. That figure is invisible
under the old denominator and is usually not zero.

**A note on the phishing control.** Its passing condition is a policy decision, not a technical
one, and it should be made deliberately: is the control "simulation ran on schedule" (a process
control, easy, near-useless) or "click rate below threshold X" (an outcome control, meaningful,
and it will fail)? Pick the second, set X from your own first three runs rather than from a vendor
benchmark, and expect the first quarter to look bad. That is the control working.

---


# Phase 3 — days 61–90

## B10. Complete the OSCAL package

`emitAssessmentResults` (O3) exists. O1, O2, O4 and O5 do not.

```
Read src/oscal/assessment-results.mjs and docs/adr/ for the conventions, then build the rest:

- O1 component-definition: our controls as components, carrying the FAIR-CAM props extension
- O2 catalog + profile: our catalog, and one profile per framework baseline importing it with
  EXPLICIT TAILORING. The profile is what makes the Statement of Applicability defensible — it
  records why each control is in or out, which an SoA is supposed to prove and usually does not.
- O4 POA&M: generated from failing[], with the four variance timestamps attached. Those timestamps
  are what convert a POA&M from a compliance artifact into a risk artifact.
- O5 SSP: GENERATED, never hand-authored. If it cannot be regenerated from catalog + profile +
  component definitions, the model is incomplete. Treat a hand-edited SSP as a bug.

Every UUID deterministic v5 over the committed namespace. Sort keys. Add each artifact to the CI
determinism gate that already covers assessment-results.

Validate all of it against metaschema-framework/oscal-cli v3.2.0 as a blocking CI step — NOT
usnistgov/oscal-cli, whose newest tag is still v1.0.3 from February 2024.

I have a working reference in RootCawsLLC/cui-control-plane where all eight artifacts validate
against oscal-cli as a CI gate. Read it first.
```

---

## B11. MCP server over the control graph

**The one that makes the whole repo queryable from anywhere.**

```
Build an MCP server exposing this repo read-only:
  get_control(control_id)
  list_controls(status?, layer?, owner?)
  list_failing(control_id?)
  get_assertion_history(control_id, from, to)
  get_variance(control_id)
  get_findings(disposition?, control_id?)
  health_summary()
  gap_summary(direction?)

READ-ONLY. Writes go through pull requests — that is guardrail 2 and it is not negotiable.

Reason for existing: it lets me answer an auditor's or a customer's question from Slack or from a
Claude conversation without opening the repo, while every answer still comes from the system of
record rather than from someone's memory.

proofplane already ships an MCP server — read that implementation first rather than starting cold.
```

---

## B12. Attestation surface

```
Read .claude/agents/attestation-writer.md.

Build the pipeline behind it: given a customer security questionnaire (CSV, xlsx, or a CAIQ), match
each question to controls, and generate answers from measured state.

Rules, all of them load-bearing:
- Never answer from a policy when a measured control exists.
- Never answer for a control whose status is not operating — say it is under construction, with a
  date.
- Never answer from an assertion older than the control's collection cadence. Stale is worse than
  absent because it looks current.
- Never round toward the flattering answer.
- Flag rather than answer anything touching the published RTO/RPO until the reconciliation in
  ctl.bcdr.prod.restore-test is done.
- Every answer carries its as_of and its population.

Output a draft for my review, never a submission. And track turnaround time — that is the metric
the CRO already cares about and the one that makes this program legible to people who do not care
about OSCAL.

I have a Manifest V3 Chrome extension with DOM adapters for Archer, OneTrust and Ombud portals for
the pre-fill side. Ask me about it when the generation half works.
```

---

## B13. Management review pack generator

```
Build src/review-pack.mjs: generate the quarterly management review pack for ISO 27001 Clause 9.3
and ISO 42001 Clause 9.3 from warehouse state.

Sections, all generated from data, none hand-written:
- control health by band, with movement since the last quarter
- variance trend per control, decomposed into FAIR-CAM segments
- exception register with expiries, flagging anything expiring within the quarter
- open findings by source and age
- risk position: loss exceedance, and what moved
- ROSI-ranked remediation backlog
- the standing 9.3 agenda items both standards require

Output markdown for review, then docx.

The point: a hand-assembled review pack is three days of transcription that produces the same
document. Generated, it is an hour of judgment about what the data means — which is the part that
actually needs a human.
```

---

## B15. Policy corpus generation

**Blocked on:** controls reaching `status: operating`, which per ADR-0002 means day 91 or later
for anything in the audited inventory.
**Why Claude Code:** it is mechanical generation from structured records, which is exactly what it
is good at — and guard G2 plus the `policy-generator` agent's refusals keep it honest.

The `policy-generator` subagent exists. What does not exist is the corpus: turning 40–60 operating
controls into the actual policy set that gets published, attested to, and handed to an auditor.

```
Read .claude/agents/policy-generator.md and docs/adr/ first.

Build src/policy.mjs — generate the policy corpus from control records where status == operating.

Structure: one policy document per DOMAIN (access control, data protection, change management,
vendor management, AI governance, business continuity, people security), each assembled from the
controls in that domain. Not one document per control — nobody reads 60 policies — and not one
monolithic document either, because attestation and review cadence differ by domain.

Every section derives from a field. Scope from population_definition. Requirement from title plus
the primary FAIR-CAM function. Accountable owner from owner. Exceptions from the live exception
register WITH EXPIRY DATES. Evidence of compliance from query_ref and the collection cadence.

Hard requirements:
- Refuse to emit a section for any control that is not operating. G2 already fails the build on
  policy_ref; this must refuse at generation time too, and say which control and why.
- Every policy carries a generated-on date and the control IDs it derives from, so the next reader
  can trace any sentence back to a measured thing.
- If a policy sentence cannot be traced to a field on a control record, do not write it. Cut it.
  Aspiration in a policy document is what auditors find.
- Emit markdown. Conversion to whatever the trust center wants is a separate, later problem.

Then write the attestation tracking: who has acknowledged which version, sourced from HRIS roster
as the population — same inversion as B14, for the same reason.
```

**Done when:** `npm run policy` regenerates the full corpus deterministically, the diff between two
runs on unchanged controls is empty, and every published policy traces to control IDs.

**The thing to resist.** There will be pressure to publish policies before the controls operate,
because the current policy set already exists and a gap looks bad. Do not. A policy for a control
that does not exist is a documented expectation with nothing behind it — in FAIR-CAM terms a
Defined Expectations control with no corresponding Loss Event Control, which produces documented
misalignment rather than risk reduction. The existing policies stay in force until generation
replaces them, control by control, as each one starts operating.

---


## B17. Third-party risk beyond the subprocessor register

**Blocked on:** B6 (the subprocessor reconciliation), and a decision on ProcessUnity.
**Why it is separate from B6:** B6 answers "who is actually processing our data". This answers
"and what are we doing about it", which is a different and larger question.

**The consolidation question, stated fairly.** The organization runs ProcessUnity for TPRM alongside Scytale,
which has its own vendor risk module. That is overlapping spend. But Scytale's vendor module is
qualitative — a CIA risk calculator and an ordinal score — and if ProcessUnity is doing real
assessment workflow, replacing it with the thinner tool is a downgrade dressed as a saving. Get
the facts before recommending either way; the finding may well be "keep both, but stop
double-entering vendors."

```
Read controls/ctl.vendor.procurement.subprocessor-register.yaml and
docs/adr/0005-self-dogfooding.md.

Build the third-party control layer above the subprocessor register:

  ctl.vendor.procurement.security-review    a review completed BEFORE data flows, not after
  ctl.vendor.procurement.dpa-executed       a current DPA exists for every processor
  ctl.vendor.monitoring.continuous          posture is monitored between reviews, not annually
  ctl.vendor.offboarding.access-revoked     OAuth grants and access removed at termination

The last one is the one nobody instruments and the organization's own product makes trivial: observed
SaaS-to-SaaS OAuth grants from the product-graph collector, diffed against the vendor register's
terminated set. A live OAuth grant to a vendor you stopped paying eighteen months ago is a real
finding and it is sitting in the graph right now.

Population for all four comes from the RECONCILED vendor set built in B6 — finance spend, observed
connections, and the DPA repository — never from whichever tool happens to have the longest list.

Use continuous monitoring (TPCM) framing rather than periodic questionnaires wherever the data
supports it. A questionnaire asks a human to attest; a query asks a system to prove. Where only a
questionnaire exists, say so and set the confidence tier honestly at 2.
```

**Done when:** four controls asserting, the offboarding diff has run once against the real vendor
set, and you can state the ProcessUnity recommendation with evidence rather than with a spend
comparison.

---


# Phase 4 — beyond day 90

The 30/60/90 stops at the cutover. These are the units that follow it, listed now so the
architecture built in Phases 1–3 does not have to be reworked to accommodate them later.

## B16. Incident response and loss magnitude

**Blocked on:** calibrated scenarios (B8) and executed customer contracts.
**Why it is not earlier:** an incident cost model built before the scenarios are calibrated
produces numbers with the same provenance problem as an uncalibrated loss exceedance curve.

**Get the framing right, because it is easy to overclaim.** The organization is privately held and is **not an
SEC registrant**, so SEC Item 1.05 and its four-business-day disclosure clock do **not** apply to
the organization directly. What does apply, and what actually drives the work:

1. **Contractual notification clocks.** Customer MSAs and DPAs carry notification obligations —
   often 24, 48 or 72 hours — and they run from the organization's determination, not from the customer's.
   Those clocks are the real constraint and they are knowable today from the CLM.
2. **The organization's customers who ARE registrants.** Their materiality clock runs through the organization as a
   processor. A slow or vague notification from the organization directly impairs a customer's ability to meet
   its own obligation, which is a contract problem and a renewal problem.
3. **GDPR Article 33.** 72 hours to the supervisory authority where the organization is a controller, and
   without undue delay to the controller where the organization is a processor — which is the usual case.
4. **Cyber insurance sizing**, which currently rests on a broker benchmark rather than on the organization's
   own loss modeling.

```
Read scenarios/ and src/faircam.mjs.

Build two things.

FIRST, the notification obligation register: extract from executed customer contracts the
notification trigger, the clock length, the required content, and the recipient. Structure it so
an incident commander can answer "who do we owe what, by when" from a query rather than from a
lawyer reading contracts at 2am. This is the highest-value half and it needs no risk modeling
at all.

SECOND, loss magnitude modeling per scenario, decomposed into cost modules — investigation and
response, customer notification, credit monitoring, regulatory fines and judgements, legal
defense, customer churn and contractual penalties, replacement technology, business interruption,
public relations, and post-breach security improvement.

Requirements:
- Costs derive from the organization's own contracts and headcount where possible; industry benchmarks only
  where nothing internal exists, and LABELED as such with the source.
- Contractual penalty and churn modules come from the actual customer contract set, not from a
  benchmark. This is the module where a generic figure is most wrong and most consequential.
- Every parameter carries derivation_level and confidence_tier, same discipline as scenarios/.
- Output feeds the aggregate loss exceedance curve from B8, and cyber insurance sizing.

FAIR-MAM is CC BY-NC-ND 4.0. Implement and cite for internal use; do not redistribute or remix the
model itself.
```

**Done when:** the notification register answers "who do we owe what, by when" as a query, and at
least one scenario carries a magnitude estimate whose parameters trace to the organization's own contracts.

**The incident-response runbook is earlier and cheaper than this.** It needs no modeling and
should exist well before Phase 4 — if there is no current IR plan naming who declares an incident
and who authorizes customer notification, that is a week-one finding, not a Phase 4 build.

---


# What Claude Code is genuinely better at here

Worth being deliberate about, because the answer is not "everything".

**Give to Claude Code:** collector implementations against real API responses; dbt model authoring
where the population definition already exists; OSCAL emitters (mechanical, schema-bound, heavily
testable); test writing; the extraction *drafting* pass on audit reports; porting proofplane;
refactors across many files.

**Keep for yourself:** the layer-split decisions; calibration; efficacy parameters; the EU AI Act
role determination; risk acceptance; anything with a named approver; and every conversation with
the auditor, the CTO, and product about the dogfooding tenant.

**The line:** Claude Code is very good at building the thing once you have decided what the thing
is, and very bad at noticing that you have decided the wrong thing. The nine guards, the hook, and
the three guardrails in `CLAUDE.md` exist to make the second failure mode loud rather than silent —
but they cannot make the decision for you, and they are not meant to.
