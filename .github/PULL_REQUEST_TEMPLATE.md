## What changed and why

<!-- If this changes a control record, say what it changes about the ESTATE, not just the YAML. -->

## Derivation

Every number in this PR carries its derivation level. Tick what applies and name the source.

- [ ] `measured` — from telemetry. Source system:
- [ ] `derived` — computed from measured values. Computation:
- [ ] `calibrated-estimate` — from a calibration session. Who was calibrated:
- [ ] `assumed` — placeholder. **Say so in the diff, do not let it look calibrated.**

## Checks

- [ ] `npm run validate` — 0 errors
- [ ] `npm test` — all passing, and **no test was changed to make code pass**
- [ ] No framework text added to `controls/` or `reference/` (identifiers only — ADR-0003)
- [ ] Nothing added to `intake/source/`
- [ ] Any new third-party GitHub Action is pinned to a full commit SHA

## If this touches the audited control inventory

- [ ] The SOC 2 observation window is **closed**, or this change is non-normative
      (`status: building` / `planned`, no rename, no merge, no split)

If the window is open and this renames, merges or splits an audited control, stop and read
`docs/adr/0002-observation-window-freeze.md`. The auditor tests a control that existed for part of
the period and not the rest, and the likely outcome is a scope qualification.

## If an agent drafted any of this

- [ ] A human reviewed every line
- [ ] No agent-authored text asserts that a control **works** (guardrail 3, ADR-0004)
- [ ] Efficacy parameters, risk acceptances and approvals carry a named human
