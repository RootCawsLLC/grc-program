#!/usr/bin/env node
// Arms the commit-identity guard for this clone.
//
// Runs from `npm run setup` and, more importantly, automatically from npm's `prepare` hook
// on `npm install`. That automation is the point: neither git hooks nor local git config
// survive a clone, so a fresh checkout otherwise has no identity configured and no guard,
// and the first commit is authored wrongly — which the RootCawsLLC account rejects on push
// and which can only be fixed by rewriting history. `npm install` is the one command nobody
// skips, so it is the right place to close that window.
//
// This never fails an install. Not being a git checkout is a normal state (an extracted
// tarball, a vendored copy, the zip handed to someone else), not an error worth breaking
// `npm install` over.

import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AUTHOR_NAME = 'RootCawsLLC';
const AUTHOR_EMAIL = '317738477+RootCawsLLC@users.noreply.github.com';
const HOOKS_PATH = '.githooks';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// A missing git binary reports status null rather than a non-zero exit, so test for 0.
const git = (...args) => spawnSync('git', args, { cwd: packageRoot, encoding: 'utf8' });
const gitValue = (...args) => {
  const result = git(...args);
  return result.status === 0 ? result.stdout.trim() : null;
};

const topLevel = gitValue('rev-parse', '--show-toplevel');
if (topLevel === null) process.exit(0);

/**
 * Only arm the repo we are actually the root of. If grc-program has been vendored into some larger
 * checkout, the enclosing repo has its own identity rules and none of this applies.
 *
 * COMPARE REAL PATHS, NOT STRINGS. `packageRoot` comes from import.meta.url and reflects how node
 * was invoked; `topLevel` comes from git, which always reports the canonical long form. On Windows
 * those disagree whenever the tree is reached through an 8.3 short name —
 *
 *   packageRoot        C:\Users\ADMINI~1\AppData\Local\Temp\...
 *   git --show-toplevel C:/Users/Administrator/AppData/Local/Temp/...
 *
 * — which are the SAME directory. A raw string comparison reads that as "vendored somewhere else"
 * and exits silently, so the guard never arms in a tree it should have armed. That is the same
 * failure this file was being fixed for, wearing a different hat, and it was found by a test that
 * happened to run out of the temp directory.
 */
const samePath = (a, b) => {
  const canonical = (p) => {
    let out;
    try { out = realpathSync.native(p); } catch { out = resolve(p); }
    // Windows paths are case-insensitive, and the drive letter's case is not stable either.
    return process.platform === 'win32' ? out.toLowerCase() : out;
  };
  return canonical(a) === canonical(b);
};

if (!samePath(topLevel, packageRoot)) process.exit(0);

/**
 * THE HOOK MAY BE ABSENT, AND THAT IS EXACTLY WHEN TO SPEAK UP.
 *
 * This used to `process.exit(0)` here, silently. The silence was the bug: a tree with no
 * .githooks/pre-commit is precisely the tree where nobody should assume the guard is running, and
 * it said nothing at all.
 *
 * It happened. On 2026-08-22 a session worked in a worktree branched from an imported history whose
 * tree carried neither .githooks/ nor this script. `core.hooksPath` is the RELATIVE string
 * '.githooks', and git resolves a relative hooksPath against the top level of EACH working tree, so
 * nothing ran there. That session believed it was hook-protected. Its commits happened to be
 * authored correctly, but only because user.name and user.email were pinned in the shared config —
 * the weaker protection, and not the one it thought was holding.
 *
 * The path stays RELATIVE. An absolute path would resolve everywhere, and would also rot the moment
 * a checkout moves — which is not hypothetical on this machine either: a stale
 * node_modules/.bin/oscal-cli.bat still pointed at C:\Users\Administrator\cui-control-plane long
 * after that repo moved into agent-workspace, and failed silently when used. Trading a silent
 * failure for a different silent failure is not a fix.
 */
const hookPresent = existsSync(join(packageRoot, HOOKS_PATH, 'pre-commit'));

// Identity is pinned whether or not the hook is available. A tree with no hook is strictly better
// off with the right author configured than with whatever git would otherwise infer from the
// global config or the machine's hostname — which is how `Susan Shepard <your@email>` reached a
// published history in the first place.
//
// core.hooksPath is set ONLY when the hook exists. Pointing it at a directory with no hooks would
// silently disable any hooks that were in .git/hooks, making things worse rather than better.
const settings = [
  ['user.name', AUTHOR_NAME],
  ['user.email', AUTHOR_EMAIL],
  ...(hookPresent ? [['core.hooksPath', HOOKS_PATH]] : []),
];

const changed = [];
for (const [key, value] of settings) {
  if (gitValue('config', '--local', '--get', key) === value) continue;
  if (git('config', '--local', key, value).status === 0) changed.push(key);
}

if (!hookPresent) {
  // Warned EVERY time, not only when something changed. An unarmed guard is a persistent condition,
  // not an event: whoever is about to commit here needs telling now, not on the one install where a
  // config value happened to move.
  //
  // Non-fatal on purpose. An extracted tarball or a vendored copy must still be able to
  // `npm install`, and breaking that would be a worse failure than the one this warns about.
  console.warn(`grc-program: WARNING - the commit-identity guard is NOT armed in this tree.`);
  console.warn(`  tree:    ${packageRoot}`);
  console.warn(`  missing: ${HOOKS_PATH}/pre-commit`);
  console.warn('');
  console.warn(`  What still protects you: user.name and user.email are pinned to`);
  console.warn(`    ${AUTHOR_NAME} <${AUTHOR_EMAIL}>`);
  console.warn('  so a commit here will not silently pick up an inferred identity.');
  console.warn('');
  console.warn('  What does NOT protect you: nothing refuses a deliberate override.');
  console.warn('    git -c user.email=someone@example.com commit ...   would be accepted here.');
  console.warn('    Committing in the primary checkout is not refused here either.');
  console.warn('');
  console.warn('  Fix: work in a tree that contains .githooks/, which every checkout of main does:');
  console.warn('    node ~/.claude/scripts/worktree.mjs add ~/agent-workspace/grc-program <branch>');
  process.exit(0);
}

// Report only when something moved: a silent no-op on every `npm install` is noise, but a
// silent *change* to how commits are authored is worse.
if (changed.length > 0) {
  console.log(`grc-program: armed the commit-identity guard (${changed.join(', ')}).`);
  console.log(`  commits are now authored ${AUTHOR_NAME} <${AUTHOR_EMAIL}>, enforced by ${HOOKS_PATH}/pre-commit`);
  console.log('  that hook also refuses commits in the primary checkout - work belongs in a worktree:');
  console.log('    node ~/.claude/scripts/worktree.mjs add ~/agent-workspace/grc-program <branch>');
}
