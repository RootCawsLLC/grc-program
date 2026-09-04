# Fixtures

**NOT REAL EVIDENCE.** Everything in this directory is invented. Never present any figure derived
from it as a measurement of a real system.

## The stamp, and why it is a field rather than a comment

`NOT REAL EVIDENCE` is the exact string in `FIXTURE_STAMP` (`src/lib/load.mjs`). It is not
decoration:

- Every cycle file in `landing/` carries `"_stamp": "NOT REAL EVIDENCE"`, and `loadCycles()`
  **refuses** a file without it. An unstamped fixture becomes indistinguishable from real evidence
  the moment its rows are in a table.
- Every assertion record the pipeline generates carries `fixture: true`. That field is declared in
  `schemas/assertion.schema.json` specifically so it can exist — the schema sets
  `additionalProperties: false`, so without the declaration the stamp could not ride on the record
  at all.
- `src/lib/load.mjs` **refuses an assertion set that mixes** synthetic and real records, naming the
  records on both sides. A partly-fabricated artifact with nothing on its face to say which part is
  worse than an obviously synthetic one and worse than none.
- The stamp travels into the OSCAL package: the metadata title, the metadata remarks, the result
  description, and a prop on every observation.

Do not strip it to make a demo produce a nicer number.

## Layout

```
landing/cycle-<date>.json   one collection cycle: as_of, a stamp, a comment explaining what the
                            cycle exercises, and rows keyed by landing table
assertions.json             a single hand-written assertion record, used by the OSCAL tests
events/*.json               inbound dispatch envelopes and Slack `block_actions` payloads for
                            `npm run orchestrate` / `npm run gate -- --interaction`.
                            Each carries `_stamp: NOT REAL EVIDENCE`. `loadEvent` refuses an
                            unstamped file under this directory. A Slack `user.id` is not a
                            `per.*` actor — `--actor per.*` or `--map fixtures/identity/slack-map.json`.
                            `auditor-request.json` is an evidence-scout envelope against a control
                            whose status is `building` — the draft must refuse, not answer.
identity/slack-map.json     synthetic Slack `U…` and GitHub numeric account id → `per.*`.
                            Unmapped users are refused; usernames and logins are not identity.
                            Stamped.
```

## Why three cycles

`landing/` holds three, where B22 asks for at least two. A complete four-timestamp variance event
needs a subject to pass, then fail, then pass again — which two cycles cannot express. The third
cycle is what makes `variance_events.sql` emit an event with a real `remediation_completed_at`
rather than a null tail.

The set is designed so each cycle demonstrates something specific; see the `_comment` in each file.
Notably it includes cases the pipeline gets *right by refusing*: a subject already failing before
the first cycle produces **no** variance event, because there is no prior passing observation to
transition from and any start date would be fabricated.

It also deliberately preserves a case that exposes a real defect rather than hiding it — see
`docs/adr/0006-variance-quality-ladder.md`.

## Synthetic and real evidence never share a directory

`npm run demo` writes to `out-synthetic/`, never `out/`. Both are gitignored.
