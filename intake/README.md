# Audit intake

## What goes where

```
intake/source/      the actual PDFs. GITIGNORED. Never committed.
intake/extracted/   structured findings, one YAML per source document. Committed.
```

**`intake/source/` is gitignored and must stay that way.** Audit reports are the auditor's
deliverable, are usually watermarked to the recipient, and are NDA-gated on the trust center. The
structured extraction belongs in this repo — Reco's own private GRC repo — because that is the
whole point. The source PDF does not.

## Why this is not a PDF parser

Because a mis-parse silently drops a finding or invents one, and both are worse than the twenty
minutes the manual pass costs. Extraction is human-in-the-loop and Claude-assisted:

```
/intake-soc2          reads with you, drafts the YAML against schemas/finding.schema.json
grc intake            validates the extraction and reconciles against the control inventory
```

You read the report. Claude drafts. You check. It gets committed with your name in `mapped_by`.

## The rule that keeps the record honest

**The auditor's words are preserved verbatim; our judgement is separately labelled.**

`description`, `severity_as_stated`, `auditor_test_procedure` and `management_response` are
transcribed, not summarised, not re-graded, not translated onto our severity scale. If the report
stated no severity, `severity_as_stated` is `null` — not an inferred one.

Our interpretation lives in exactly four fields: `control_id`, `mapping_confidence`, `mapped_by`
and `disposition`. All four are ours and all four carry a name.

`control_id: null` is a legitimate and important answer. It means the finding has no home in the
inventory — which is not a gap in the extraction, it is a gap in the control model, and
`grc gap --direction remediation` will surface it as exactly that.

## Order of intake, week 1

1. **SOC 2 Type 2 report.** Exceptions and deviations first, then the control descriptions — the
   description of each control the auditor tested is the closest thing to an existing control
   inventory that Reco has, and reading it is how you learn what the current model actually is.
2. **ISO 27001 Statement of Applicability.** This populates `in_scope` in
   `reference/requirement-index.yaml`. Until it does, every coverage percentage in this repo is
   fiction, and `grc gap` says so out loud rather than quietly reporting zero.
3. **ISO 42001 audit report**, same treatment. Nonconformities carry clause references; keep them.
4. **Pentest report.** Findings map to controls like any other. A pentest finding with no control
   is the same signal as an audit finding with no control.
5. **Customer audit findings and security-questionnaire escalations**, if any exist.
