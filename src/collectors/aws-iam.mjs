/**
 * AWS IAM principal collector.
 *
 * Evidence source is the IAM credential report — the single best first collector in any AWS
 * estate: unambiguous denominator, one API call, and it carries native timestamps
 * (password_last_used, access_key_1_last_rotated) which give variance_started_at at
 * source-timestamp quality rather than the interpolation everyone settles for.
 */
export async function collectAwsIamPrincipals({ client, accounts = [] }) {
  if (!client) throw new Error('collectAwsIamPrincipals requires an AWS client (injected for testability)');

  const rows = [];
  for (const account of accounts) {
    const report = await client.getCredentialReport(account);
    for (const p of report) {
      const hasStaticKey = p.access_key_1_active || p.access_key_2_active;
      const isRoot = p.user === '<root_account>';
      const mfaOn = Boolean(p.mfa_active);

      rows.push({
        subject_id: `${account}:${p.user}`,
        passing: mfaOn && !hasStaticKey,
        reason: !mfaOn
          ? (isRoot ? 'root_without_mfa' : 'no_mfa_device')
          : hasStaticKey
            ? 'long_lived_access_key_present'
            : null,
        // Source timestamp, not collection timestamp. This is what makes VD real.
        first_observed: p.access_key_1_last_rotated ?? p.user_creation_time ?? null,
        _meta: { account, is_root: isRoot },
      });
    }
  }
  return { rows, degraded: false, confidence_tier: 4 };
}
