/**
 * Loading assertion records, and the one rule that governs it: synthetic and real evidence never
 * mix in the same set.
 *
 * WHY THIS IS A HARD FAILURE RATHER THAN A WARNING. Every artifact this repo emits — OSCAL
 * assessment results, the Scytale payload, control health, the gap assessment — is a projection of
 * an assertion set. If one synthetic record reaches a set that is otherwise real, the projection is
 * partly fabricated and there is nothing on its face that says so. An auditor receives a document
 * that is right about 40 controls and invented about the 41st, which is worse than one that is
 * obviously synthetic and worse than none at all.
 *
 * A warning does not help: warnings are read by whoever already knew. So the loader refuses, names
 * the records on both sides, and exits.
 *
 * The flag is declared in schemas/assertion.schema.json precisely because that schema sets
 * additionalProperties:false. Without a declared field the stamp could not ride on the record, and
 * a fixture-generated assertion would be byte-identical in shape to a real collection.
 */

import { readFile } from 'node:fs/promises';

export const FIXTURE_STAMP = 'NOT REAL EVIDENCE';

/** True for `fixtures/…` and `…/fixtures/…`, Windows or POSIX. */
export function isUnderFixtures(path) {
  return /(^|\/)fixtures\//.test(String(path).replace(/\\/g, '/'));
}

/** A record is real unless it says otherwise. Absence of the flag is not ambiguity. */
export const isFixture = (a) => a?.fixture === true;

/** True when ANY record in the set is synthetic — which taints every artifact derived from it. */
export const isFixtureSet = (assertions) => assertions.some(isFixture);

/**
 * Refuses a set that mixes synthetic and real records.
 *
 * Returns the set unchanged when it is uniform, so this composes as `assertNotMixed(await load())`.
 */
export function assertNotMixed(assertions, source = 'assertion set') {
  if (!Array.isArray(assertions)) {
    throw new TypeError(`${source}: expected an array of assertion records`);
  }

  const synthetic = assertions.filter(isFixture);
  const real = assertions.filter((a) => !isFixture(a));
  if (!synthetic.length || !real.length) return assertions;

  const name = (a) => `${a.control_id ?? '<no control_id>'}@${a.as_of ?? '<no as_of>'}`;
  const show = (list) => list.slice(0, 5).map(name).join('\n      ') +
    (list.length > 5 ? `\n      … and ${list.length - 5} more` : '');

  throw new Error(
    `${source}: refusing a set that mixes synthetic and real evidence.\n` +
    `  ${synthetic.length} record(s) carry fixture:true —\n      ${show(synthetic)}\n` +
    `  ${real.length} record(s) do not, and are therefore real —\n      ${show(real)}\n` +
    `\n` +
    `  Every artifact derived from this set would be partly fabricated with nothing on its face\n` +
    `  to say which part. Keep synthetic runs in their own directory and their own set.`
  );
}

/**
 * Reads an assertion set from disk. A missing file is an empty set, not an error: most commands
 * are useful before any collection has run, and failing here would make `npm run health` depend on
 * a pipeline that has not been wired yet.
 */
export async function loadAssertions(path = 'fixtures/assertions.json') {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw new Error(`${path}: ${err.message}`);
  }
  const assertions = Array.isArray(parsed) ? parsed : [parsed];
  return assertNotMixed(assertions, path);
}

/**
 * The sentence appended to any artifact built from a synthetic set. Callers decide where it goes —
 * an OSCAL title, a description, a line on stdout — but they all say the same thing.
 */
export const fixtureNotice = (what = 'This artifact') =>
  `${FIXTURE_STAMP}. ${what} was generated from synthetic fixture records and is not submittable, ` +
  `not an audit artifact, and not a measurement of any real system.`;
