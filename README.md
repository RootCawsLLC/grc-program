# reco-grc

**The control inventory, evidence pipeline and risk layer for Reco's GRC program.**

This repository is the system of record. Scytale, the trust center, every framework baseline and
every OSCAL package are projections of what is in here.

> ⚠️ **This repo must be private.** It will hold extracted audit findings, control state and
> exception detail. Audit source documents never enter it at all — `intake/source/` is gitignored.

---

## 👉 Starting at Reco? Open [`docs/SOP-DAY-ONE.md`](docs/SOP-DAY-ONE.md)

That is the checkbox procedure for your first day — machine setup, the eight access requests with
paste-ready text, the ownership question, and the baselines nobody else will take. Follow it line
by line.

**Haven't started yet?** [`docs/PREP-PLAN.md`](docs/PREP-PLAN.md) is six sessions of work you can
give Claude Code today — all machinery, none of it requiring Reco access.

Everything below is reference. Those two are the things you actually do.

---

## Quick start

```bash
git clone <this-repo> reco-grc && cd reco-grc
npm ci
npm test           # 75 tests
npm run baseline   # intake + control health + gap assessment
```

Then open Claude Code **in the repo root** and run `/week-one`.

**On Windows, read [`docs/SETUP.md`](docs/SETUP.md) first** — execution policy, long paths and line
endings all need setting, and the line-endings one is a correctness issue rather than a cosmetic
one.

The first `npm run baseline` looks bleak: 9 controls, 1 instrumented, 117 gaps. That is correct. It
shows you the shape of the output, not the state of the company — none of those controls are Reco's
yet.

---

## Where to start

| If you are… | Read |
|---|---|
| **Not started yet, want to build now** | **[`docs/PREP-PLAN.md`](docs/PREP-PLAN.md)** — six sessions, ~4 days, all doable before day one |
| **On your first day** | **[`docs/SOP-DAY-ONE.md`](docs/SOP-DAY-ONE.md)** — the checkbox procedure |
| Understanding why the week is ordered that way | [`docs/DAY-ONE.md`](docs/DAY-ONE.md) — the narrative behind the SOP |
| Setting up a machine | [`docs/SETUP.md`](docs/SETUP.md) — Windows needs four things |
| Deciding what to build next | [`BUILD-ORDER.md`](BUILD-ORDER.md) — 22 units, five phases. **Phase 0 is buildable before day one.** |
| Presenting the plan | [`PROPOSAL.md`](PROPOSAL.md) — the 30/60/90 and the reasoning |
| Checking a claim I made | [`VERIFICATION.md`](VERIFICATION.md) — confirmed vs corrected vs unverifiable |
| Wondering why something is shaped this way | [`docs/adr/`](docs/adr/) — five decisions |
| Running the program week to week | [`docs/OPERATING-MODEL.md`](docs/OPERATING-MODEL.md) — the one-person cadence |
| Blocked on a fact | [`docs/DISCOVERY.md`](docs/DISCOVERY.md) — 17 open questions, 6 of them blocking |

---

## Why the system of record is here and not in the platform

Scytale publishes no API reference — no developer portal, no OpenAPI document, no object model, no
documented webhooks. The only confirmed programmatic surface is Custom Integrations, which is
push-only. A system of record you cannot read from is a system of record you do not own.

So this repo produces the evidence and Scytale renders it for the auditor. Replacing the platform
later becomes a rewrite of `src/push/scytale.mjs` rather than a program.
See [ADR-0001](docs/adr/0001-scytale-is-a-sink.md).

---

## Commands

```
npm run baseline   intake + health + gap, in reading order. Start here.
npm run validate   schema-check the inventory and run the nine guards
npm run intake     validate extracted audit findings, reconcile against the inventory
npm run health     control health as a classification          [-- --detail] [-- --json]
npm run gap        four-direction gap assessment  [-- --direction remediation|risk|assurance|coverage]
npm run oscal      OSCAL assessment-results, deterministic UUIDs
npm run push:dry   build the Scytale payload without sending
npm test           75 tests
```

`npm run oscal` twice produces a byte-identical file. That is the point, and CI gates on it.

**The `--` separator is easy to lose.** `npm run gap --direction risk` silently gives you the
unfiltered output while you believe you filtered it. Always `npm run gap -- --direction risk`.

---

## Layout

```
controls/     one YAML file per control. Layer-split, house IDs, never renamed in place.
scenarios/    FAIR loss event scenarios. Read _CALIBRATION-STATUS.md before quoting any number.
exceptions/   control changes with a mandatory expiry, not escape hatches
intake/       source/ is gitignored (NDA-gated audit reports); extracted/ is committed
reference/    requirement index — identifiers only, 38 SOC 2 + 93 ISO 27001 Annex A
schemas/      control, assertion, exception, scenario, finding, gap
models/       dbt — one model per control_id. The model IS the evidence.
src/
  collectors/ full-state extractors, each with a CSV inbox fallback
  oscal/      OSCAL emission, deterministic RFC 4122 v5 UUIDs
  push/       the Scytale adapter — refuses to send until the contract is confirmed
  faircam.mjs reliability, operational efficacy, variance decomposition, ROSI
  health.mjs  control health classification
  gap.mjs     four-direction gap assessment
  intake.mjs  audit finding reconciliation
docs/         SOP, setup, day one, operating model, discovery questions, agent topology, ADRs
.claude/      agents, commands, skills and the validation hook. CLAUDE.md is in the root.
```

---

## Claude Code is set up from clone

`CLAUDE.md` carries the standing positions, the vocabulary and the three guardrails. It loads
automatically.

**Slash commands** — `/baseline` · `/week-one` · `/intake-soc2` · `/new-control`

**Subagents** — `requirement-decomposer` · `crosswalk-mapper` · `test-author` · `policy-generator` ·
`evidence-scout` · `scenario-scoper` · `exception-triage` · `attestation-writer`

**Skills** — `reco-context` (established facts, confirmed and inferred kept separate, so you never
re-derive them) · `soc2-report-anatomy` (how to read the report you will spend day two on) ·
`control-health` (the deficiency catalogue)

**A hook** (`.claude/hooks/validate-on-change.mjs`) runs the guards after any edit to the inventory
and blocks on failure. It is Node rather than a shell script so it runs identically on Windows,
macOS and Linux — and it is itself tested, because two bugs during the build made it *fail open*.
Do not disable it: a guard violation caught in the same turn is a correction; the same violation
caught in CI three commits later is a debugging session.

---

## The rules this repo will not break

Guards in `src/validate.mjs`, enforced by CI and by the edit hook. They are exit codes rather than
paragraphs in a runbook nobody reads.

| Guard | Rule |
|---|---|
| G1 | Control IDs are unique and never reused. A rename is a new ID plus a `supersedes` edge. |
| G2 | **Policy last.** A `policy_ref` on a control that is not `operating` fails the build. |
| G3 | Exactly one primary FAIR-CAM function. Zero means unmeasurable; two means the layer split is wrong. |
| G4 | A control with no scenario is unpriced. Warn, and reject dangling references. |
| G5 | `query_ref` points at a real `.sql` model. The model is the evidence. |
| G6 | An operating control with no cost cannot be ROSI-ranked. ROSI is undefined, not infinite. |
| G7 | A manual procedure cannot claim source-timestamp variance quality. |
| G8 | An exception with no expiry, or a past one, is an undocumented control change. Rejected. |
| G9 | Every scenario parameter carries provenance, and ranges may not be inverted. |
| CI | No framework text in `controls/` or `reference/`. Identifiers only — [ADR-0003](docs/adr/0003-no-framework-text.md). |

Intake adds seven more (F1–F7), including: risk acceptance requires a named person and an expiry,
and an ISO nonconformity without a clause reference cannot be closed out.

Three guardrails live in the agent layer and are not automatable: every agent output carries a
derivation level, a pull request is the only path to normative, and **no agent evaluates control
efficacy**. See [ADR-0004](docs/adr/0004-agents-do-not-evaluate-efficacy.md).

---

## What is real here and what is scaffolding

Stated plainly so nobody mistakes one for the other.

**Real and tested (75 tests)** — FAIR-CAM efficacy math, including a test documenting where the
exact arithmetic diverges from a commonly circulated worked example and why we do not round
intermediates; deterministic UUID generation, verified against the RFC 4122 v5 test vector; the
assertion builder and its exception handling; denominator drift detection; all nine inventory guards
and all seven intake guards; OSCAL emission and its determinism; control health classification;
four-direction gap assessment; the Scytale payload shape and its refusal to send unconfirmed; and
the validation hook itself, across relative, POSIX-absolute and Windows-backslash paths.

**Scaffolding, clearly marked** — the four collectors take an injected client and are written against
the API shapes, but have not been run against live credentials. Two dbt models are worked examples;
the staging models they reference are deliberately absent rather than stubbed, because an empty stub
returning no rows would make `dbt run` succeed while proving nothing. `fixtures/assertions.json` and
`intake/extracted/EXAMPLE-*` are synthetic and labelled.

**Deliberately empty** — every `cost.opex_annual` is zero with a `PLACEHOLDER` basis, and every
scenario parameter is `derivation_level: assumed` at confidence tier 1. Those are not omissions.
Guessing a cost produces a ROSI ranking that looks authoritative and is arbitrary; an `assumed`
range with a confident-looking min/most-likely/max is the exact failure mode FAIR exists to prevent.
They get filled from Reco's own data, by a named human, in weeks 2 and 6.

[`BUILD-ORDER.md`](BUILD-ORDER.md) turns each of these into a prompt.

---

## Licensing

Framework identifiers only; no normative text from any standard. SCF is resolved at runtime from a
local release and never vendored — it is CC BY-ND 4.0 and its terms explicitly prohibit using AI to
generate derivative content from it. FAIR-CAM and FAIR-MAM are CC BY-NC-ND 4.0; `src/faircam.mjs`
implements the published formulation for internal use and does not redistribute or remix the models.
Attribution: <https://fairinstitute.org/FAIR-CAM/>.
