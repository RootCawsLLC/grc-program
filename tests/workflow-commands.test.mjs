import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * A workflow may not invoke a command that does not exist.
 *
 * ccm.yml has invoked `cli.mjs collect`, `assert`, `drift` and `route` since the repository was
 * created. None of them are implemented. Nothing noticed, because the dispatcher treated an unknown
 * command as a request for help and exited 0 — so the steps did not merely fail quietly, they
 * PASSED. See #9.
 *
 * The dispatcher fix makes that a red build at run time. This makes it a red build at `npm test`,
 * which is earlier and is the part a pull request actually shows. A scheduled workflow's failure is
 * only seen by whoever opens the mail.
 *
 * TWO THINGS THIS GUARD MUST NOT DO.
 *
 * It must not pass vacuously. A regex over source that silently matches nothing would report
 * success while checking zero commands — the same class of bug it exists to catch. Both extractors
 * therefore assert they found something before any comparison runs.
 *
 * It must not cry wolf. ci.yml runs `npm run build` inside `working-directory: .proofplane/target`,
 * which is a checkout of a DIFFERENT repository with its own package.json. A naive text scan flags
 * that as missing; it is correct. So the workflows are parsed as YAML and each step's effective
 * working directory is resolved before the step is considered.
 */

const WORKFLOW_DIR = '.github/workflows';

/**
 * Command names defined by src/cli.mjs.
 *
 * Read from source rather than imported: cli.mjs dispatches and calls process.exit at module
 * scope, so importing it would run the CLI and kill the test process. If cli.mjs is ever
 * refactored to export its command names, replace this with the import.
 */
function definedCliCommands() {
  const src = readFileSync('src/cli.mjs', 'utf8');
  const names = [...src.matchAll(/^ {2}(?:async )?([a-z]+)\(\)\s*\{/gm)].map((m) => m[1]);
  assert.ok(
    names.length >= 5 && names.includes('validate') && names.includes('help'),
    `parsed ${names.length} command(s) out of src/cli.mjs and expected the commands map. ` +
      'The parse has broken, and a guard that extracts nothing passes everything — fix the ' +
      'extractor rather than deleting this assertion.'
  );
  return names;
}

function definedNpmScripts() {
  const scripts = Object.keys(JSON.parse(readFileSync('package.json', 'utf8')).scripts ?? {});
  assert.ok(scripts.includes('test'), 'package.json scripts did not parse');
  return scripts;
}

/**
 * Every `run:` step across every workflow whose effective working directory is the repo root.
 *
 * Precedence for the working directory is step, then job defaults, then workflow defaults. Anything
 * that is not the root belongs to another checkout and is not ours to resolve.
 */
function allRunSteps() {
  const steps = [];
  for (const file of readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f))) {
    const wf = parseYaml(readFileSync(join(WORKFLOW_DIR, file), 'utf8'));
    const wfDir = wf?.defaults?.run?.['working-directory'];
    for (const [jobName, job] of Object.entries(wf?.jobs ?? {})) {
      const jobDir = job?.defaults?.run?.['working-directory'] ?? wfDir;
      for (const step of job?.steps ?? []) {
        if (typeof step?.run !== 'string') continue;
        const dir = step['working-directory'] ?? jobDir ?? '.';
        steps.push({ file, job: jobName, name: step.name ?? '(unnamed)', run: step.run, dir });
      }
    }
  }
  return steps;
}

const rootRunSteps = () => allRunSteps().filter((s) => s.dir === '.' || s.dir === './');

const cliRefs = (run) => [...run.matchAll(/cli\.mjs\s+([a-z][a-z:-]*)/g)].map((m) => m[1]);
const npmRefs = (run) => [...run.matchAll(/npm run\s+([a-z][a-z:-]*)/g)].map((m) => m[1]);

/**
 * Commands a workflow references that are known not to exist yet, each with the unit that builds
 * it. Declared rather than silent, the same way an unpopulated cost carries a PLACEHOLDER basis.
 *
 * This is not permission to add more. A new unresolvable reference fails the build; adding a line
 * here is a deliberate act with a named owner, and the exactness test below deletes the excuse as
 * soon as the command lands.
 */
const NOT_BUILT_YET = {
  collect: 'BUILD-ORDER B2/B5 — collectors have never run against a live tenant',
  assert: 'BUILD-ORDER B2 — needs a collection to assert over',
  drift: 'BUILD-ORDER B2 — needs a denominator to drift against',
  route: 'BUILD-ORDER B4 — exception routing',
};

test('the guard actually scans something', () => {
  // Anti-vacuity. If the workflow parse or the reference extraction breaks, every test below
  // passes while checking nothing at all.
  const steps = rootRunSteps();
  assert.ok(steps.length >= 5, `found only ${steps.length} root run-steps across ${WORKFLOW_DIR}`);
  const refs = steps.flatMap((s) => [...cliRefs(s.run), ...npmRefs(s.run)]);
  assert.ok(refs.length >= 5, `extracted only ${refs.length} command references from those steps`);
});

test('no workflow invokes a cli.mjs command that does not exist', () => {
  const defined = definedCliCommands();
  const unresolved = [];
  for (const step of rootRunSteps()) {
    for (const cmd of new Set(cliRefs(step.run))) {
      if (defined.includes(cmd) || cmd in NOT_BUILT_YET) continue;
      unresolved.push(`${step.file} [${step.name}] -> cli.mjs ${cmd}`);
    }
  }
  assert.deepEqual(
    unresolved,
    [],
    'a workflow invokes a cli.mjs command that is not implemented. Since #9 the CLI exits 1 on ' +
      'an unknown command, so this would be a red run — but a scheduled run is only red where ' +
      `somebody looks.\n  ${unresolved.join('\n  ')}`
  );
});

test('no workflow invokes an npm script that does not exist', () => {
  const scripts = definedNpmScripts();
  const unresolved = [];
  for (const step of rootRunSteps()) {
    for (const name of new Set(npmRefs(step.run))) {
      if (scripts.includes(name)) continue;
      unresolved.push(`${step.file} [${step.name}] -> npm run ${name}`);
    }
  }
  assert.deepEqual(unresolved, [], `unresolved npm scripts:\n  ${unresolved.join('\n  ')}`);
});

test('the not-built-yet list is exact — an entry that now exists must be removed', () => {
  // Stops the list rotting into a permanent exemption. The moment `collect` is implemented, this
  // fails and says so, rather than leaving a hole in the guard nobody remembers opening.
  const defined = definedCliCommands();
  const stale = Object.keys(NOT_BUILT_YET).filter((c) => defined.includes(c));
  assert.deepEqual(
    stale,
    [],
    `these commands now exist in src/cli.mjs and must be deleted from NOT_BUILT_YET: ${stale.join(', ')}`
  );
});

test('every not-built-yet entry is actually referenced by a workflow', () => {
  // The other direction: an exemption for a command nothing invokes is dead weight, and dead
  // weight in a guard is what makes the next reader distrust the whole list.
  const referenced = new Set(rootRunSteps().flatMap((s) => cliRefs(s.run)));
  const orphans = Object.keys(NOT_BUILT_YET).filter((c) => !referenced.has(c));
  assert.deepEqual(orphans, [], `NOT_BUILT_YET entries no workflow references: ${orphans.join(', ')}`);
});

/**
 * No workflow may push, commit, or otherwise write to a repository.
 *
 * Guardrail 2: "A pull request is the only path to normative. A human merges. The merge is the
 * control." A scheduled job that commits artifacts to the default branch is precisely what that
 * rule exists to prevent — the artifacts arrive normative without anyone having merged them.
 *
 * ccm.yml carried such a step from the day the repository was created. It could not work — `out/`
 * is gitignored, `evidence/` never existed, and the token is read-only — so it staged nothing and
 * exited 0 forever (#7). It was removed rather than repaired: repairing it meant granting
 * contents: write and having ccm-bot push to main, which trades a broken step for a broken
 * control.
 *
 * This is the part that stops it coming back. The failure mode is not someone deciding to bypass
 * the rule; it is someone fixing the *symptom* — pointing the step at a real path and adding the
 * permission — without noticing which control they just dissolved.
 */
test('no workflow commits or pushes to a repository', () => {
  const offenders = [];
  for (const step of allRunSteps()) {
    for (const [pattern, what] of [
      [/git\s+push/, 'git push'],
      [/git\s+commit/, 'git commit'],
      [/gh\s+pr\s+merge/, 'gh pr merge'],
    ]) {
      if (pattern.test(step.run)) offenders.push(`${step.file} [${step.name}] -> ${what}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'a workflow writes to a repository. Guardrail 2 makes the human merge the control; a job that\n' +
      'commits or pushes routes around it. If evidence needs to survive the runner, that is\n' +
      `warehouse work (B1/B22), not a git push from CI.\n  ${offenders.join('\n  ')}`
  );
});

test('the workflows still declare a read-only contents permission', () => {
  // The other half of the same control. Dropping the commit step matters little if the next change
  // quietly escalates the token; contents: write is what makes a push possible in the first place.
  const escalated = [];
  for (const file of readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f))) {
    const wf = parseYaml(readFileSync(join(WORKFLOW_DIR, file), 'utf8'));
    const scopes = [['(workflow)', wf?.permissions]].concat(
      Object.entries(wf?.jobs ?? {}).map(([n, j]) => [n, j?.permissions])
    );
    for (const [where, perms] of scopes) {
      if (perms && perms.contents && perms.contents !== 'read') {
        escalated.push(`${file} [${where}] -> contents: ${perms.contents}`);
      }
    }
  }
  assert.deepEqual(escalated, [], `contents write access granted:\n  ${escalated.join('\n  ')}`);
});

test('a step in another checkout is not held to this repo package.json', () => {
  // ci.yml builds proofplane's probe target in working-directory: .proofplane/target, which has
  // its own package.json. `npm run build` there is correct and must not be reported. This pins the
  // behaviour so a future "simplification" to a plain grep gets caught.
  const inRoot = rootRunSteps().some((s) => npmRefs(s.run).includes('build'));
  assert.equal(inRoot, false, 'a step outside the repo root was scanned as if it were in it');
  const raw = readFileSync(join(WORKFLOW_DIR, 'ci.yml'), 'utf8');
  assert.match(raw, /npm run build/, 'the case this test pins has gone — re-point or delete it');
});
