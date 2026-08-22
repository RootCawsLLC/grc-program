# ADR-0007 — The OSCAL package is emitted whole, and the SSP is generated

**Status:** accepted · **Date:** 2026-08-22

## Context

Before B18 this repo emitted one OSCAL model: assessment-results. It looked finished. It was not
valid, and nothing in the repository could have told you so.

`src/oscal/assessment-results.mjs` carried `"import-ap": { href: "./assessment-plan.json" }`. No
emitter produced that file. OSCAL document references are not decorative — the validator
**resolves and follows** them — so oscal-cli rejected the entire document with:

```
FODC2002 ... Unable to retrieve the resource identified by the URI
'file:/.../out/assessment-plan.json'
```

and a forty-line Java stack trace. No schema message, nothing naming the offending field. CI was
green throughout, because CI checked determinism and tests but never schema conformance. A gate
that does not run is indistinguishable from one that passes.

Two further constraints surfaced only under the validator, both invisible in the spec prose:

- `implemented-requirement` has no `description` field in the SSP model. Emitting one is rejected
  **and** separately logged as an unhandled field the parser dropped — the more dangerous half,
  because without the schema error the prose would simply have vanished from the document.
- `associated-activity` carries `activity-uuid` and must not carry a `uuid` of its own. It is an
  association, not an object with identity.

## Decision

**One entry point emits every document.** `src/oscal/emit.mjs` builds the whole package or none of
it. Emitting a subset produces documents whose cross-references dangle, and that failure is
expensive to diagnose and easy to ship.

**The assessment-plan is part of the package**, though B18 lists five models and not this one. It
is not padding: assessment-results cannot validate without it. It is also the honest document to
hold — a plan states what will be tested and how, and for continuous monitoring that is the
collection cadence, which is derived here from each control's own `collection` block so the plan
cannot claim a cadence the inventory does not declare.

**The SSP is generated and never hand-authored.** If it cannot be rebuilt from catalog + profile +
component definitions, the control model is incomplete and the gap is in the model. A hand-edited
SSP is a bug: the moment prose lives only there, the SSP and the thing it describes begin drifting
and the auditor is the one who finds out.

**Required fields that are not derivable are declared, not filled.** OSCAL requires a security
sensitivity level, impact levels, an information type and an authorization boundary. None follow
from a control inventory and none have been decided. Each is emitted with `derivation: assumed` and
named in remarks. Filling them with plausible values would be the more dangerous choice: a
categorisation nobody performed, in a document that reads as though somebody did.

**The profile records exclusion, not just inclusion.** Selection is derived from the crosswalk — a
control is in a baseline exactly when it carries an edge to that framework — and every control not
selected is listed with the reason it is not. The tailoring statement also says, explicitly, that
it records *selection and not coverage*: whether a framework's requirement set is fully claimed
runs the other direction and is answered by `npm run gap -- --direction coverage`. Inferring
coverage from a selection of our own controls is the move that makes most Statements of
Applicability indefensible.

**Validation is a blocking CI job.** `oscal-validate` runs the real Java CLI over every emitted
document. Nothing is piped through `|| true` except the wrapper's bootstrap step, whose file is
then validated again for real.

## Consequences

- 17 documents emit and all 17 validate against `oscal-cli-enhanced` 3.2.0 as of 2026-08-22:
  catalog, eleven framework profiles, component-definition, assessment-plan, assessment-results,
  POA&M and SSP. Profiles are derived from whatever frameworks appear in the crosswalk, so a new
  framework produces a baseline without anyone remembering to add one.
- The determinism gate now covers the whole package. It previously covered assessment-results
  alone, and would have passed while a non-deterministic catalog or SSP sat beside it.
- Running the validator locally needs a JDK. Temurin 17 was installed on the build machine for
  exactly this; without it, `npm run emit` still works and only the conformance claim is
  unavailable.
- The catalog's control statement is the `population_definition`, because this repo's control
  schema has no authored `assertion` field — unlike `cui-control-plane`, whose catalog uses one.
  That is a schema gap rather than an emitter decision. If an `assertion` field is added, one line
  in `catalog.mjs` changes and nothing else.
- The SSP claims one baseline, chosen as SOC 2 because it is the operative report. That is a
  decision, recorded in the SSP's own remarks and overridable, not a derivation.
