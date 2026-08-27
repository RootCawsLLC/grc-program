# ADR-0002 — Do not re-cut controls inside an open SOC 2 observation window

**Status:** accepted · **Date:** 2026-08-21

## Context

the organization's SOC 2 bridge letter covers **1 December 2024 – 30 November 2025**. Bridge letters
conventionally run forward from the report period end, so the Type 2 observation window almost
certainly runs **1 December – 30 November**. *This is inferred, not confirmed — the report period
itself is behind the trust-center NDA gate. Confirming it is a day-one task, and if the window is
different, the entire phasing in `PROPOSAL.md` shifts with it.*

If that inference holds, a start around 1 September puts **day 90 within days of the observation
window closing**. That is the worst possible moment to restructure a control inventory.

The failure mode is specific and expensive. Splitting one control into four mid-window means the
auditor tests a control that existed for part of the period and did not exist for the rest.
Evidence for the old shape stops; evidence for the new shape has no history. The most likely
outcome is a scope qualification or a deferred opinion, and the second most likely is a large
volume of unplanned manual work to reconstruct continuity — for a company whose customers read
that report before signing.

## Decision

**Instrument in parallel; change nothing normative until the window closes.**

- **Days 1–90.** The control repo is built alongside the live program, not on top of it. Every
  control record carries `status: building` or `planned`. Assertions accumulate history. Nothing
  is pushed to Scytale as the operative record, no control in the audited inventory is renamed,
  merged or split, and no policy is republished.
- **At window close.** Reconcile: for every control the auditor tested, show the pipeline's own
  measurement across the same period. Where they agree, that is the argument for cutover. Where
  they disagree, that is a finding worth more than the cutover.
- **Day 91 onward.** Cut over at the start of the fresh window, so the new control shapes have
  full-period evidence from day one of the period they will be tested against.

## Consequences

Ninety days of running two things at once, which is real cost and should be stated as such rather
than hidden. In exchange, the first audit under the new architecture has clean, full-period
evidence, and the current audit is not disturbed by the rebuild.

Parallel running also produces the single most persuasive artifact available for the cutover
conversation: a period where both the manual program and the pipeline measured the same controls,
and a diff between them.

The ISO 27001 and ISO 42001 surveillance cycles sit on their own certificate dates and are **not**
governed by this freeze. Confirm those dates in week 1 — they may permit earlier movement on the
AI governance controls, which is where the differentiated work is.
