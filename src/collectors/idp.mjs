/**
 * Enterprise IdP identity collector.
 *
 * The population is human identities only. Getting the service-principal exclusion right is the
 * whole control: including them makes MFA coverage look permanently broken, excluding them
 * sloppily lets a human account hide behind a service-account naming convention. Exclusion is by
 * IdP type attribute, never by name pattern.
 */
export async function collectIdpIdentities({ client, includeContractors = true }) {
  if (!client) throw new Error('collectIdpIdentities requires an IdP client (injected for testability)');

  const users = await client.listUsers({ status: 'ACTIVE' });
  const rows = [];

  for (const u of users) {
    if (u.type === 'SERVICE') continue;                 // excluded by type attribute, not by name
    if (!includeContractors && u.userType === 'CONTRACTOR') continue;

    const factors = await client.listFactors(u.id);
    const phishingResistant = factors.some((f) => ['WEBAUTHN', 'FIDO2'].includes(f.factorType) && f.status === 'ACTIVE');
    const anyFactor = factors.some((f) => f.status === 'ACTIVE');

    rows.push({
      subject_id: u.id,
      passing: phishingResistant,
      reason: !anyFactor ? 'no_factor_enrolled' : !phishingResistant ? 'no_phishing_resistant_factor' : null,
      first_observed: u.lastUpdated ?? u.created ?? null,
      _meta: { entity: u.profile?.entity ?? 'unknown', userType: u.userType },
    });
  }
  return { rows, degraded: false, confidence_tier: 4 };
}
