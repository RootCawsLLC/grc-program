/**
 * GitHub repository control collector.
 *
 * Branch protection settings ARE the control. Not a policy describing them, not a screenshot of
 * the settings page — the API response is the control state.
 *
 * The SHA-pin check exists because of the March 2026 trivy-action tag force-push (GHSA-69fq-xp46-6x23, CVE-2026-33634),
 * where 76 of 77 tags were rewritten to malicious commits stealing CI cloud credentials. Tag
 * references are mutable regardless of what the immutability badge implies.
 */
const SHA_REF = /@[0-9a-f]{40}$/;

export async function collectGithubRepos({ client, org, productionTopics = ['production'] }) {
  if (!client) throw new Error('collectGithubRepos requires a GitHub client (injected for testability)');

  const repos = await client.listRepos(org);
  const rows = [];

  for (const repo of repos) {
    const topics = repo.topics ?? [];
    if (!productionTopics.some((t) => topics.includes(t))) continue; // population = production-deploying repos

    const protection = await client.getBranchProtection(org, repo.name, repo.default_branch);
    const workflows = await client.listWorkflowFiles(org, repo.name);

    const unpinned = [];
    for (const wf of workflows) {
      for (const uses of wf.uses ?? []) {
        if (uses.startsWith('actions/') || uses.startsWith('./')) continue; // first-party and local
        if (!SHA_REF.test(uses)) unpinned.push(`${wf.path}: ${uses}`);
      }
    }

    const reasons = [];
    if (!protection?.enabled) reasons.push('no_branch_protection');
    if (!protection?.required_reviews) reasons.push('no_required_review');
    if (protection?.allow_force_pushes) reasons.push('force_push_permitted');
    if (unpinned.length) reasons.push(`unpinned_third_party_actions:${unpinned.length}`);

    rows.push({
      subject_id: `${org}/${repo.name}`,
      passing: reasons.length === 0,
      reason: reasons.join('; ') || null,
      first_observed: protection?.updated_at ?? repo.pushed_at ?? null,
      _meta: { unpinned },
    });
  }
  return { rows, degraded: false, confidence_tier: 4 };
}
