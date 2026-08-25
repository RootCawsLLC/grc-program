# FAIR simulation

```bash
npm run simulate                            # the calibrated fixtures
npm run simulate -- --scenarios scenarios   # the real register — refuses, and that is the point
```

## The refusal is the deliverable

Every scenario in `scenarios/` carries `derivation_level: assumed`. The engine will not simulate
any of them. Pointed at the register it names all 20 uncalibrated parameters, exits 1, and stops:

```
refusing to simulate: 20 parameter(s) across 10 scenario(s) are not calibrated.
    scn.cred-theft.cloud-admin  loss_event_frequency  [assumed, tier 1]
      UNCALIBRATED — populate at the Day-45 calibration workshop.
    ...
```

A loss exceedance curve over invented parameters looks exactly like one over calibrated
parameters — same axes, same smooth shape, same authority — and it is fiction. That is worse than
no curve, because **a curve ends the conversation**: nobody argues with a chart. Refusing keeps the
question open until a named human has done the work.

Parameters are named individually, not counted, because "3 scenarios are uncalibrated" sends
somebody hunting while a named parameter and its declared source is a workshop agenda.

On the day the workshop fills them in, `derivation_level` moves to `calibrated-estimate` or
`measured` and the curve appears that afternoon — instead of a build starting.

## Triangular, not PERT

A deliberate deviation from B21's wording.

A scenario parameter here is exactly three numbers: `min`, `most_likely`, `max`. A PERT fit needs a
fourth — the shape parameter, conventionally λ=4 — which nobody supplied and which materially moves
the tail. Adding it would manufacture confidence out of nothing, in the one file whose entire
purpose is refusing to do that.

Triangular claims no more than the three points support. The same choice, for the same reason, is
documented in `RootCawsLLC/proofplane`'s exposure module.

## Seeded, always

Every other artifact in this repo is byte-reproducible. A risk number that moved between runs would
be the one figure a reader had to take on trust — impossible to diff, commit, or argue with. One
generator drives the whole run, consumed in a fixed order, so the result is a pure function of
(scenarios, trials, seed).

## Never a bare expected value

The two fixtures exist to make one point. They have almost the same mean:

| | mean | p50 | p99 | quiet years |
|---|---|---|---|---|
| `scn.fixture.frequency-driven` | $1.08M | $924K | $3.8M | 14% |
| `scn.fixture.tail-driven` | $1.22M | **$0** | **$10.6M** | **74%** |

Same expected loss. Completely different risks. A scenario losing $10M once a decade and one losing
$1M every year are indistinguishable by mean and nothing alike in practice — which is why the
output always carries percentiles, `quiet_years`, and the exceedance curve.

The **curve** is the deliverable rather than the percentiles. A percentile answers "how bad is the
90th-percentile year"; the curve answers "how likely is a year worse than X", which is what a
risk-acceptance decision actually turns on.

## The aggregate assumes independence, and says so

Losses are summed **across scenarios within each simulated year**, and percentiles taken of that
total. Not summed from per-scenario percentiles — that is a different and wrong number, because it
implicitly assumes every scenario has its bad year simultaneously.

Independence is itself an assumption and often a false one: a credential-theft event and a
tenant-boundary event may share a root cause. Correlated scenarios produce a fatter tail than this
reports. The statement travels in the output rather than living in a doc nobody reads alongside the
number.

`confidence_tier` propagates as the **minimum** across parameters. Averaging would let a tier-4
parameter launder a tier-1 one.

## ROSI: nothing is rankable, and that is accurate

Two inputs are genuinely missing from this repo, and neither is guessed:

1. **Control efficacy.** Nothing in `schemas/control.schema.json` or `schemas/scenario.schema.json`
   records how much a control reduces frequency or magnitude. Without it there is no ALE-after, so
   there is nothing to divide. `rankByRosi()` takes `efficacy` from its caller and will not invent
   one — see [ADR-0004](adr/0004-agents-do-not-evaluate-efficacy.md): an agent may not conclude how
   well a control works.
2. **Annual cost.** All nine controls carry `cost.opex_annual: 0` with a `PLACEHOLDER` basis.
   `rosi()` in `src/faircam.mjs` already refuses to divide by it — ROSI at zero cost is *undefined,
   not infinite*.

So every control comes back unrankable today, each with its specific reason. That is the accurate
state of the inventory rather than an engine failure, and it is the work list: price the controls,
and record efficacy with a named source.

Supply both and it ranks — there is a test that proves it does.
