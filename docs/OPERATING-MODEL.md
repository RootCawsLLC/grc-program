# Running this as one person

The honest framing: a one-person GRC program does not scale by working harder, and it does not
scale by buying a platform. It scales by inverting what a human touches.

**Exceptions route to humans. Everything else self-attests.** That inversion is the entire
productivity argument. GRC stops assembling evidence and starts working the delta.

The load-bearing metric is therefore not control count or pass rate. It is:

> **human-touch minutes per control per quarter**

Baseline it in week 2, on paper, before automating anything. If it does not fall, the automation
was theatre — and scripting evidence collection is the tutorial trap of this field. Automating
the wrong thing produces faster theatre.

## Cadence

**Daily — automated, zero human time.** Collection runs at 06:00 UTC. Assertions build. Variance
computes. New failures route to the owning team's channel and tracker, deduplicated by subject.
OSCAL emits. Nothing arrives in a GRC inbox.

**Weekly — about 90 minutes.**
- Denominator drift alarms first, before failure counts. A population that silently shrank makes
  the pass rate improve while coverage gets worse; the asset inventory failed before the control did.
- Repeat offenders: any subject failing three cycles running. These are escalated to root cause,
  not remediated again. A repeat failure is a variance-management or decision-support problem, and
  remediating it again is the most expensive way to not fix it.
- Exception register: anything expiring within 30 days.
- Everything else is left alone deliberately.

**Monthly — about half a day.**
- Refresh Variance Frequency and Variance Duration from the variance table; recompute operational
  efficacy per control.
- Re-rank the remediation backlog by ROSI. Any control whose `cost.opex_annual` is unpopulated is
  unrankable and gets flagged, not guessed.
- One page to the reporting line: what moved, what is stuck and in which FAIR-CAM segment, what
  needs a decision. Generated from the warehouse, not written from memory.

**Quarterly — about three days.**
- Management review pack for ISO 27001 Cl. 9.3 and ISO 42001 Cl. 9.3, **generated** from control
  state, variance trend, exception register and scenario results. Generated is the operative word:
  a hand-assembled review pack is three days of transcription that produces the same document.
- Restore test (`ctl.bcdr.prod.restore-test`), with elapsed time recorded as a measured value.
- Scenario re-scope: what changed in the estate that a scenario should now cover.
- Access review as a **diff** — joiners/movers/leavers from HRIS against entitlements from the IdP.
  Route only the deltas. Nobody reviews a 400-row spreadsheet honestly, and asking them to is a
  control that fails by design.

**Annually.** Risk assessment refresh with recalibration. Statement of Applicability regenerated
from the OSCAL profile rather than edited — the profile records *why* each control is in or out,
which is what an SoA is supposed to prove and usually does not. Policy set regenerated from
controls that are `operating`. Penetration test scoped from the scenario set rather than from
last year's scope.

## What stays manual on purpose

Automating these would be worse than doing them by hand:

- **Risk acceptance.** A named human accepts, with an expiry. Never an agent, never a workflow rule.
- **Efficacy parameters.** Set by a person, carrying a confidence tier. See ADR-0004.
- **Exception approval.** A PR with a named approver and a mandatory expiry date.
- **Auditor conversations.** The pipeline produces the artifact; the relationship is not an artifact.
- **The EU AI Act role determination and any high-risk classification.** A defensible analysis, not
  a mapping exercise.

## The failure modes to watch in yourself

- **Building collectors because collectors are fun.** Instrument in scenario-weight order. A
  perfectly instrumented low-consequence control is wasted capacity.
- **An exception queue nobody works.** That is a more expensive screenshot. If a routed item sits
  untouched for two cycles, the problem is ownership, not tooling, and it escalates as such.
- **Instrumenting an inherited control nobody chose.** Ask whether the control should exist before
  automating it. Architecture before automation — you cannot automate a broken process, and
  automating chaos just makes faster chaos.
- **Letting the certificate wall substitute for measurement.** the organization holds SOC 2 Type 2, ISO 27001,
  ISO 42001, CSA STAR Level 1 and more. A certification claims full coverage; the auditor sampled
  a fraction of a percent. The certificates are the floor of this program, not its ceiling.
