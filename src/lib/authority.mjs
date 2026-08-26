/**
 * Who was entitled to approve what, on the day they approved it.
 *
 * The repo already required a named approver on every exception — `approved_by` is in
 * exception.schema.json's required list. What it did not have was a referent or an
 * entitlement check, so `approved_by: PLACEHOLDER-approver` validated and CI passed.
 * EX-0001 says so in its own trailing comment: "CI will accept this file; a human will
 * not accept it in an audit."
 *
 * WHY ENTITLEMENT IS DATED RATHER THAN CURRENT-STATE. Authority is a fact about a
 * moment. The person who could accept a risk last March may have left, or may have held
 * the delegation only after a board resolution that postdates the approval on the record.
 * A model that stores only "who can approve today" answers the wrong question at exactly
 * the moment an auditor asks it — reconstructing entitlement from an org chart that has
 * been overwritten is not possible, so the ranges have to be on the record from the start.
 *
 * WHY OWNERSHIP STAYS WITH TEAMS AND APPROVAL WITH PEOPLE. control.schema.json is explicit:
 * owner is "a team, never a person. Person-owned controls die when the person leaves."
 * That is right, and it is a different question. Ownership is durable accountability for a
 * control; approval is a discrete act by a human at a point in time. Conflating them either
 * makes controls fragile or makes approvals unattributable. So `owner` resolves to
 * roster/teams.yaml and `approved_by` resolves to roster/people.yaml, and they are checked
 * separately.
 *
 * Adapted from the departments/people model in SenteLabsAI/OpenExecutive (Apache-2.0).
 * The scope-token idea and the "no non-principal approver" check are theirs; the dated
 * grants and the temporal check are not — upstream stores current state only.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

/** Scope tokens, read from the schema so there is exactly one place to add one. */
export async function authorityScopes(root = '.') {
  const schema = JSON.parse(await readFile(join(root, 'schemas', 'person.schema.json'), 'utf8'));
  return schema.$defs.scope.enum;
}

/** A missing roster file is an empty roster, not a crash — the checks report the gap. */
async function readRoster(path, key) {
  try {
    const parsed = parseYaml(await readFile(path, 'utf8'));
    return { records: parsed?.[key] ?? [], present: true, _file: path };
  } catch (err) {
    if (err.code === 'ENOENT') return { records: [], present: false, _file: path };
    throw new Error(`${path}: ${err.message}`);
  }
}

export async function loadRoster(root = '.') {
  const people = await readRoster(join(root, 'roster', 'people.yaml'), 'people');
  const teams = await readRoster(join(root, 'roster', 'teams.yaml'), 'teams');
  return { people, teams };
}

/**
 * Did this person hold this scope on this date?
 *
 * Three ways to fail, and they are deliberately not collapsed into one boolean by the
 * caller — G12 reports which one, because "the approver had left" and "the delegation
 * did not exist yet" are different findings with different fixes.
 */
export function heldScopeOn(person, scope, onDate) {
  if (!person) return { held: false, reason: 'unknown-person' };
  if (person.departed_on && onDate > person.departed_on) {
    return { held: false, reason: 'departed', detail: `left ${person.departed_on}` };
  }
  const grants = person.authority ?? [];
  const matching = grants.filter((g) => g.scope === scope || g.scope === 'wildcard');
  if (!matching.length) return { held: false, reason: 'no-grant' };

  for (const g of matching) {
    const startedInTime = g.from <= onDate;
    const notYetEnded = !g.until || onDate <= g.until;
    if (startedInTime && notYetEnded) return { held: true, via: g.scope, basis: g.basis ?? '' };
  }
  // Nothing covered the date. Explain with the grant that came CLOSEST to covering it: a
  // delegation that ended three days before the approval is the useful thing to say, and
  // naming whichever grant happened to be first in the array instead sends whoever reads the
  // finding chasing a date that was never the point. Exactly two ways to miss — the grant had
  // not begun (from > onDate) or it had ended (until < onDate) — so the near edge is the one
  // to measure against.
  const missBy = (g) => Math.abs(Date.parse(g.from > onDate ? g.from : g.until) - Date.parse(onDate));
  const nearest = matching.reduce((best, g) => (missBy(g) < missBy(best) ? g : best));
  const of = matching.length > 1 ? ` (nearest of ${matching.length} grants)` : '';
  return nearest.from > onDate
    ? { held: false, reason: 'grant-not-yet-effective', detail: `grant begins ${nearest.from}${of}` }
    : { held: false, reason: 'grant-expired', detail: `grant ended ${nearest.until}${of}` };
}

/**
 * People who could approve `scope` on `onDate`.
 *
 * Non-principals first: routing everything to the principal is the failure mode this is
 * meant to surface, not a satisfactory answer to "who approves this".
 */
export function findApprovers(people, scope, onDate) {
  return people
    .filter((p) => heldScopeOn(p, scope, onDate).held)
    .sort((a, b) => Number(a.is_principal ?? false) - Number(b.is_principal ?? false));
}

/** Scopes with no eligible NON-principal approver on `onDate`. Upstream's check, dated. */
export function uncoveredScopes(people, scopes, onDate) {
  return scopes
    .filter((s) => s !== 'wildcard')
    .filter((s) => !findApprovers(people, s, onDate).some((p) => !p.is_principal));
}

export const byId = (records, key) => new Map(records.map((r) => [r[key], r]));
