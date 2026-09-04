/**
 * Read-only GitHub REST client for the repo collector.
 *
 * listRepos / getBranchProtection / listWorkflowFiles — the three calls the collector makes.
 * Branch protection 404 is "not enabled", not an error: that is the control state.
 */

import { parseWorkflowUses } from '../parse-workflow-uses.mjs';

const API = 'https://api.github.com';

export function sandboxRepoFilter(repos, { prefix = 'sandbox-uat-' } = {}) {
  return repos.filter((r) => r.name.startsWith(prefix));
}

export function createGithubRestClient({
  token,
  fetchImpl = globalThis.fetch,
  userAgent = 'grc-program-sandbox',
} = {}) {
  if (!token || !String(token).trim()) {
    throw new Error('GitHub REST client requires a token (GH_TOKEN)');
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': userAgent,
  };

  async function request(path, { allow404 = false } = {}) {
    const res = await fetchImpl(`${API}${path}`, { headers });
    if (allow404 && res.status === 404) return null;
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub ${res.status} ${path}: ${body.slice(0, 240)}`);
    }
    return res.json();
  }

  return {
    async listRepos(owner) {
      const profile = await request(`/users/${owner}`);
      const listBase = profile.type === 'Organization'
        ? `/orgs/${owner}/repos`
        : `/users/${owner}/repos`;
      const repos = [];
      for (let page = 1; page <= 20; page++) {
        const batch = await request(`${listBase}?per_page=100&page=${page}&type=all`);
        if (!Array.isArray(batch) || batch.length === 0) break;
        for (const r of batch) {
          repos.push({
            name: r.name,
            default_branch: r.default_branch,
            topics: r.topics ?? [],
            pushed_at: r.pushed_at ?? null,
          });
        }
        if (batch.length < 100) break;
      }
      return repos;
    },

    async getBranchProtection(org, repo, branch) {
      const body = await request(
        `/repos/${org}/${repo}/branches/${encodeURIComponent(branch)}/protection`,
        { allow404: true },
      );
      if (!body) {
        return { enabled: false, required_reviews: false, allow_force_pushes: false, updated_at: null };
      }
      return {
        enabled: true,
        required_reviews: Boolean(body.required_pull_request_reviews),
        allow_force_pushes: body.allow_force_pushes?.enabled === true,
        updated_at: null,
      };
    },

    async listWorkflowFiles(org, repo) {
      const listing = await request(`/repos/${org}/${repo}/contents/.github/workflows`, { allow404: true });
      if (!Array.isArray(listing)) return [];

      const files = [];
      for (const f of listing) {
        if (!f?.path || !/\.ya?ml$/.test(f.name ?? '')) continue;
        const file = await request(`/repos/${org}/${repo}/contents/${encodeURI(f.path)}`);
        const text = Buffer.from(file.content.replace(/\n/g, ''), 'base64').toString('utf8');
        files.push({ path: f.path, uses: parseWorkflowUses(text) });
      }
      return files;
    },
  };
}

/** Restricts listRepos to sandbox-uat-* so a sandbox run cannot measure a real production repo. */
export function restrictToSandboxRepos(client, { prefix = 'sandbox-uat-' } = {}) {
  return {
    listRepos: async (org) => sandboxRepoFilter(await client.listRepos(org), { prefix }),
    getBranchProtection: (org, repo, branch) => client.getBranchProtection(org, repo, branch),
    listWorkflowFiles: (org, repo) => client.listWorkflowFiles(org, repo),
  };
}
