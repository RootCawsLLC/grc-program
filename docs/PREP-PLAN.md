# Pre-start plan

Six sessions, roughly four days of work, all of it doable before your first day. The full prompts
live in [`BUILD-ORDER.md`](../BUILD-ORDER.md) Phase 0 — this document is the sequence, the effort,
and what you get at the end of each one.

**The rule that governs all of it: build machinery, not content.** Machinery consumes a control
inventory; it works unchanged against whatever the organization's turns out to be. Content — controls,
crosswalks, scenarios, policies — encodes assumptions you cannot check yet, and writing it early
does something worse than waste a weekend: you will read the auditor's system description looking
for confirmation of what you already wrote.

---

## The plan

| # | Session | Unit | Effort | Deliverable |
|---|---|---|---|---|
| **S1** | Warehouse + demo | B22 | ½ day | `npm run demo` — full synthetic pipeline in 90 seconds |
| **S2** | Complete OSCAL | B18 | 1 day | All five OSCAL models, validating in CI |
| **S3** | AI agent probes | B20 | ½–1 day | Three executed probes emitting assertion records |
| **S4** | MCP server | B19 | ½ day | Control graph queryable from any Claude conversation |
| **S5** | Simulation engine | B21 | ½ day | Monte Carlo + ROSI, refusing uncalibrated inputs |
| **S6** | Context refresh | — | 2 hrs | `client-context` re-verified; intake workflow rehearsed |

**Do S1 first** — it makes everything else demonstrable. **Do S6 last**, within a week of your
start date, because the facts move.

S2–S5 are independent of each other. If you only get two sessions, do S1 and S3.

---

## S1 — Warehouse and the demo

**Why first.** It proves the pipeline end to end on synthetic data, which means every later session
plugs into something that already works. It also produces the single most useful artifact you can
walk in with.

**Deliverable:** `npm run demo` runs fixture rows → staging → control model → assertion record →
variance → OSCAL, and prints the result. Two cycles of fixture history so the four-timestamp
variance decomposition has something real to compute.

**The line you must not cross.** An empty `stg_*.sql` that returns no rows so `dbt run` succeeds is
forbidden — it makes a control look instrumented while proving nothing. Fixtures stamped NOT REAL
DATA are fine. The test: **did any control's `status` change?** If yes, you crossed it.

> Read BUILD-ORDER.md unit B22 and follow it. Start with the fixture design — I want to see the
> fixture shape and the NOT REAL DATA convention before you write any SQL.

**Walk-in value.** Ninety seconds, on data that is unambiguously not the organization's, showing a CTO exactly
what the finished thing does. That is worth more in your first week than any slide.

---

## S2 — Complete the OSCAL package

**Why.** It is the largest unblocked unit and it is pure spec implementation. Nothing about it
encodes an assumption about the organization — it encodes OSCAL, which will not change based on what the SOC 2
report says.

**Deliverable:** component-definition, catalog, profile, POA&M and a generated SSP, all validating
against `metaschema-framework/oscal-cli` v3.2.0 as a blocking CI step, all re-exporting
byte-identically on unchanged input.

**The part that matters most** is the profile. It records *why* each control is in or out of a
baseline — which is what a Statement of Applicability is supposed to prove and almost never does.
When you populate `in_scope` from the organization's real SoA on day two, the defensible SoA generates itself.

> Read BUILD-ORDER.md unit B18. Read RootCawsLLC/cui-control-plane first — all eight OSCAL artifacts
> already validate against oscal-cli there as a CI gate. Do not add or modify any control record;
> this unit consumes the inventory, it does not shape it.

---

## S3 — Port the proofplane probe harness

**Why this one matters most strategically.** the organization publicly states it runs "multiple production AI
agents" on Bedrock and Anthropic Claude — an AWS ML blog post of 23 March 2026 co-authored by their
CTO. Their ISO 42001 certificate is their clearest competitive edge, and among pure-play SSPM
vendors only Obsidian also holds it.

Walking in with a working AI-agent control assurance harness is a different conversation from
walking in with a plan to build one. You already own the source.

**Deliverable:** three probes — tool allowlist, indirect prompt injection, egress destination —
running against proofplane's own instrumented target, emitting valid assertion records with paired
guarded/unguarded evidence, in CI.

**Point nothing at a production system.** You do not work there yet.

> Read BUILD-ORDER.md unit B20. Port the harness from RootCawsLLC/proofplane — the runner, the
> evidence format, the paired-run structure — so probe results become assertion records conforming
> to schemas/assertion.schema.json. Run against proofplane's own target agent only.

---

## S4 — MCP server

**Deliverable:** read-only MCP server over the control graph — `get_control`, `list_failing`,
`get_assertion_history`, `get_variance`, `health_summary`, `gap_summary`. Tested.

**Why it is worth the half day.** It means you can answer an auditor's or a customer's question from
Slack without opening the repo, and every answer still traces to the system of record rather than to
your memory. That is the difference between "I think we're covered there" and "412 of 412, measured
Tuesday."

Write the tool descriptions as carefully as you would write a `population_definition` — they are
what determines whether the right tool gets called.

> Read BUILD-ORDER.md unit B19. Read the MCP server in RootCawsLLC/proofplane first. Read-only —
> writes go through pull requests.

---

## S5 — FAIR simulation engine

**Deliverable:** `src/simulate.mjs` — PERT or lognormal sampling, 10,000 trials, loss exceedance
curve per scenario plus an aggregate, wired to ROSI so the remediation backlog ranks by loss
reduction per dollar.

**The requirement that makes it worth building now:** it must **refuse** every scenario still at
`derivation_level: assumed`, naming which parameters are uncalibrated. Build the machinery, make it
honest, and the day-45 calibration workshop produces a curve the same afternoon instead of starting
a build.

> Read BUILD-ORDER.md unit B21. Read RootCawsLLC/u-dont-grc-me — it has a working 10,000-trial
> engine. Test against a labelled fixture scenario. Do NOT calibrate anything in scenarios/.

---

## S6 — Context refresh and rehearsal

**Do this within a week of starting**, not now — the point is currency.

**Two deliverables.**

First, re-verify `.claude/skills/client-context/SKILL.md` against primary sources and report only what
changed. Watch particularly for: whether a CISO has been named, whether any new certification
appears on the trust center, and whether the subprocessor register has grown.

Second, rehearse `/intake-soc2` against a publicly available SOC 2 report — some vendors publish
redacted versions, and the AICPA publishes illustrative examples. Not for the content, which is
irrelevant. For finding out where the extraction workflow is awkward *before* you are doing it
against the organization's real report with a calendar full of introductions.

> Read .claude/skills/client-context/SKILL.md and re-verify every CONFIRMED fact against primary
> sources — trust.reco.ai, reco.ai/about-us, reco.ai/careers, the newsroom. Report only what
> CHANGED. Keep confirmed and inferred separate. If something can no longer be verified, mark it
> unverified rather than deleting it.

---

## Do not do these before day one

Each is tempting and each costs you more than it gains.

| | Why not |
|---|---|
| Write the organization-specific control records | You have not read the system description. What you write will be wrong in ways you cannot see, and you will defend it because you wrote it. |
| Populate any crosswalk | Same anchoring problem, plus it is the SCF licensing surface. |
| Calibrate a scenario | Calibration is a workshop with named humans and the organization's own data. |
| Draft policies | Policy comes after controls operate. Guard G2, not advisory. |
| Build collectors against guessed API shapes | The IdP, HRIS and training platform are all unknown. A collector written against the wrong vendor looks like progress and is worse than nothing. |

---

## What Phase 0 buys you

Roughly half of Phase 3 lands before you start. Days 61–90 then open up for the work that genuinely
needs the organization context and cannot be done early: the reconciliation pack against the closing observation
window, the attestation surface, and the management review pack.

It also changes what day one looks like. Instead of "here is my plan," it is `npm run demo` — the
machinery, working, on data that is obviously not theirs, in ninety seconds.
