# ADR-0003 — Carry framework identifiers, never framework text

**Status:** accepted · **Date:** 2026-08-21

## Context

Crosswalks need a spine. The Secure Controls Framework is the obvious choice: roughly 1,500
controls across 34 domains with mappings to 250-plus laws, regulations and frameworks, freely
downloadable, and since 2024 using NIST IR 8477 Set Theory Relationship Mapping so relationships
carry a type and a strength rather than a vague "related."

SCF is licensed **CC BY-ND 4.0** — Attribution, **NoDerivatives**. Its terms now state that the
prohibition on derivative works *"includes utilizing Artificial Intelligence (AI)… to leverage SCF
content to generate policies, standards, procedures, metrics, risks, threats or other derivative
content,"* and that an organization must purchase a commercial license to offer derivative SCF
content. A commercial license is required to produce or share derivative SCF content.
(Commercial tier pricing is reported in secondary sources at around $25,000/year for the entry
tier; that figure is NOT confirmed from SCF and should be verified directly before it is used in
any budget or business case.)

There is a safe harbour: internal-only modification is permitted, and rearranging SCF content for
readability inside a GRC interface is explicitly not a derivative work.

ISO/IEC 27001 and ISO/IEC 42001 text is separately copyrighted and licensed per-user by the
standards bodies. FAIR-CAM and FAIR-MAM are CC BY-NC-ND 4.0.

The exposure is not theoretical for this program specifically, because agents draft crosswalks
here. An agent that ingests SCF text and emits a policy is the exact activity the clause names.

## Decision

**Identifiers only. No framework text enters this repository, in any file, ever.**

- `crosswalk` blocks carry identifiers (`IAC-06`, `CC6.1`, `A.8.5`, `IA-2(1)`) and nothing else.
- SCF is resolved **at runtime** from a locally held release. It is never vendored, never
  committed, never checked into history.
- `reference/` holds requirement *indexes* — identifier, clause number, and our own one-line
  paraphrase where one is genuinely needed. Not the normative text.
- CI enforces it: `.github/workflows/ci.yml` fails the build on `description:`,
  `requirement_text:` or `control_text:` keys under `controls/` or `reference/`.
- Policy generation derives from **our own control records** — `population_definition`, `title`,
  `owner`, live `failing[]` — never from framework text. This is not only the license-safe path,
  it is the correct one: a policy generated from a measured control describes something true,
  and a policy generated from framework text describes someone else's aspiration.

## Consequences

Anyone reading a control record needs their own licensed copy of the standard to see the
requirement text. That is correct — they needed one anyway, and pretending otherwise was the
liability.

The repository can be shared with an auditor, published as a reference architecture, or handed to
a customer under NDA without a licensing review. That optionality is worth more than the
convenience of inlined text.
