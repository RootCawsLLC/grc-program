# Week 1 discovery — the questions this plan is contingent on

Everything in `PROPOSAL.md` was written from public evidence. These are the places where public
evidence ran out. Each one has a named consequence, so it is visible which answers change the plan
rather than merely informing it.

Answer them in the first five working days. Fill the answers in here; this file is the record.

## Blocking — the phasing depends on these

| # | Question | Why it blocks | Answer |
|---|---|---|---|
| 1 | What is the **actual SOC 2 Type 2 report period**? Confirm the Dec 1 – Nov 30 window against the report itself. | ADR-0002 and the entire 30/60/90 phasing. If the window is different, the freeze period moves. | |
| 2 | Who is the **audit firm**, and when is the next fieldwork? | Not published anywhere. Determines when reconciliation evidence is needed. | |
| 3 | **ISO 27001 and ISO 42001 certificate dates**, certification body, certificate numbers, and next surveillance dates. | Not published. The ISO cycles are *not* governed by the SOC 2 freeze and may allow earlier movement on AI governance. | |
| 4 | Who owns the **ISMS and AIMS management review** today? The organization announced its first CISO in June 2024; that person is no longer listed on the leadership page and now holds a role elsewhere. No successor has been announced. | ISO 27001 Cl. 9.3 and ISO 42001 Cl. 9.3 require top-management review. If nobody owns it, that is a nonconformity waiting to be raised, and it is a week-1 finding rather than a day-90 project. | |
| 5 | **Does Scytale expose any read API?** Put the three questions in ADR-0001 in writing to the account team. | Determines whether reconciliation is possible or the two surfaces run fully parallel. | |
| 6 | What is the **Custom Integration JSON contract**? Create one in the UI and capture the required structure. | `src/push/scytale.mjs` refuses to send until this is confirmed. | |

## High priority — these are findings, not questions

| # | Item | Why it matters | Status |
|---|---|---|---|
| 7 | **RTO 5 days / RPO 22 hours** are published on the trust center. Is that the measured capability or an unrevisited placeholder? Reconcile against availability terms in executed MSAs. | For a security vendor selling to Fortune 500 and to a health system, a five-day RTO is outside what enterprise procurement typically accepts. Either it is wrong and republishing it is a free revenue-facing win, or it is right and it is a genuine risk with contractual exposure. | |
| 8 | **Amazon Bedrock and other model providers** are not named in the subprocessor register, which lists five entities. The organization publicly documents Bedrock use. | ISO 42001 and EU AI Act transparency normally expect explicit model-provider disclosure rather than inheritance under a cloud entry. | |
| 9 | The **Moldova entity** (Chișinău) appears on the About page but not in the trust-center processing story. | A third processing jurisdiction. Affects GDPR Art. 30 records, the subprocessor register, and the HRIS roster feeding `ctl.people.workforce.security-training`. | |
| 10 | **Integration count is inconsistent across live surfaces**: 270+, 260+, 235+ and 215+ all appear simultaneously on the site and in live press releases. | A claims-accuracy process is a fast, visible, low-cost early win, and marketing-claim governance is squarely inside the AIMS scope for an AI vendor. | |
| 11 | **Four overlapping GRC surfaces**: Scytale (which includes a trust center in every tier, currently unused), SafeBase/Drata (the live trust center), ProcessUnity (TPRM, overlapping Scytale's vendor module), plus SecurityScorecard, BitSight and Black Kite. | The trust-center overlap is the cleanest provable duplication. Note honestly that SafeBase is materially more capable than Scytale's trust center — the finding is "paying twice", not necessarily "switch". | |
| 12 | Are the ISO certificates **accredited**, and do they appear in the certification body's registry / IAF CertSearch? | Could not be verified externally; the certificates are behind the NDA gate. This is an open item, **not** a negative finding. Ask for the certificate PDFs and verify in the CB's own registry. | |

## Scoping — needed before committing to a number

| # | Question | Answer |
|---|---|---|
| 13 | Is there a **FedRAMP or GovRAMP/TX-RAMP** ambition? AppOmni holds a FedRAMP Moderate ATO and TX-RAMP and appears to be the only pure-play SSPM in the marketplace at any status. The organization just opened a Texas office. TX-RAMP is the cheaper near-term counter. | |
| 14 | Are there **HIPAA BAAs** in place? Tampa General Hospital is a named customer and healthcare is a target vertical, but no HIPAA attestation is claimed. | |
| 15 | What is the **EU AI Act role determination** — provider, deployer, or both, and is any system in scope as high-risk? Most vendors overclaim here. This determination is the first AI governance deliverable and should be a documented, defensible analysis rather than a marketing line. | |
| 16 | What is the actual **budget and tooling authority** for this role, and what is the security-review/questionnaire volume per month? The second number is the baseline for the only business metric that matters — see `OPERATING-MODEL.md`. | |
| 17 | Reporting line. The req is filed under **R&D**, which suggests CTO. Confirm. | |
