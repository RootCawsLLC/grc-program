---
name: reco-context
description: Established facts about Reco — certifications, audit clocks, platforms, org, jurisdictions, known gaps — with confirmed and inferred kept separate. Load at the start of any task about Reco's program so context is not re-derived or re-guessed each session.
---

# Reco — established context

Compiled from public sources on 2026-08-21. `VERIFICATION.md` in the repo root records what was
checked and what was corrected. **Confirmed and inferred are kept separate on purpose. Do not
promote an inference to a fact because it would make an answer cleaner.**

## Confirmed

**Certifications** — SOC 2 Type 2 · ISO/IEC 27001:2022 with a published Statement of Applicability
· ISO/IEC 42001:2023 · CSA STAR Level 1 · GDPR · DPDPA · EU AI Act materials. All live on
trust.reco.ai.

**Platforms** — Compliance platform is **Scytale**. Trust center is **SafeBase**, which is a Drata
product and therefore a Scytale competitor. TPRM is **ProcessUnity**, listed separately. Security
ratings: SecurityScorecard (A), BitSight, Black Kite. That is four overlapping GRC surfaces, and
Scytale includes a trust center in every pricing tier that Reco is not using.

**Subprocessors published** — exactly five: ClickHouse, Amplitude, Segment, Datadog, AWS.

**Infrastructure and AI** — AWS: EKS, RDS for PostgreSQL, CloudFront, WAF. **Anthropic Claude
Sonnet via Amazon Bedrock**, with Bedrock prompt caching. An AWS ML blog post of 2026-03-23,
co-authored by CTO Tal Shapira, describes a team leading Reco's generative-AI solutions
"including multiple production AI agents." **Neither Bedrock nor Anthropic appears in the
subprocessor register.**

**Published recovery objectives** — RTO 5 days, RPO 22 hours. Unusually long for a vendor selling
to Fortune 500 and to a health system.

**Jurisdictions** — US (RecoLabs, Inc., Florida registration; new Texas office), Israel (Tel Aviv),
and **Moldova (Chișinău)**. Moldova appears on the About page but not in the trust-center processing
story.

**Funding** — $85M total. $30M Series B February 2026 led by Zeev Ventures, with Workday Ventures,
TIAA Ventures, S Ventures and Quadrille Capital participating.

**People** — Ofer Klein (Co-founder & CEO), Gal Nakash (Co-founder & CPO), Tal Shapira (Co-founder &
CTO, member of the CSA AI Controls Security Working Group), Zoe Hillenmeyer (COO), Bob Horn (CRO).

**Latest audit artifact** — SOC 2 bridge letter covering 1 Dec 2024 – 30 Nov 2025.

**Product** — identity-centric SSPM repositioned toward agentic/AI SaaS security. ~260 integrations
(the published count is inconsistent — 270+, 260+, 235+ and 215+ all appear live simultaneously).
Named customers include Waste Management and Tampa General Hospital.

## Inferred — flag as inference every time it is used

- **SOC 2 observation window runs 1 December – 30 November.** From the bridge letter. The report
  period is NDA-gated. **This drives all phasing in `PROPOSAL.md`. Confirm before relying on it.**
- **The CISO seat is vacant.** Reco announced its first CISO in June 2024; that person is no longer
  on the leadership page and holds a role elsewhere. The June 2026 seven-leader expansion named no
  CISO.
- **Reporting line is likely CTO.** The role is filed under R&D on the careers page, and Shapira
  owns the AI-governance relationship ISO 42001 sits on.
- **No FedRAMP, GovRAMP, HIPAA or PCI claim exists.** Absent from every public surface searched.

## Not knowable from outside — these are open items, not negative findings

Audit firm · ISO certification body · certificate numbers and expiry dates · whether the ISO
certificates appear in an accreditation registry (IAF CertSearch is account-gated; could not be
queried, which is **not** evidence of non-accreditation) · whether Scytale has any read API.

## The competitive picture, for framing

Among pure-play SSPM vendors only **Obsidian** also holds ISO 42001 (certified February 2026 via
A-LIGN). **AppOmni** holds a FedRAMP Moderate ATO and TX-RAMP and appears to be the only pure-play
SSPM in the FedRAMP Marketplace at any status. Reco just opened a Texas office, which makes TX-RAMP
the cheaper near-term counter to AppOmni's federal lane than full FedRAMP.

CrowdStrike's Falcon Shield inherits corporate FedRAMP High and IL5 — but there is **no per-module
FedRAMP authorization for Falcon Shield**. Do not let a deal review assert otherwise.

## Regulatory clock, as of August 2026

**Regulation (EU) 2026/1744 — the Digital Omnibus on AI** — published in the OJ 2026-07-24, in force
2026-07-27. Defers Annex III standalone high-risk obligations to **2027-12-02** and Annex I
embedded-product high-risk to **2028-08-02**. **Article 50 transparency obligations were NOT
deferred** and applied from 2026-08-02.

Practical consequence: the obligations live *right now* are the transparency ones. Many vendors are
currently publishing readiness language keyed to a high-risk regime that has been deferred. Do not
add Reco to that list.
