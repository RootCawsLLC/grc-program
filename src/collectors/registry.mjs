import { collectIdpIdentities } from './idp.mjs';
import { collectAwsIamPrincipals } from './aws-iam.mjs';
import { collectGithubRepos } from './github.mjs';
import { collectCsvInbox } from './csv-inbox.mjs';

/**
 * Collectors return FULL STATE, not samples, and are scheduled rather than triggered.
 *
 * Design rule: every collector is credential-read-only and every collector has a csv-inbox
 * fallback. The fallback matters more than it looks — on day 1 you will not have API credentials
 * to five systems, and "drop the export in inbox/ and the pipeline treats it identically" is the
 * difference between a pipeline that starts producing evidence in week 1 and one that waits on
 * an access-request queue for a month.
 */
export const COLLECTORS = {
  idp:    { fn: collectIdpIdentities,     scopes: ['users:read'],                     fallback: 'csv-inbox' },
  aws:    { fn: collectAwsIamPrincipals,  scopes: ['iam:GetCredentialReport', 'iam:ListUsers', 'organizations:ListAccounts'], fallback: 'csv-inbox' },
  github: { fn: collectGithubRepos,       scopes: ['repo:read', 'admin:org:read'],    fallback: 'csv-inbox' },
  csv:    { fn: collectCsvInbox,          scopes: [],                                 fallback: null },
};

export async function runCollector(name, config) {
  const entry = COLLECTORS[name];
  if (!entry) throw new Error(`unknown collector: ${name}`);
  try {
    return await entry.fn(config);
  } catch (err) {
    if (entry.fallback === 'csv-inbox') {
      // Never silently substitute. A degraded source must be visible in the record, because
      // confidence tier depends on how the evidence was obtained.
      const rows = await collectCsvInbox({ ...config, source: name });
      return { rows, degraded: true, degraded_reason: `${name} API unavailable (${err.message}); fell back to csv-inbox`, confidence_tier: 3 };
    }
    throw err;
  }
}
