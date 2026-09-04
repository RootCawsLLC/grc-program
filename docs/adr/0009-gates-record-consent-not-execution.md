# ADR-0009 — Gates record consent; they do not execute

**Status:** accepted · **Date:** 2026-09-04 · **Supersedes:** none

## Context

The inbound event host presents a pending action on Slack, GitHub or Linear and records a named
human's decision. The natural next step — and the one the YC "autonomous InfoSec department"
blueprint asks for — is for the Approve button to merge the PR, accept the risk, or change the
firewall.

That would dissolve guardrail 2. The merge is the control. A Slack click that applied a write
would make the chat log the system of record and the Git history a projection of it, which is
the inverse of this repository.

It would also invent an approver. Slack's `user.id` is a workspace identifier. It is not a
`per.*` person_id, it is not a dated grant, and it does not carry an `expires_on`. Mapping it
by display name, or treating an 85% model self-score as a stand-in for a named human, is how a
bot starts signing risk.

The presenter contract is the same shape as Scytale (ADR-0001): a guessed Slack body produces a
message that looks like a gate and is not one. `CONTRACT_CONFIRMED` stays false until a human
reconciles the payload against the live API. A silent no-op send is forbidden for the same
reason a silent no-op collect is forbidden — the next "fix" is the first real contact.

## Decision

**Consent is not execution.** `openGate`, `decideGate`, `sendPresenter` and the dispatch host
return `executed: false` on every path, including a successful live post after the contract is
confirmed. The next step named on the gate is a human action on the surface that actually
performs it: `human-merges-on-github`, `human-opens-acceptance-pr`, `human-changes-cloud`.

**Risk and exception decisions require a named `per.*` actor and a future `expires_on`.** If a
roster is present, entitlement is the dated `heldScopeOn` check (G12). Cloud writes and pages
are acknowledge-only; they are not consentable.

**A Slack user or GitHub account is not a person.** Joining `user.id` / `sender.id` onto
`per.*` is an explicit map. Usernames, logins and display names are not identity. Unmapped
users are refused. An unsigned or replayed Slack request is refused. GitHub's HMAC does not
bind a timestamp — replay protection is a delivery-id at a listener that does not exist yet.
There is no HTTP listener in this repository; verification is a function so a half-wired
server cannot become the first real inbound.

Synthetic and real gates do not share a log. Fixture events carry `NOT REAL EVIDENCE` and
`loadEvent` refuses an unstamped file under `fixtures/`.

## Consequences

**Good.** Clicking Record consent cannot merge, cannot accept residual risk, and cannot change
cloud. The Git history, the exceptions PR, and the cloud console stay the surfaces a later
auditor can reconstruct. The same refusal that keeps Scytale from silently wrong-pushing keeps
Slack from silently acting.

**Bad.** A human still has to merge. That slowness is the product, not a backlog item. Live
send stays dark until the contract is confirmed; inbound HTTP stays unbuilt until someone
decides to listen.

**Revisit if** a dated, named human can merge from this repo without the GitHub merge being
the control — which is to say, do not revisit.
