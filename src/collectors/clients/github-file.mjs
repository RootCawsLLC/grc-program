/**
 * File-backed GitHub client. Same methods as the REST client, so the collector cannot tell
 * which one it was handed. Used by tests and by `collect --sandbox` when no token is present.
 */

export function createGithubFileClient(doc) {
  const repos = doc.repos ?? [];
  const byName = new Map(repos.map((r) => [r.name, r]));

  return {
    async listRepos(_org) {
      return repos.map((r) => ({
        name: r.name,
        default_branch: r.default_branch ?? 'main',
        topics: r.topics ?? [],
        pushed_at: r.pushed_at ?? null,
      }));
    },

    async getBranchProtection(_org, name, _branch) {
      const repo = byName.get(name);
      if (!repo) return { enabled: false, required_reviews: false, allow_force_pushes: false, updated_at: null };
      const p = repo.protection ?? {};
      return {
        enabled: Boolean(p.enabled),
        required_reviews: Boolean(p.required_reviews),
        allow_force_pushes: Boolean(p.allow_force_pushes),
        updated_at: p.updated_at ?? repo.pushed_at ?? null,
      };
    },

    async listWorkflowFiles(_org, name) {
      const repo = byName.get(name);
      return (repo?.workflows ?? []).map((wf) => ({
        path: wf.path,
        uses: wf.uses ?? [],
      }));
    },
  };
}
