# ADR-0006 — The variance quality ladder is unreachable, and the demo says so out loud

**Status:** accepted · **Date:** 2026-08-21

## Context

`models/variance/variance_events.sql` documents a three-rung quality ladder for
`variance_started_at`, best first:

| rung | basis | meaning |
|---|---|---|
| `source-timestamp` | the source system's own change timestamp | when the variance actually began |
| `interpolated` | the previous passing snapshot | bounded by the collection interval |
| `equals-detected` | detection time itself | **understates** duration, must be declared |

It selects the rung with `coalesce(first_observed, lag(as_of) over (...), as_of)`.

Building the warehouse skeleton (B22) and running three cycles of synthetic history made something
visible that reading the SQL did not: **rungs two and three can never be reached.** The control
model upstream ends with

```sql
coalesce(p.access_key_1_last_rotated, p.principal_created_at) as first_observed
```

and `principal_created_at` is never null for a principal that exists. So `first_observed` is always
non-null, the `coalesce` in the variance model always takes its first branch, and
`started_at_quality` is always the string `source-timestamp` — including in the cases the ladder
was written to catch.

The consequence is not cosmetic. In the fixture set, `erin` loses her MFA device between the
2026-06-15 and 2026-07-15 cycles. AWS reports that as a state with no accompanying timestamp, so
`first_observed` falls through to her account creation date in April 2025. The pipeline then
reports:

```
444455556666:erin   [STILL OPEN]
  started 2025-04-19  →  detected 2026-07-15  →  touched 2026-07-28  →  closed —
  control monitoring 452d   treatment selection 13.7d
  started_at quality: source-timestamp
```

452 days of detection latency, of which roughly 30 are real. Labelled with the *highest*
confidence rung. That number flows into Variance Duration, into Loss Event Frequency, and out into
a risk figure someone will eventually put in front of a board.

An overstatement is not the safe direction to be wrong in either. It makes control monitoring look
like the failing FAIR-CAM function when the real failure was elsewhere, which is precisely the
misdirection the four-timestamp decomposition exists to prevent.

## Decision

**Do not fix it in B22.** The fix belongs in the control model's `first_observed` expression, and
changing that changes what the control asserts about every subject. B22's governing constraint is
that no control record changes status and nothing gets instrumented; a semantic change to a control
model is exactly the line that unit is not allowed to cross. It also cannot be validated properly
against fixtures — the correct behaviour depends on which AWS fields carry real change timestamps,
which is an empirical question about a live estate.

**Detect it and say so.** `scripts/demo.mjs` flags any event whose `variance_started_at` precedes
the most recent cycle in which the subject was observed *passing*. That is not a slow detection; it
is an impossible timestamp, and it is cheap to spot without knowing anything about the source
system. The warning names this ADR.

**Do not derive efficacy from this field until it is fixed.** `operationalEfficacy()` in
`src/faircam.mjs` already downgrades a result to an upper bound when `variance_started_at` equals
`variance_detected_at`. It has no equivalent guard for the opposite error, which is the one that
actually occurs here.

## Consequences

- Every `started_at_quality` value currently in the repo reads `source-timestamp` and none of them
  should be trusted on that basis alone. The demo's warning is the only thing distinguishing them.
- The real fix is a candidate for B1 (warehouse and staging models against live telemetry), where
  the question "which AWS fields carry a genuine change timestamp" can be answered by looking
  rather than guessing. It needs a per-control declaration of what `first_observed` means, which is
  a control-record change and therefore a reviewed one.
- A related and separate limitation surfaced at the same time: `decomposeVariance()` refuses an
  event that is still open, because a total duration is meaningless before the clock stops. That is
  correct as far as it goes, but it means the only fully decomposable events are the ones already
  remediated — and the slowest failures are exactly the ones still open. Deriving efficacy from
  closed events alone is survivorship bias. `scripts/demo.mjs` decomposes open events as far as
  their endpoints allow and leaves the implementation segment null rather than measuring it to the
  current time, which would report a number that grows on its own every time the pipeline runs.
