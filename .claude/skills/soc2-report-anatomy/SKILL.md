---
name: soc2-report-anatomy
description: How a SOC 2 Type 2 report is structured and what to extract from each section — including where findings hide and which section is secretly a control inventory. Load when reading, extracting from, or reasoning about a SOC 2 report.
---

# Reading a SOC 2 Type 2 report for extraction

A SOC 2 Type 2 report has five sections. Most people read Section 1 and stop. **Section 4 is where
the work is, and Section 3 is secretly the thing you most need.**

## Section-by-section

**Section 1 — Independent Service Auditor's Report (the opinion).** Two pages. What to take from it:
the **exact report period** (this settles the observation-window question that gates all phasing),
the **TSC categories in scope** (Security is always there; Availability, Confidentiality,
Processing Integrity and Privacy are elective — do not assume), the **audit firm**, and critically
**whether the opinion is unqualified**. A qualification or an emphasis-of-matter paragraph is the
single most important sentence in the document.

**Section 2 — Management's Assertion.** Short. Take the **system boundary** — what is in and out of
scope. Boundary language here constrains everything you can later claim, and it is where scope
creep between the report and the sales conversation shows up.

**Section 3 — Description of the System.** Long, and the one people skim. **This is the closest
thing to an existing control inventory the company has.** It carries: the infrastructure and
software inventory, the subservice organisations and whether they are carved out or inclusive
(compare this against the published subprocessor list — a mismatch is a real finding),
complementary user entity controls (things the report pushes onto customers), and the narrative
description of each control.

Read it specifically to learn **what the current control model actually is**, and flag every
control description that reads as layer-munged — one "Access Control" narrative covering platform
IAM, SSO and in-product authz. Those are the split candidates for after the window closes.

**Section 4 — Trust Services Criteria, Controls, Tests and Results.** The table. For every criterion:
the criterion identifier, the control(s) mapped to it, the auditor's test procedure, and the result.

Extract from here:
- **Every exception and deviation.** Verbatim. These become `kind: exception` findings.
- **The test procedure**, verbatim, in `auditor_test_procedure`. This is what makes the automation
  case: read how many procedures say "inspected a sample of 25" for a population a query returns
  in full.
- **The control-to-criterion mapping**, which is the company's existing crosswalk.
- **Sample sizes.** Note them. `n=25` against a population of several hundred is the argument for
  the entire build, stated in the auditor's own words.

**Section 5 — Other Information (unaudited).** Management's response to exceptions, roadmap
commitments. Extract into `management_response`. **It is explicitly not covered by the opinion** —
never cite it as assurance.

## Where findings hide

Not everything adverse is labelled "exception":

- **"Deviation"** — sometimes used interchangeably, sometimes graded lower. Preserve the word used.
- **Emphasis-of-matter or explanatory paragraphs** in Section 1 — rare and serious.
- **Complementary User Entity Controls (CUECs)** — obligations pushed onto customers. Not findings
  about the organization, but each one is a commitment a customer may not know they have, and they belong in
  the record.
- **Carved-out subservice organisations** — anything carved out is explicitly *not* covered by this
  opinion. Reconcile against the published subprocessor list.
- **Scope narrowing between periods** — compare this report's boundary against last year's. A
  quietly removed system is a finding nobody wrote down.

## The bridge letter

Covers the gap between the report period end and today, and asserts no material change. It is
**management's assertion, not an audit opinion** — it carries much less weight than the report and
should never be offered as equivalent. Its date range is, however, the cleanest public evidence of
the observation window.

## Extraction discipline

Transcribe verbatim; never re-grade. If the report states no severity, `severity_as_stated: null`.
Use the document's own word in `kind`. Locator is mandatory in practice. `control_id: null` when
the finding has no home in the inventory — that is a gap in the control model and
`npm run gap -- --direction remediation` will report it.

Schema: `schemas/finding.schema.json`. Workflow: `/intake-soc2`.
