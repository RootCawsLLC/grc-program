# Agent topology

Flat, not hierarchical. Each agent gets its context pushed per task; none of them read a shared
state file. Hierarchical delegation and shared context files burn context windows re-reading
state that the orchestrator already holds, and in this domain the system of record is the control
repo and the warehouse — not the filesystem, and not an agent's working memory.

## Three guardrails, hard-coded and non-negotiable

**1. Every output carries a derivation level.** `measured`, `derived`, `calibrated-estimate`, or
`assumed`. An unlabelled number is rejected at the PR gate. This is what stops a plausible
sentence from becoming an audit assertion.

**2. A Git pull request is the only path to normative.** No agent writes to `controls/`,
`policies/`, or any auditor-facing surface directly. Agents open PRs. A human merges. The merge
is the control, and it is reviewable as a diff.

**3. No agent evaluates control efficacy.** Ever. An agent may run a probe and record what
happened. It may not conclude that a control works. The relationships between control state and
loss are too context-sensitive, and the training data to learn them does not exist. Treat any
vendor claim of AI-driven control-efficacy analytics — including claims made by tools we buy —
as an extraordinary claim requiring extraordinary evidence.

The general form: **the LLM is the interface to the analysis, not the analyst.**

## Dispatch is a function, not a layer

`orchestrator` is not a parent. Hierarchical CISO → router → SME → worker trees burn context
re-reading state the session already holds, and they create a place for a model to "sign off" on
risk. Both are refused here.

`route --dispatch` wraps **new** failing subjects (and a held denominator) as those
envelopes via `src/from-route.mjs`. Continuing subjects stay silent — that rule is not
re-derived here. `--pack` hydrates each specialist's `input_pack` from the read-only
MCP tools and writes one file per agent under `out-synthetic/packs/` (fixtures) or
`.warehouse/packs/` (real). `--draft` turns those packs into payloads: a Linear
`save_issue` body, an evidence package, a scenario stub, or a questionnaire
answer. Drafts are not posted. A CVE match is redirected as a control
deficiency rather than calibrated. Design-time specialists still need a
session — this host will not write `controls/`, `policies/` or `scenarios/`.

Inbound events go through `planDispatch` in `src/orchestrate.mjs`. The function names the
specialist, packs a per-task `input_pack` (no shared state file), and states whether a human
gate is required. Mechanical refusals — unlabelled numbers, model self-scores, efficacy
conclusions, normative writes — are implemented in code. The agent file
(`.claude/agents/orchestrator.md`) is the interface to that plan.

A proposed merge, risk acceptance, exception approval or cloud write freezes and pages a human
through `src/gate.mjs`. The presenter (Slack / GitHub / Linear) records consent.
Opened gates are appended to `.warehouse/gates.json` so a later process can decide the same
`gate_id` — including `gate --interaction` on a Slack `block_actions` payload. A Slack
`user.id` is not a `per.*` actor: `--actor` or `--map` joins it explicitly, and
`src/inbound.mjs` verifies the Slack signing secret when `--signed` is passed,
and the GitHub webhook HMAC when `--signed-github` is passed. Slack keys are
`U…` user ids; GitHub keys are numeric account ids. Usernames and logins are
not identity. Unmapped users are refused. There is no HTTP listener.
`src/present.mjs` posts only after a confirmed contract (currently false) and named
credentials; a successful post still leaves `executed` false (ADR-0009). Merging is still
a human on GitHub, risk acceptance is still a named `per.*` on a PR with an expiry, and a
cloud write is acknowledge-only.
Opening a PR or a Linear item is draft. Merging is the control. Synthetic and real gates do not
share a log.

## Design-time agents — run when the inventory changes, output is a PR

| Agent | Input | Output | Never |
|---|---|---|---|
| `requirement-decomposer` | a framework clause | candidate control records, layer-split, with a decomposition rationale | merge; assert a mapping is complete |
| `crosswalk-mapper` | control record + SCF release | `crosswalk` block with relationship types preserved | vendor framework text into the repo (ADR-0003) |
| `test-author` | control record | a draft dbt model whose WHERE clause matches `population_definition` | claim the test is correct without a run against real data |
| `policy-generator` | control records with `status: operating` | policy sections derived from `population_definition`, `title`, owner and live `failing[]` | generate for any control not yet operating (blocked by guard G2) |

## Run-time agents — run every cycle, output is a queue item or a draft

| Agent | Input | Output | Never |
|---|---|---|---|
| `exception-triage` | new `failing[]` entries | routed work item with owner, scenario affected, days failing | close an item; approve an exception |
| `attestation-writer` | assertion records | customer-questionnaire and trust-center answer text, generated from measured state | answer from a static document when a measured control exists |
| `scenario-scoper` | an incident or a new product surface | a scenario in taxonomy grammar with empty, provenance-stamped parameters | populate the parameters |
| `evidence-scout` | an auditor request | the assertion, the query, the lineage, and the time series | produce a screenshot |
| `orchestrator` | an inbound event envelope | a dispatch plan: specialists, packed inputs, optional human gate | hold shared state; merge; accept risk; conclude efficacy |

`attestation-writer` is the one with revenue attached. Trust-center and questionnaire answers
generated from continuously measured controls rather than from static PDFs is the difference
between "we have a policy that says X" and "here is X, measured across 47 of 47 principals as of
Tuesday." That is a materially better answer to an enterprise security review, and it is the
same artifact the auditor already accepted.

## Tooling

- **Claude Agent SDK / Claude Code** with skills for the design-time set. The skills carry the
  vocabulary and the standing positions so the same rules apply whether a human or an agent is
  drafting.
- **An MCP server over this repo** exposing the control graph read-only: `get_control`,
  `list_failing`, `get_assertion_history`, `get_variance`. Read-only is the point — writes go
  through PRs.
- **Cursor** for the SQL and collector work, where a fast edit loop against a real warehouse
  beats a conversation.
- Scytale publishes open-source Claude skills at `github.com/scytale-labs/GRC-Claude-Skills` —
  framework knowledge packs, vendor-neutral. They are reference knowledge and do not touch the
  Scytale tenant, but they are free and they are our own platform vendor's. Worth evaluating
  before writing framework skills from scratch.
