# Day one — the reasoning

> **Following this on the actual day? Use [`SOP-DAY-ONE.md`](SOP-DAY-ONE.md) instead.** That is the
> checkbox procedure: numbered steps, paste-ready access-request text, expected results, and what to
> do when something fails. This document explains *why* the order is what it is — read it the
> weekend before, not at 9am on the day.

You have a new laptop, no credentials to anything, and a calendar that will fill up by Wednesday if
you let it. The goal for week one is not to build. It is to **establish the baseline before anyone
tells you what the baseline is**, and to get the six blocking questions answered while you are still
new enough that asking them is normal.

---

## Before you start: the trap

The strongest pull in week one is toward the thing that feels like progress — writing controls,
mapping frameworks, closing coverage gaps. Coverage gaps are the easiest thing in this repo to
grind on and the least urgent. Resist it.

The order that matters is: **remediation, then risk, then assurance, then coverage.** Remediation
has someone else's deadline. Risk is about loss. Assurance makes the rest measurable. Coverage is
the one you can count, which is exactly why it attracts effort it does not deserve.

`/week-one` in Claude Code will tell you off if you drift. Let it.

---

## Hour 1 — get the machine working

**Do [`docs/SETUP.md`](SETUP.md) first.** On Windows it is four things — execution policy, long
paths, line endings, Node version — and skipping any of them costs you an hour later. On macOS or
Linux it is one command.

```bash
git clone <your-reco-repo> reco-grc && cd reco-grc
npm ci
npm test           # 75 tests. If these do not pass, stop and fix that first.
npm run validate   # 0 errors, 0 warnings
npm run baseline   # intake + health + gap against the seed inventory
```

That last command runs against nine seed controls and ten seed scenarios, none of which are Reco's
yet. It will look bleak — that is correct. It is showing you the shape of the output, not the state
of the company.

Open Claude Code in the repo. `CLAUDE.md`, eight subagents, four slash commands and three skills
load automatically. Confirm with `/week-one`.

**Also hour 1, before you forget:** file the access requests. They have the longest lead time of
anything you will do this week and nothing in Hour 4 onward works without them.

| Access | For | Scope |
|---|---|---|
| Scytale | the platform of record today | admin, plus whoever owns the contract |
| Trust center (SafeBase) | the published surface | admin |
| The SOC 2 report, ISO certs, SoA, pentest report | week-one intake | just read them; do not commit them |
| AWS | `ctl.iam.cloud-platform.mfa` | **read-only, OIDC, no long-lived keys** |
| Identity provider | `ctl.iam.enterprise-sso.mfa` | read-only: users, factors |
| GitHub org | `ctl.appsec.ci-cd.branch-protection` | read-only: repo + org admin read |
| HRIS | `ctl.people.workforce.security-training` | read-only roster, **all three entities** |
| Reco tenant (the product) | ADR-0005 dogfooding | admin on an internal tenant |

Ask for read-only everywhere and say why unprompted: the pipeline that measures
`ctl.iam.cloud-platform.mfa` does not get to violate it. That sentence buys you more credibility
with a platform team than anything else you will say in week one.

---

## Hours 2–4 — read the SOC 2 report end to end

Not skim. Read it.

Load the `soc2-report-anatomy` skill (`/intake-soc2` pulls it in) and work in this order:

1. **Section 1.** Write down the exact report period. This settles the observation-window question
   that gates the entire 30/60/90 phasing in `PROPOSAL.md`. Also: the TSC categories actually in
   scope, the audit firm's name, and whether the opinion is unqualified.
2. **Section 4.** Every exception and deviation, verbatim, into `intake/extracted/`. Note the sample
   sizes as you go — every `n=25` against a population of several hundred is a line in your business
   case, stated in the auditor's own words rather than yours.
3. **Section 3.** The system description. This is the closest thing to an existing control inventory
   Reco has. Read it to learn what the current control model actually is, and flag every narrative
   that reads as layer-munged. Those are your split candidates for day 91 — **not before**.
4. **Subservice organisations.** Compare carve-outs against the five published subprocessors. A
   mismatch is a real finding and it is one you can raise in week one without stepping on anyone.

```bash
npm run intake      # validates the extraction, reconciles against the inventory
npm run gap -- --direction remediation
```

**The number to watch: open findings that map to no control.** Each one is the sharpest available
evidence that the control model has a hole — the auditor found something the inventory has nowhere
to put.

---

## Day 2 — the ISO documents

The **Statement of Applicability** populates `in_scope` in `reference/requirement-index.yaml`. Until
it does, every coverage number in this repo is undetermined, and `npm run gap` says so out loud
rather than quietly reporting zero. Do this before you report any coverage figure to anyone.

Then the **ISO 27001 and ISO 42001 certificates**: certification body, certificate numbers, issue
and expiry dates, next surveillance dates. Two reasons this matters more than it looks. The ISO
surveillance cycles run on their own clock and are **not** governed by the SOC 2 observation-window
freeze — they may permit earlier movement on exactly the AI governance work that is most
differentiated. And once you have the CB name, verify the certificates in that body's own registry.
That could not be done from outside; it takes ten minutes from inside.

The ISO 42001 audit report gets the same treatment as the SOC 2. Nonconformities carry clause
references — keep them; `F7-unclaused-nonconformity` will tell you when you have not.

---

## Day 3 — the ownership question

Ask, plainly and early: **who owns the ISMS and AIMS management review today?**

ISO 27001 Clause 9.3 and ISO 42001 Clause 9.3 both require top-management review. Reco announced its
first CISO in June 2024; that person is no longer on the leadership page and holds a role elsewhere,
and the June 2026 seven-leader expansion named no successor. If nobody currently owns it, that is a
nonconformity waiting to be raised at the next surveillance audit.

It costs nothing to fix now and a great deal to fix in front of an auditor. Week one is also the
only time you can ask it without it sounding like a criticism of a predecessor.

Also day 3, and cheap: **start the Scytale conversation.** Three questions in writing, from
`docs/adr/0001-scytale-is-a-sink.md`:

1. Which objects are readable via GET, under what auth, at what rate limit, on which tier — and are
   there webhooks on control-state change?
2. What does bulk evidence export produce, and does collection metadata survive it?
3. Will the order form carry a no-unilateral-suspension clause, a renewal uplift cap, and numeric
   AI-agent quotas rather than "Limited"?

Their answer to the first determines whether an owned pipeline can reconcile against Scytale or has
to run fully parallel. Ask now; procurement answers take weeks.

---

## Day 4 — the two visible findings

Both are cheap, both are real, and both are better raised by the new person in week one than
discovered by a customer in month three.

**The published RTO is 5 days.** For a security vendor selling to Fortune 500 and to a health
system, that is outside what enterprise procurement typically accepts, and it may be inconsistent
with availability terms already signed. Two separate things: is that the measured capability or a
conservative placeholder nobody revisited, and how does it compare to executed MSAs? If the real
capability is materially better, republishing it is a same-week revenue-facing win that costs
engineering nothing. If it is not, it belongs in the risk register with a quantified scenario
attached — `scenarios/scn.availability.prod-data-loss.yaml` is already scoped for it.

**Four different integration counts are live simultaneously** — 270+, 260+, 235+ and 215+ across
the site navigation, the about page, and press releases still on the newsroom. For a company
certified to ISO 42001 and publishing AI Act materials, a defensible-claims process sits inside the
management system's scope. Two-week fix, visible owner, and it introduces you to marketing as
someone who noticed rather than someone who audits.

---

## Day 5 — first control end to end, and the baseline nobody else will take

Build `ctl.iam.cloud-platform.mfa` from the AWS credential report through to an assertion record.
One API call, unambiguous denominator, native timestamps that give real Variance Duration rather
than an interpolation, and genuine scenario weight. One system, one control, one cycle — then
compound.

```
/new-control    if you need to reshape it against what you learned this week
```

Then, and this is the one that gets skipped: **baseline human-touch minutes per control per
quarter, on paper.**

Sit with whoever runs compliance today and count the actual hours: evidence collection, screenshot
gathering, questionnaire responses, access reviews, policy attestation chasing. Without this number
the automation cannot be shown to have worked, and "we automated compliance" is a claim you cannot
substantiate at your own 90-day review. It is also the number that funds phase two.

While you are there, get the **security questionnaire turnaround time** and the monthly volume.
That is the metric the CRO already cares about, and it is the one that makes this program legible to
people who do not care about OSCAL.

---

## End of week one — you should have

- [ ] The real SOC 2 report period, confirmed, and the phasing in `PROPOSAL.md` adjusted if it moved
- [ ] The audit firm, the certification body, certificate numbers and surveillance dates
- [ ] SOC 2 exceptions extracted into `intake/extracted/`, reconciling clean
- [ ] `in_scope` populated in the requirement index from the actual SoA
- [ ] The ISMS/AIMS ownership question answered or formally escalated
- [ ] Three questions to Scytale, in writing
- [ ] RTO and marketing-claims findings written up
- [ ] One control producing a real assertion from real telemetry
- [ ] Touch-time and questionnaire-turnaround baselines, on paper
- [ ] All 17 items in `docs/DISCOVERY.md` either answered or explicitly owned

## What you should NOT have done

- Renamed, merged or split any control in the audited inventory. **The observation window is open.**
  See `docs/adr/0002-observation-window-freeze.md`.
- Published a policy. Policy comes after controls operate.
- Reported a coverage percentage. The denominator was undetermined until day 2, and possibly still
  is.
- Committed anything to `intake/source/`.
- Promised a certification. FedRAMP, TX-RAMP and HIPAA are all live questions and none of them are
  yours to commit to in week one.
