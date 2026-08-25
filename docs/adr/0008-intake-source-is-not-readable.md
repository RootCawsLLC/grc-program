# ADR-0008 — What actually stops an NDA-gated audit report being read

**Status:** accepted · **Date:** 2026-08-25

## Context

`intake/source/` holds audit reports. They are NDA-gated and watermarked to the recipient, so the
cost of one leaking is not embarrassment — it is identifiable, attributable disclosure of somebody
else's confidential work product.

`.claude/commands/intake-soc2.md` told the operator:

> You do not read `intake/source/` — the settings deny it, deliberately, because audit reports are
> NDA-gated and watermarked to the recipient.

The S6 intake rehearsal tested that claim and it did not hold as written. `.claude/settings.json`
denies `Read(intake/source/**)`, which binds **the Read tool**. It says nothing about Bash. A file
placed there was read straight back with `cat`.

That is a control described more strongly than it behaves, which is worse than a weak control
honestly described — nobody re-checks the one they have been told is handled.

## What was actually true

Picking the claim apart produced a more useful picture than "bypassable":

| path | status |
|---|---|
| Read tool | genuinely denied |
| `cat` / `head` / `sed` from Bash | in neither allow nor deny, so a scoped session **prompts** — a human checkpoint, not prevention |
| **a script behind `npm run …`** | **`Bash(npm run:*)` is auto-allowed, so this never prompts at all** |
| committing the file | prevented by `.gitignore`, which is the layer that actually holds |

The dangerous path was the third, and it was the one nobody had looked at.

## Decision

**Do not pretend a deny-list is the control.** Deny-listing read verbs is whack-a-mole — `cat`,
`less`, `od`, `python`, a `node -e` one-liner — and any list is incomplete the day it is written.
Adding twenty entries would have produced a longer list and the same false confidence.

Four layers, and the ADR names which one carries the weight:

1. **`.gitignore` is load-bearing.** A watermarked report reaching a commit is the failure that
   cannot be undone. Everything else is recoverable; this is not.
2. **A test asserts no repository code reads the directory** —
   `tests/intake-source-guard.test.mjs`. This closes the `npm run` path specifically, and it is the
   only layer the repository fully owns: it does not depend on the harness's permission model, a
   settings file somebody can edit, or which tool a future agent happens to reach for.
3. **The Read deny stays**, and the test asserts it is still there so it cannot be dropped
   silently.
4. **Common read verbs are deny-listed as defence in depth, and are documented as incomplete.**
   They raise the cost of an accident. They do not stop a determined path and are not claimed to.

**The command text now says what is true**: the source document is read by a human, the model
works from what that human pastes, and the protections are layered with the gitignore as the one
that matters.

## Consequences

- The honest summary is: *nothing in this repository reads `intake/source/`, and nothing may be
  added that does — enforced by a test.* Whether a human can make some tool read it is a question
  about the operator's own machine, and this repository does not get to claim otherwise.
- The strongest available fix was considered and rejected as disproportionate: keep source
  documents entirely outside the working tree, with `intake/source/` reduced to a pointer. That
  removes the question rather than answering it, but it also removes the ergonomics the extraction
  workflow depends on — the operator has the report open beside the terminal, which is the whole
  design. Revisit if a real report is ever mishandled.
- Layer 4 will look inadequate to anyone who reads the deny list expecting a boundary. That is why
  it is labelled in the settings file itself rather than only here.
