/**
 * File-backed IdP client. Shape is the collector's contract (type attribute, listFactors),
 * inspired by Okta Users + Factors — not a verbatim Okta tenant dump, and not a live tenant.
 */

export function createIdpFileClient(doc) {
  const users = doc.users ?? [];

  return {
    async listUsers({ status } = {}) {
      return users
        .filter((u) => !status || u.status === status)
        .map(({ factors: _factors, ...u }) => u);
    },

    async listFactors(id) {
      const u = users.find((x) => x.id === id);
      return u?.factors ?? [];
    },
  };
}
