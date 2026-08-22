---
name: control-health
description: The control health deficiency catalogue, what each code means, and why the output is a classification rather than a score. Load when interpreting `npm run health` or deciding what to fix first.
---

# Control health

`src/health.mjs` emits a **classification**, never a score. That is a deliberate design constraint,
not an omission.

## Why there is no score

Ordinal values are not ratio values — a maturity 5 is not five times a 1 — so averaging control
ratings produces a number that cannot validly enter arithmetic. And the moment such a number
exists, someone divides by it, puts it in a board pack, and it becomes a target.

A maturity score is also not a proxy for risk reduction. Only a minority of framework subcategories
act on loss events at all; most affect decisions *about* controls. A programme can raise its
average maturity while its actual exposure is unchanged.

So the output is: named deficiencies per control, counts by deficiency across the inventory, and
band membership. All three are actionable. None of them is arithmetic. If asked for a single
number, explain this rather than computing one.

## The bands

| Band | Meaning |
|---|---|
| `instrumented` | Evidence is a query over a defined population, current, and variance is measurable. |
| `attested` | Evidence exists but is attestation-grade, manual, or variance-blind. Real, but not measurable. |
| `declared` | A control record exists. No evidence has ever been produced against it. |
| `aspirational` | Planned or building, with no evidence and no committed date. |

Most programmes that pass audits comfortably are almost entirely `attested`. That is the finding,
and it is not a criticism of the people who built it — it is what the tooling of the last decade
optimised for.

## The deficiency catalogue

| Code | What it means, and what it actually costs you |
|---|---|
| `H1-no-evidence` | The control is a claim. Until a query exists, "we have this control" is a sentence, not a measurement. |
| `H2-stale` | Collection is behind its declared cadence by more than 2×. Either the collector broke or the declared cadence is aspirational. Fix one or the other; do not leave the declaration lying. |
| `H3-tier-floor` | Confidence tier ≤ 2. Attestation or screenshot grade. Works for an auditor, produces nothing for risk. |
| `H4-population-vague` | The prose denominator has no quantifier. If you cannot write the denominator you cannot measure the control — and the `WHERE` clause and the prose will drift without anyone noticing. |
| `H5-variance-blind` | `variance_started_at` equals detection time. **Variance Duration is systematically understated and every efficacy figure derived from it is an upper bound, not an estimate.** Label it as such wherever it appears. |
| `H6-owner-is-a-person` | Person-owned controls die when the person changes role. Owners are teams. |
| `H7-unpriced` | No scenario joins to it, so it cannot be ROSI-ranked and cannot be defended against "why this and not that". |
| `H8-uncosted` | `cost.opex_annual` unpopulated. ROSI is **undefined**, not infinite. |
| `H9-manual` | Legitimate. But in a one-person programme human attention is the scarce resource, so manual controls are the budget. Count them deliberately rather than letting them accumulate. |
| `H10-policy-orphan` | Operating with no generated policy. |
| `H11-open-finding` | An assurance activity raised something against this control and it is still open. |
| `H12-planned-indefinite` | Planned, no evidence, no date. Either commit or retire it — an inventory full of indefinite plans overstates coverage to everyone who reads it. |

## Reading a run

The two numbers that matter most:

1. **`declared` + `aspirational` as a share of the inventory.** This is the honest coverage figure,
   and it is usually far below the framework coverage number the platform reports.
2. **`H9-manual` count.** This is the recurring human cost. In a one-person programme it is the
   constraint everything else is subject to, and it should trend down every quarter or the model
   does not work.

`H5-variance-blind` deserves separate attention because it is invisible in every other view: those
controls look fine, produce evidence, satisfy the auditor, and quietly make the risk layer wrong.
