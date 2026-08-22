# Read this before quoting any number in this directory

Every `parameters` block below carries `derivation_level: assumed`. That is not a placeholder I
forgot to fill in — it is the accurate state of the estimate before a calibration workshop with
Reco's own data.

**Nothing in this directory is a Reco loss estimate yet.** These files establish the scenario
*structure*, the taxonomy grammar, the control joins, and the provenance discipline. They are
scaffolding for the Day-45 calibration session, at which point:

- `derivation_level` moves from `assumed` to `calibrated-estimate` (workshop) or `measured` (telemetry)
- `source` names the actual person calibrated, the actual dataset, or the actual contract clause
- `confidence_tier` rises from 1 toward 4

Publishing an `assumed` range with a confident-looking min/most-likely/max is exactly the failure
mode FAIR exists to prevent. `npm run validate` enforces the provenance block; it cannot enforce
that someone did the work. That part is on the analyst.

Diagnostic to apply at the workshop: a $10M–$500M range means research was skipped. A
$748K–$752K range is false precision. Usefully precise beats precise — an estimate is usefully
precise when more precision would not change the decision.
