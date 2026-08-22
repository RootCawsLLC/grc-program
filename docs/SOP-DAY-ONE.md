# SOP — Day One

**Purpose.** Execute the first day of the GRC program build without losing anything to onboarding
chaos. Follow it line by line. Do not improvise on day one.

**Read `docs/DAY-ONE.md` for *why* the order is what it is.** This document is the *what*, in
sequence, with checkboxes. They are deliberately separate: the narrative one is for the weekend
before, this one is for the day itself.

**Time required.** Four hours of focused work, which you will not get in one block. Assume
fragmented time between onboarding sessions, IT setup and introductions.

**Prerequisites.** Laptop issued. Corporate email working. GitHub account with access to
`RootCawsLLC/reco-grc` (or the Reco-org copy, if that transfer already happened).

---

## If the day collapses, do these three

Day one at a startup rarely survives contact with HR orientation. If you get 90 minutes total,
spend them here and let everything else slip to day two:

1. **File the access requests** (Block B). Longest lead time of anything in the plan. Every one of
   the 17 build units is gated behind one of them.
2. **Ask who owns the ISMS and AIMS management review** (Block C). One question, asked in a
   hallway. It is the highest-value sentence you will say this week and it gets harder to ask
   every day you are there.
3. **Get the SOC 2 report and the Statement of Applicability into your hands** (Block B, item 3).
   Not read — just requested and received. Reading is day two.

Everything else can wait a day without cost.

---

## Block A — Machine and repository

**Time:** 45 minutes. **Blocked by:** nothing. Do it before anyone schedules anything.

### A1. Baseline the machine

- [ ] Work through **`docs/SETUP.md`** end to end. On Windows that is four things — execution
      policy, long paths, line endings, Node version. On macOS or Linux it is `node --version`.
- [ ] Confirm Node is 22 or later: `node --version`

**If Node is older or missing:** install it before continuing. Nothing in this repo runs without it.

### A2. Clone and verify

```
git clone https://github.com/RootCawsLLC/reco-grc reco-grc
cd reco-grc
npm ci
npm test
npm run validate
npm run baseline
```

- [ ] `npm test` → **75 passing, 0 failing**
- [ ] `npm run validate` → **0 errors, 0 warnings**
- [ ] `npm run baseline` → three sections print: AUDIT INTAKE, CONTROL HEALTH, GAP ASSESSMENT

**Expected result:** the baseline looks bleak — 9 controls, 1 instrumented, 117 gaps. That is
correct. It is showing you the *shape of the output*, not the state of the company. None of those
controls are Reco's yet.

**If tests fail:** stop. Do not proceed to Block B. A failing suite on a clean clone means the
environment is wrong, and everything downstream inherits the problem. Check Node version first.

### A3. Set your git identity

```
git config user.email "<your reco address>"
git config user.name "<your name>"
git config --get user.email
```

- [ ] Confirms your real Reco address, not a placeholder

**Why it matters:** `git log` on this repo is change-management evidence for
`ctl.appsec.ci-cd.branch-protection`. An unresolvable author address reads badly in exactly the
wrong room.

### A4. Claude Code

- [ ] Open Claude Code **in the repo root** — not the parent directory
- [ ] Run `/week-one`
- [ ] Confirm it responds with discovery status rather than "unknown command"

**If slash commands do not appear:** you are not in the repo root. `.claude/` is discovered
relative to the working directory.

### A5. Repository hygiene

- [ ] `gh repo view --json isPrivate --jq '.isPrivate'` → **true**
- [ ] `gh run list --limit 3` → most recent `ci` run shows **success**

**If the repo is not private, stop and fix it before anything else.** This repo will hold extracted
audit findings within days.

---

## Block B — Access requests

**Time:** 30 minutes. **Do this before lunch on day one.** Nothing else in the plan moves until
these land, and procurement and IT queues run in days, not hours.

### B1. Raise the requests

Ask for **read-only everywhere**, and say why unprompted. Paste-ready:

> I'm building the continuous control evidence pipeline for the GRC program. I need read-only
> access to the systems below so the pipeline can measure control state directly rather than
> asking people for screenshots. Read-only is deliberate — the pipeline measures our own access
> controls and shouldn't be able to violate them. Happy to walk through exactly what it queries.

| | System | For | Ask for | Requested | Granted |
|---|---|---|---|---|---|
| ☐ | **Scytale** | the platform of record today | admin, plus intro to whoever owns the contract | | |
| ☐ | **Trust center (SafeBase)** | the published surface | admin | | |
| ☐ | **AWS** | `ctl.iam.cloud-platform.mfa` | read-only via **OIDC, no long-lived keys** | | |
| ☐ | **Identity provider** | `ctl.iam.enterprise-sso.mfa` | read-only: users, factors | | |
| ☐ | **GitHub org** | `ctl.appsec.ci-cd.branch-protection` | read-only: repo + org admin read | | |
| ☐ | **HRIS** | `ctl.people.workforce.security-training` | read-only roster, **all three entities** | | |
| ☐ | **Reco tenant (the product)** | ADR-0005 dogfooding | admin on an internal tenant | | |
| ☐ | **CLM / contract repository** | notification clocks, availability terms | read | | |

Fill in the dates as they come. An empty "Granted" column three days in is itself a finding worth
escalating.

**On the AWS ask specifically:** say "OIDC, no long-lived keys" out loud. That single sentence buys
more credibility with a platform team than anything else you will say in week one, because it
signals you understand you are asking for something that could become a liability.

**On the HRIS ask:** confirm the roster covers **all three entities** — US, Israel, and **Moldova**.
The Moldova entity appears on Reco's About page but not in the trust-center processing story, and
a roster missing an entity makes training coverage look better than it is.

### B2. Request the documents

- [ ] SOC 2 Type 2 report (most recent) — **read only, do not commit**
- [ ] SOC 2 bridge letter
- [ ] ISO/IEC 27001 certificate + Statement of Applicability
- [ ] ISO/IEC 42001 certificate + most recent audit report
- [ ] Most recent penetration test report
- [ ] Any customer audit findings or security-questionnaire escalations from the last 12 months

**Do not commit any of these.** `intake/source/` is gitignored for exactly this reason — audit
reports are the auditor's deliverable and usually watermarked to the recipient. The structured
extraction goes in the repo; the PDF never does.

### B3. Start the Scytale conversation

Send these three, in writing, today. Procurement answers take weeks and the first one changes the
architecture.

- [ ] **Q1 —** Which objects are readable via GET? Controls, control test results, evidence
      artifacts and their collection timestamps, policies and version state, personnel and
      attestation status, vendors, risks, tasks. What auth? What rate limits? Are there webhooks on
      control-state change? Which pricing tier, and is it an add-on?
- [ ] **Q2 —** Confirm bulk evidence export: format, completeness, whether collection metadata and
      timestamps survive, and whether it is self-service or a support ticket.
- [ ] **Q3 —** Confirm in the order form: no unilateral suspension absent material breach with a
      cure period; a renewal uplift cap; and AI-agent quotas specified numerically rather than as
      "Limited".

**Why Q1 matters most:** the answer determines whether the owned pipeline can reconcile against
Scytale or has to run fully parallel. Full reasoning in `docs/adr/0001-scytale-is-a-sink.md`.

---

## Block C — The ownership question

**Time:** 15 minutes. **Ask it on day one.**

- [ ] Ask, plainly: **"Who owns the ISMS and AIMS management review today?"**
- [ ] Record the answer in `docs/DISCOVERY.md` item 4
- [ ] If the answer is "nobody" or "I'm not sure" — write it up as a finding the same day

**Why now.** ISO 27001 Clause 9.3 and ISO/IEC 42001 Clause 9.3 both require top-management review.
Reco announced its first CISO in June 2024; that person is no longer on the leadership page and
holds a role elsewhere, and the June 2026 announcement naming seven new leaders named no successor.
If nobody currently owns it, that is a nonconformity waiting to be raised at the next surveillance
audit.

**Why day one and not day thirty.** Week one is the only time you can ask without it sounding like
a criticism of a predecessor. After that it becomes an accusation.

**Who to ask:** your reporting line first. The role is filed under R&D on the careers page, which
suggests CTO — confirm that too while you are there.

---

## Block D — Baselines nobody else will take

**Time:** 30 minutes, and it is the block most likely to get skipped. Do not skip it.

### D1. Human-touch minutes per control per quarter

- [ ] Sit with whoever runs compliance today
- [ ] Count actual hours, on paper: evidence collection, screenshot gathering, questionnaire
      responses, access reviews, policy attestation chasing
- [ ] Record the figure and the date

**Why this is not optional.** Without a baseline, "we automated compliance" is a claim you cannot
substantiate at your own 90-day review. It is also the number that funds phase two, and it is
unrecoverable — nobody can reconstruct it in December.

### D2. Security questionnaire volume and turnaround

- [ ] Questionnaires per month
- [ ] Median turnaround time
- [ ] Who currently answers them

**Why:** this is the metric the CRO already cares about, and the one that makes this program legible
to people who do not care about OSCAL. Security review latency is deal latency.

### D3. Record everything in the repo, not in your head

- [ ] Open `docs/DISCOVERY.md` and fill in every answer you got today
- [ ] Commit it

```
git add docs/DISCOVERY.md
git commit -m "discovery: day one answers"
git push
```

**Why commit it:** an answer in your notebook is lost when you change laptops. An answer in the repo
is dated, attributed, and diffable — and `/week-one` reads it to tell you what is still open.

---

## End of day one — checklist

- [ ] `npm test` passes on the work laptop
- [ ] Claude Code responds to `/week-one` from the repo root
- [ ] Git identity set to a real address
- [ ] Repo confirmed private, CI green
- [ ] All eight access requests raised, with dates recorded
- [ ] All six documents requested
- [ ] Three Scytale questions sent in writing
- [ ] ISMS/AIMS ownership question asked, answer recorded
- [ ] Touch-time and questionnaire baselines captured on paper
- [ ] `docs/DISCOVERY.md` updated and committed

---

## What you must NOT have done

Every item here is a way to make day one actively worse. They are listed because each one is
tempting.

- [ ] **Renamed, merged or split any control in the audited inventory.** The SOC 2 observation
      window is open. See `docs/adr/0002-observation-window-freeze.md` — re-cutting controls
      mid-window is how audits get qualified.
- [ ] **Published or edited a policy.** Policy comes after controls operate, not before.
- [ ] **Reported a coverage percentage.** The denominator is undetermined until the Statement of
      Applicability populates `reference/requirement-index.yaml`. `npm run gap` says so out loud
      rather than quietly reporting zero — do not paraphrase it into a number.
- [ ] **Committed anything to `intake/source/`.**
- [ ] **Promised a certification.** FedRAMP, TX-RAMP and HIPAA are all live questions. None are
      yours to commit to in week one.
- [ ] **Presented `PROPOSAL.md` as final.** Its entire phasing rests on an *inference* that the SOC 2
      window runs 1 Dec – 30 Nov, drawn from a published bridge letter. Confirm the real report
      period first. If it moved, the plan moves with it — and it is much better to say that
      yourself than to have someone find it.

---

## When you get blocked

| Situation | Do this |
|---|---|
| Access request stalled >3 days | Escalate to your reporting line with the specific control it blocks. "I can't measure MFA coverage" lands better than "I'm waiting on Okta." |
| Told the SOC 2 report is need-to-know | You are the GRC owner; it is the primary input to your first deliverable. If refused, record who refused and when in `DISCOVERY.md`. That refusal is itself a governance finding. |
| Asked to fix something before the baseline exists | Say yes, then take the touch-time measurement of the thing you are about to fix, first. It takes ten minutes and you cannot recover it later. |
| Someone asks for a compliance dashboard on day one | Offer `npm run baseline` output instead, and say plainly that the numbers are seed data until the real inventory lands. |
| A number is requested that you cannot source | "I don't have that yet, here's when I will" — every time. `VERIFICATION.md` exists because this discipline is the whole product. |

---

## Days 2–5 at a glance

Full detail in `docs/DAY-ONE.md`. In sequence:

| Day | Focus | Primary output |
|---|---|---|
| **2** | Read the SOC 2 report end to end. Use `/intake-soc2`. | Exceptions extracted to `intake/extracted/`; real report period confirmed |
| **3** | ISO documents. SoA populates `reference/requirement-index.yaml`. | `in_scope` set; certificate dates and CB confirmed and verified in the CB's own registry |
| **4** | Two visible findings: the published RTO of 5 days, and the inconsistent integration counts. | Both written up |
| **5** | First control end to end — `ctl.iam.cloud-platform.mfa`, AWS credential report to assertion record. | One real assertion from real telemetry |

**The trap to watch for all week.** The strongest pull is toward the thing that feels like progress:
mapping frameworks and closing coverage gaps. Coverage is the easiest thing in this repo to grind on
and the least urgent. The order that matters is **remediation, then risk, then assurance, then
coverage** — remediation has someone else's deadline, risk is about loss, assurance makes the rest
measurable, and coverage is merely countable. `/week-one` will tell you off if you drift. Let it.
