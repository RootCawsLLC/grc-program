# MCP server over the control graph

Ask the inventory a question from a Claude conversation, and get an answer that traces to a file in
this repo rather than to somebody's memory.

```bash
npm run mcp
```

## Wiring it into Claude Code

```bash
claude mcp add grc-program -- node C:/Users/Administrator/agent-workspace/grc-program/src/mcp/server.mjs
```

The path must be absolute. The server reads the repo it is run from, or `RECO_GRC_ROOT` if set.

## Read-only, enforced three ways

Writes go through pull requests. That is guardrail 2 and it is not negotiable — the merge **is** the
control, and a model that can write to `controls/` has removed the only human step in the chain.

1. Every tool declares `effect: 'read'`, and the effect is surfaced in the description a model sees.
2. `assertReadOnly()` **refuses to start the server** if any registered tool declares anything else.
3. A test exercises every tool and then asserts `git status --porcelain` is unchanged.

The third is the one that would actually catch a regression, because it tests behavior rather than
a label. The first two are only as good as the label somebody typed.

## The tools

| tool | answers |
|---|---|
| `get_control` | the full record for one control, as committed |
| `list_controls` | the inventory, filtered by status / layer / owner |
| `list_failing` | every failing subject, fully enumerated, with unmeasured controls kept separate |
| `get_assertion_history` | the time series behind one control |
| `get_variance` | variance episodes derived from that history |
| `get_findings` | audit findings, and how many map to no control |
| `health_summary` | control health as a classification, never a score |
| `gap_summary` | the four gap directions |

## The descriptions are part of the control

B19 asks for these to be written as carefully as a `population_definition`, and for the same reason:
a description is not documentation, it is what decides whether the right tool gets called and how
the answer is read.

So each one states what the answer covers, what it **excludes**, and what it must not be taken to
claim. "412 of 412" and "412 of 412, measured Tuesday, against a population that omits contractors"
are different sentences, and only one of them is safe in front of an auditor.

Three distinctions the descriptions are built around:

- **`status` is not a measurement.** It is a lifecycle state a human set. `get_control` says so, and
  when there is no assertion it says that too, in the answer.
- **Unmeasured is not passing.** `list_failing` reports controls with no assertion under a separate
  `unmeasured` key. Folding them into a zero would be a fabrication, and it is the most common way
  this question gets answered wrongly.
- **Health is a classification.** Bands are ordinal, ordinal values never enter arithmetic, and
  averaging them would manufacture a number with no meaning that would then reach a board.

## Every answer carries its provenance

```json
"_source": {
  "repo": "C:\\Users\\Administrator\\agent-workspace\\grc-program",
  "files": ["fixtures/assertions.json", "controls/"],
  "evidence_is_fixture": true,
  "warning": "NOT REAL EVIDENCE. The assertion set loaded here is synthetic..."
}
```

`evidence_is_fixture` is the same flag the pipeline and the probe harness set. If the loaded
assertion set is synthetic, every answer says so — the stamp travels here exactly as it travels into
OSCAL. An answer that cannot be traced back to a file is the "I think we're covered there" this
server exists to replace.

## What `get_variance` does not know

Three of the four FAIR-CAM timestamps are derivable from assertion history alone:
`variance_started_at` (the source system's own `first_observed`), `variance_detected_at` (the
collection that first saw it), and `remediation_completed_at` (the collection that first did not).

**`remediation_started_at` is not.** It comes from the ticketing system and is not in an assertion
record, so it is returned as `null` and the answer says why. Without it the middle segment collapses
and a prioritization failure becomes indistinguishable from an implementation failure — the exact
misreading the four-timestamp decomposition exists to prevent. The full join lives in
`models/variance/variance_events.sql`.

An episode still open is reported as open, with a null duration, rather than measured to now — which
would return a number that grows by itself on every call.

## stdout is the protocol channel

Anything written to stdout that is not JSON-RPC corrupts the stream, and the failure looks like a
broken server rather than a stray `console.log`. All logging goes to stderr.
