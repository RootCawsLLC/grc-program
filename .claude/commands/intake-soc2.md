---
description: Extract structured findings from an audit report in intake/source/ into intake/extracted/.
argument-hint: [document short-name, e.g. soc2-type2-fy2026]
---

Help me extract structured findings from the audit report I have open, into
`intake/extracted/$1.yaml`, conforming to `schemas/finding.schema.json`.

Read `intake/README.md` and `schemas/finding.schema.json` first.

**How this works.** I read the report and paste or describe sections to you. You draft the YAML.
I check it. You do not read `intake/source/` — the settings deny it, deliberately, because audit
reports are NDA-gated and watermarked to the recipient.

**The discipline that keeps the record defensible:**

- `description`, `severity_as_stated`, `auditor_test_procedure` and `management_response` are
  **transcribed verbatim**. Not summarised. Not tidied. Not re-graded onto our scale.
- If the report stated no severity, `severity_as_stated` is `null`. Never infer one.
- Use the **word the document used** in `kind`. A SOC 2 exception is not an ISO nonconformity and
  flattening them loses the thing that determines urgency.
- `locator` is mandatory in practice even though the schema allows it to be absent. An unlocatable
  finding cannot be defended in the next audit.
- `control_id: null` is a legitimate answer and often the most important one — it means the finding
  has no home in the inventory, which is a gap in the control model, not in the extraction.
- **`control_id` is the PRIMARY mapping — the control whose owner is accountable. Where the finding
  reaches further, add the others to `also_implicates`, do not pick one and mention the rest in
  prose.** "Access to the cloud platform AND the source repository was not revoked" is one finding
  against two controls. A control named only in `notes` appears in no gap query and reads as clean
  while the auditor has already found otherwise.
- **Every mapping carries its own `mapping_confidence` and `mapped_by`, including secondaries.** A
  single confidence on the finding would apply the certainty of the primary to a mapping nobody
  checked as carefully.
- `mapped_by` is me, by name. Mapping is a judgement and carries a name.
- Only `high` counts as verified. Leaving `mapping_confidence` unset is **weaker** than writing
  `low` — it means nobody recorded how sure they were — and `npm run intake` counts it in
  `unverified_mapping_open` either way.

**Order within the report.** Exceptions and deviations first. Then the control descriptions — the
description of each control the auditor tested is the closest thing to an existing control
inventory Reco has, and reading it is how I learn what the current model actually is. Flag any
control description that reads as layer-munged; those are the candidates for splitting after the
observation window closes.

When done: run `npm run intake`, fix what it reports, then `npm run gap -- --direction remediation`
and tell me what the findings imply for the control inventory.
