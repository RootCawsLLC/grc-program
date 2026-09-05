# Security

## Reporting

grc-program is a private, single-owner system of record. Report any security
concern directly to the owner through the normal internal channel — do not open a
public issue.

## Dependency posture

`npm audit` is clean at the repository root (0 vulnerabilities). Re-run it before
each release:

```bash
npm audit                 # root (the tool)
cd web && npm audit       # the web demo
```

### Accepted risks (no safe fix today)

| Item | Severity | Why it is accepted | Re-check |
| --- | --- | --- | --- |
| `postcss` in `web/` (transitive via Next.js) | HIGH | The only remediation is a **breaking Next.js major upgrade**. The web app is a demo that processes only its own CSS at build time, so runtime exposure is negligible. | `cd web && npm audit`; take the fix when Next.js is next upgraded. |

When an accepted item gains a non-breaking fix, apply it and remove the row.

## Handling of real data

- Never commit real evidence: bundles name accounts, roles, buckets and failing
  resources. Everything under `fixtures/` is synthetic and stamped.
- `intake/source/` is NDA-gated and watermarked; nothing there is committed.
- Third-party GitHub Actions are pinned to full commit SHAs (see
  `controls/ctl.appsec.ci-cd.branch-protection.yaml`).
