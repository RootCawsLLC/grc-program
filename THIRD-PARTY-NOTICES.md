# Third-party notices

## Ported from RootCawsLLC/proofplane

`src/probes/` — the AI agent control probe harness: the runner, the evidence record format, the
hash-chained audit trail, and the paired guarded/unguarded run structure.

- Source: <https://github.com/RootCawsLLC/proofplane>
- Licence to third parties: AGPL-3.0-or-later
- Copyright: RootCawsLLC, which also holds the copyright in this repository

**What was and was not carried across.** proofplane's harness is Python
(`probe/proofplane_probe/*.py`). This is a reimplementation in Node against the same design, not a
translation of its source: no proofplane code is copied into this repository. What is genuinely
shared is the *design* — probe evidence records, `HELD` / `BREACHED` / `ERROR` outcomes, trials
with a confidence interval, a `prev_hash`/`hash` chain over the record sequence, and the paired
guarded/unguarded run that is the whole point of the approach.

The probe **target** is not vendored. `src/probes/` speaks HTTP to proofplane's own instrumented
target agent, which is what that agent exists for. Nothing here points at a production system.

Attribution is recorded because the two repositories have different licences to third parties and
a common copyright holder. That combination is exactly the one that goes wrong silently when nobody
writes it down.

## Design adapted from SenteLabsAI/OpenExecutive

`src/lib/authority.mjs`, `schemas/person.schema.json`, `schemas/team.schema.json` and guards
G10-G12 — the authority-scope model: tokens describing what a person may approve, and the check
that reports any scope whose only approver is the principal.

- Source: <https://github.com/SenteLabsAI/OpenExecutive>
- Licence to third parties: Apache-2.0
- Copyright: Open Executive Contributors

**What was and was not carried across.** Upstream is Python, Pydantic and SQLite
(`packages/core/openexecutive/people/`, `departments/`). This is a reimplementation in Node
against a JSON Schema and YAML store: no upstream code is copied into this repository, and its
564-line SQLite store has no analogue here. What is genuinely shared is the *design* — scope
tokens as the unit of approval authority, a principal who holds a wildcard and is the fallback of
last resort, approver lookup that prefers non-principals, and the boot-time check for a scope with
no delegated approver.

**What is ours.** Upstream stores current state only: a person either holds a scope now or does
not. Dated grants (`from`/`until`/`basis`), the `departed_on` bound, and the temporal check
that asks whether an approver held a scope *on the day they signed* are not from upstream. Neither
is the split that keeps `control.owner` a team while `approved_by` resolves to a person, nor
tiering risk acceptance on quantified loss against a materiality threshold.

Attribution is recorded because the design lineage is real even though the code is not shared, and
because that is exactly the combination that goes unrecorded until someone needs to know.

## NIST OSCAL

The OSCAL models emitted by `src/oscal/` follow the NIST OSCAL specification. OSCAL is a work of
the United States Government and not subject to copyright protection in the United States
(17 U.S.C. §105). NIST asks that derived work not imply NIST endorsement; this project claims none.

Schema conformance is checked with `oscal-cli-enhanced`, fetched at CI time from Maven Central via
the `oscal` npm wrapper. It is not vendored here.
