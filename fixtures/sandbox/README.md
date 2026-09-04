# Sandbox fixtures

**NOT REAL EVIDENCE.** Dummy sources for `collect --sandbox` — UAT and demos before a live
tenant is connected. Never present a figure derived from this directory as a measurement of a
real system.

`--sandbox` is a third mode, not a fallback from live collect. A scheduled run that lost its
credentials still refuses. `--sandbox` and `--fixture` cannot be combined: fixture cycles are
pre-landed JSON; sandbox runs the collectors.

## Why these formats

| Source | What this is | What this is not |
|---|---|---|
| `aws/*.csv` | Official IAM credential-report columns (`user`, `arn`, `mfa_active`, `N/A` sentinels) — the same bytes `iam:GetCredentialReport` returns | A house-format rewrite. A live report against the operator SSO account is refused: that call returns every principal in the account and would mix real users into a stamped run. |
| `github/org.json` | File stand-in for the GitHub collector, matching dummy repos `RootCawsLLC/sandbox-uat-*` | A measurement of any real production repo. The REST client, when a token is present, is restricted to the `sandbox-uat-` prefix. |
| `idp/users.json` | Collector-contract identities (`type: SERVICE` by attribute, WebAuthn / TOTP factors). Shape inspired by Okta Users + Factors. | A live IdP tenant. |
| `hris/roster.csv` | csv-inbox roster (`subject_id,passing,reason,first_observed`) | An HRIS API. Marked `degraded` — that is the honesty. |

The AWS population matches the latest `fixtures/landing` cycle so `assert` over the sandbox
warehouse is comparable. GitHub dummy repos are provisioned by `scripts/provision-sandbox-github.mjs`.

## What was not stood up in AWS

This machine can assume `grc-smoke` / `AdministratorAccess-445817184167` via SSO. That session
was not used to generate a credential report or to create IAM users. Either would put real
account principals, or dummy users mixed with real ones, into a run labelled sandbox.
