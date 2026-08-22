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

## NIST OSCAL

The OSCAL models emitted by `src/oscal/` follow the NIST OSCAL specification. OSCAL is a work of
the United States Government and not subject to copyright protection in the United States
(17 U.S.C. §105). NIST asks that derived work not imply NIST endorsement; this project claims none.

Schema conformance is checked with `oscal-cli-enhanced`, fetched at CI time from Maven Central via
the `oscal` npm wrapper. It is not vendored here.
