#!/usr/bin/env node
/**
 * Idempotent: create / update RootCawsLLC/sandbox-uat-* dummy repos for collect --sandbox.
 *
 * These are NOT production systems. Description, README and topics all say so.
 * Restricted to the sandbox-uat- prefix so a later REST collect cannot wander.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const ORG = 'RootCawsLLC';
const API = 'https://api.github.com';
const TRIVY_SHA = 'd2a0b60797ff03db6132bd4e2b293f9b37081297';

const REPOS = [
  {
    name: 'sandbox-uat-prod-app',
    topics: ['production', 'sandbox-uat'],
    protect: false,
    workflow: `# NOT REAL EVIDENCE. Dummy workflow for grc-program UAT. Does not deploy anything.
name: sandbox-uat-ci
on: workflow_dispatch
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aquasecurity/trivy-action@master
        with:
          scan-type: fs
          scan-ref: .
`,
  },
  {
    name: 'sandbox-uat-prod-api',
    topics: ['production', 'sandbox-uat'],
    protect: true,
    workflow: `# NOT REAL EVIDENCE. Dummy workflow for grc-program UAT. Does not deploy anything.
name: sandbox-uat-ci
on: workflow_dispatch
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aquasecurity/trivy-action@${TRIVY_SHA}
        with:
          scan-type: fs
          scan-ref: .
`,
  },
  {
    name: 'sandbox-uat-scratch',
    topics: ['sandbox-uat'],
    protect: false,
    workflow: `# NOT REAL EVIDENCE. Dummy workflow for grc-program UAT. Does not deploy anything.
name: sandbox-uat-ci
on: workflow_dispatch
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aquasecurity/trivy-action@master
        with:
          scan-type: fs
          scan-ref: .
`,
  },
];

const README = `# NOT REAL EVIDENCE

Dummy repository for [grc-program](https://github.com/RootCawsLLC/grc-program) sandbox UAT.

This is not a production system. The \`production\` topic (where present) exists so the
GitHub collector's population predicate can see it. Do not deploy from here. Do not store
credentials here.
`;

async function token() {
  if (process.env.GH_TOKEN?.trim()) return process.env.GH_TOKEN.trim();
  const { stdout } = await exec('gh', ['auth', 'token']);
  const t = stdout.trim();
  if (!t) throw new Error('no GH_TOKEN and `gh auth token` was empty');
  return t;
}

function headers(t) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${t}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'grc-program-sandbox-provision',
  };
}

async function gh(t, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...headers(t), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.message ?? text.slice(0, 240);
    const err = new Error(`GitHub ${res.status} ${method} ${path}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function putFile(t, repo, path, content, message) {
  let sha;
  try {
    const existing = await gh(t, 'GET', `/repos/${ORG}/${repo}/contents/${path}`);
    sha = existing.sha;
  } catch (err) {
    if (err.status !== 404) throw err;
  }
  await gh(t, 'PUT', `/repos/${ORG}/${repo}/contents/${path}`, {
    message,
    content: Buffer.from(content).toString('base64'),
    ...(sha ? { sha } : {}),
  });
}

async function ensureRepo(t, spec) {
  try {
    await gh(t, 'GET', `/repos/${ORG}/${spec.name}`);
    console.log(`  exists   ${ORG}/${spec.name}`);
  } catch (err) {
    if (err.status !== 404) throw err;
    await gh(t, 'POST', '/user/repos', {
      name: spec.name,
      description: 'NOT REAL EVIDENCE. UAT dummy for the grc-program GitHub collector. Not a production system.',
      homepage: 'https://github.com/RootCawsLLC/grc-program',
      private: false,
      auto_init: true,
      has_issues: false,
      has_projects: false,
      has_wiki: false,
    });
    console.log(`  created  ${ORG}/${spec.name}`);
    await new Promise((r) => setTimeout(r, 1500));
  }

  await putFile(t, spec.name, 'README.md', README, 'sandbox-uat: stamp the README');
  await putFile(t, spec.name, '.github/workflows/ci.yml', spec.workflow, 'sandbox-uat: dummy workflow');
  await gh(t, 'PUT', `/repos/${ORG}/${spec.name}/topics`, { names: spec.topics });

  if (spec.protect) {
    await gh(t, 'PUT', `/repos/${ORG}/${spec.name}/branches/main/protection`, {
      required_status_checks: null,
      enforce_admins: false,
      required_pull_request_reviews: {
        required_approving_review_count: 1,
        dismiss_stale_reviews: true,
      },
      restrictions: null,
      allow_force_pushes: false,
      allow_deletions: false,
    });
    console.log(`  protect  ${ORG}/${spec.name}#main`);
  }
}

const t = await token();
console.log(`\nProvisioning ${ORG}/sandbox-uat-* dummy repos (NOT REAL EVIDENCE)\n`);
for (const spec of REPOS) await ensureRepo(t, spec);
console.log('\nDone. collect --sandbox with GH_TOKEN will REST these; without a token it uses fixtures/sandbox/github/org.json.\n');
