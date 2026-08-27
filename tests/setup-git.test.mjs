import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The commit-identity guard's installer is itself a control, so it gets tested like one.
 *
 * THE BUG THESE PIN. setup-git.mjs used to `process.exit(0)` silently when .githooks/pre-commit was
 * absent — the one case where the operator most needs telling that the guard is NOT running. It
 * failed OPEN and said nothing, which is worse than no guard at all, because you stop checking.
 *
 * That is not hypothetical: on 2026-08-22 a session worked in a worktree branched from an imported
 * history whose tree carried neither .githooks/ nor this script. core.hooksPath is the relative
 * string '.githooks' and git resolves it per working tree, so no hook ran. The session believed it
 * was hook-protected.
 *
 * Every test here builds a throwaway git repo in the OS temp directory. Nothing touches the working
 * copy — the same structural rule tests/hook.test.mjs arrived at the hard way.
 */

const REPO_ROOT = process.cwd();

/** A throwaway checkout with just enough of the repo for the installer to act on. */
function fixture({ withHook }) {
  const dir = mkdtempSync(join(tmpdir(), 'grc-setup-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  cpSync(join(REPO_ROOT, 'scripts/setup-git.mjs'), join(dir, 'scripts/setup-git.mjs'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', private: true, type: 'module' }));

  if (withHook) {
    mkdirSync(join(dir, '.githooks'), { recursive: true });
    cpSync(join(REPO_ROOT, '.githooks/pre-commit'), join(dir, '.githooks/pre-commit'));
  }

  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  return { dir, git, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const run = (dir) => {
  const r = spawnSync(process.execPath, ['scripts/setup-git.mjs'], { cwd: dir, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

const config = (git, key) => {
  try { return git('config', '--local', '--get', key); } catch { return null; }
};

// ── the hook is present: arm everything ──────────────────────────────────────────────────────

test('with the hook present it arms identity AND hooksPath, and says so', () => {
  const { dir, git, cleanup } = fixture({ withHook: true });
  try {
    const r = run(dir);
    assert.equal(r.status, 0);
    assert.equal(config(git, 'user.name'), 'RootCawsLLC');
    assert.equal(config(git, 'user.email'), '317738477+RootCawsLLC@users.noreply.github.com');
    assert.equal(config(git, 'core.hooksPath'), '.githooks');
    assert.match(r.stdout, /armed the commit-identity guard/);
    // Relative, deliberately. An absolute path resolves everywhere and rots when a checkout moves.
    assert.doesNotMatch(config(git, 'core.hooksPath'), /^[A-Za-z]:|^\//);
  } finally { cleanup(); }
});

test('a second run is a silent no-op — noise on every install is its own problem', () => {
  const { dir, cleanup } = fixture({ withHook: true });
  try {
    run(dir);
    const second = run(dir);
    assert.equal(second.status, 0);
    assert.equal(second.all.trim(), '', 'nothing moved, so nothing should be said');
  } finally { cleanup(); }
});

// ── the hook is absent: the bug ──────────────────────────────────────────────────────────────

test('with the hook ABSENT it warns loudly instead of exiting silently', () => {
  const { dir, cleanup } = fixture({ withHook: false });
  try {
    const r = run(dir);
    assert.notEqual(r.all.trim(), '', 'silence here was the bug');
    assert.match(r.all, /guard is NOT armed/);
    assert.match(r.all, /\.githooks\/pre-commit/);
    // Naming the tree matters: the whole failure mode is being wrong about WHICH tree you are in.
    assert.ok(r.all.includes(dir), 'the warning must name the tree it is talking about');
    // It must say what still protects, and what does not.
    assert.match(r.all, /user\.name and user\.email are pinned/);
    assert.match(r.all, /git -c user\.email=/);
    assert.match(r.all, /worktree\.mjs add/);
  } finally { cleanup(); }
});

test('the warning is NON-FATAL — an extracted tarball must still npm install', () => {
  const { dir, cleanup } = fixture({ withHook: false });
  try {
    assert.equal(run(dir).status, 0);
  } finally { cleanup(); }
});

test('with the hook absent it STILL pins identity, and does not set hooksPath', () => {
  // Pinning identity without the hook is strictly better than doing nothing: it stops git inferring
  // an author from global config or the machine, which is how a personal address reached a
  // published history. But hooksPath must NOT be set to a directory containing no hooks — that
  // would silently disable whatever was in .git/hooks and make the tree worse, not better.
  const { dir, git, cleanup } = fixture({ withHook: false });
  try {
    run(dir);
    assert.equal(config(git, 'user.name'), 'RootCawsLLC');
    assert.equal(config(git, 'user.email'), '317738477+RootCawsLLC@users.noreply.github.com');
    assert.equal(config(git, 'core.hooksPath'), null, 'must not point hooksPath at a hookless directory');
  } finally { cleanup(); }
});

test('the warning repeats on every run, because an unarmed guard is a state not an event', () => {
  const { dir, cleanup } = fixture({ withHook: false });
  try {
    run(dir);
    const second = run(dir);
    assert.match(second.all, /guard is NOT armed/, 'the second install must warn too');
  } finally { cleanup(); }
});

// ── the cases that should stay silent ────────────────────────────────────────────────────────

test('not a git checkout at all: silent, and does not fail the install', () => {
  const dir = mkdtempSync(join(tmpdir(), 'grc-setup-nogit-'));
  try {
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    cpSync(join(REPO_ROOT, 'scripts/setup-git.mjs'), join(dir, 'scripts/setup-git.mjs'));
    const r = run(dir);
    assert.equal(r.status, 0);
    // An extracted tarball or a vendored copy is a NORMAL state, not an error worth shouting about.
    assert.equal(r.all.trim(), '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('vendored inside a larger checkout: touches nothing and says nothing', () => {
  // The enclosing repository has its own identity rules. Writing ours into it would be worse than
  // any warning — so this case stays silent AND makes no config change.
  const outer = mkdtempSync(join(tmpdir(), 'grc-setup-outer-'));
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: outer });
    const inner = join(outer, 'vendor', 'grc-program');
    mkdirSync(join(inner, 'scripts'), { recursive: true });
    cpSync(join(REPO_ROOT, 'scripts/setup-git.mjs'), join(inner, 'scripts/setup-git.mjs'));

    const r = run(inner);
    assert.equal(r.status, 0);
    assert.equal(r.all.trim(), '');
    const name = spawnSync('git', ['config', '--local', '--get', 'user.name'], { cwd: outer, encoding: 'utf8' });
    assert.notEqual(name.stdout.trim(), 'RootCawsLLC', 'must not write identity into the enclosing repo');
  } finally { rmSync(outer, { recursive: true, force: true }); }
});
