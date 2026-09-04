/**
 * Pulls `uses:` refs out of a GitHub Actions workflow. The SHA-pin check in the GitHub
 * collector is over these strings; first-party / local filtering happens there, not here.
 */
const USES = /^\s+-?\s*uses:\s*['"]?([^\s'"#]+)/gm;

export function parseWorkflowUses(text) {
  const uses = [];
  for (const m of String(text).matchAll(USES)) uses.push(m[1]);
  return uses;
}
