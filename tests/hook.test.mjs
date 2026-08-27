import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The validation hook is itself a control, so it gets tested like one.
 *
 * THREE bugs were caught here during the build. The first two failed OPEN — the hook exited 0 and
 * everything looked fine, which is worse than no guard because you stop checking:
 *
 *   1. `require` used inside an ESM module: threw, was swallowed by a catch, path came back empty.
 *   2. Path regex required a leading slash: never matched a relative path like "controls/x.yaml".
 *
 * The third was in this file rather than in the hook:
 *
 *   3. These tests used to write a deliberately-broken control into the REAL controls/ directory
 *      and restore it in a finally. Node's test runner runs test FILES in parallel, so that raced
 *      tests/cli.test.mjs ("validate exits 0 on a clean inventory") reading the same files. It
 *      passed on a 4-core sandbox and failed on a 32-thread laptop — an intermittent failure,
 *      which is worse than a consistent one because it teaches people to re-run until green. A
 *      killed run also left the repo dirty, because `finally` never executed.
 *
 * The fix is structural, not `--concurrency=1`: every test here builds a throwaway fixture repo in
 * the OS temp directory and points the hook at it via GRC_VALIDATE_ROOT. Nothing in this file
 * touches the working copy.
 */

const HOOK = '.claude/hooks/validate-on-change.mjs';

/** A minimal but real inventory: schemas + one control + its scenario, optionally broken. */
function fixture({ broken }) {
  const dir = mkdtempSync(join(tmpdir(), 'grc-hook-'));
  for (const d of ['schemas', 'controls', 'scenarios', 'exceptions', 'reference']) {
    cpSync(d, join(dir, d), { recursive: true });
  }
  if (broken) {
    // Guard G2: a policy_ref on a control that is not `operating`.
    const f = join(dir, 'controls', 'ctl.iam.enterprise-sso.mfa.yaml');
    writeFileSync(f, readFileSync(f, 'utf8').replace(/^policy_ref:.*$/m, 'policy_ref: policies/access.md'));
  }
  return dir;
}

function runHook(filePath, root) {
  try {
    execFileSync(process.execPath, [HOOK], {
      input: JSON.stringify({ tool_input: { file_path: filePath } }),
      env: { ...process.env, GRC_VALIDATE_ROOT: root },
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, err: '' };
  } catch (e) {
    return { code: e.status, err: `${e.stderr ?? ''}` };
  }
}

/** Runs fn against a fixture and always cleans up, even on assertion failure. */
function withFixture({ broken }, fn) {
  const dir = fixture({ broken });
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('a clean inventory passes', () => {
  withFixture({ broken: false }, (dir) => {
    assert.equal(runHook('controls/x.yaml', dir).code, 0);
  });
});

test('a broken inventory BLOCKS with exit 2 — relative path', () => {
  withFixture({ broken: true }, (dir) => {
    const r = runHook('controls/anything.yaml', dir);
    assert.equal(r.code, 2, 'hook failed open on a relative path');
    assert.match(r.err, /G2-policy-before-control/);
  });
});

test('a broken inventory BLOCKS with exit 2 — absolute POSIX path', () => {
  withFixture({ broken: true }, (dir) => {
    assert.equal(runHook('/home/x/grc-program/controls/anything.yaml', dir).code, 2);
  });
});

test('a broken inventory BLOCKS with exit 2 — Windows path with backslashes', () => {
  withFixture({ broken: true }, (dir) => {
    assert.equal(runHook('C:\\Users\\x\\grc-program\\controls\\anything.yaml', dir).code, 2,
      'hook failed open on a Windows path — separators were not normalised');
  });
});

test('the block message tells you to fix the cause, not the guard', () => {
  withFixture({ broken: true }, (dir) => {
    assert.match(runHook('controls/x.yaml', dir).err, /Do not relax the guard/);
  });
});

test('every watched directory is matched, on relative paths', () => {
  withFixture({ broken: true }, (dir) => {
    for (const d of ['controls', 'scenarios', 'exceptions', 'schemas', 'reference']) {
      assert.equal(runHook(`${d}/x.yaml`, dir).code, 2, `${d}/ was not watched`);
    }
  });
});

test('an unrelated file is ignored even when the inventory is broken', () => {
  // Scope discipline: the hook fires on what changed, not on everything, or every edit anywhere
  // pays the cost of a full validate.
  withFixture({ broken: true }, (dir) => {
    assert.equal(runHook('README.md', dir).code, 0);
    assert.equal(runHook('docs/DAY-ONE.md', dir).code, 0);
  });
});

test('missing stdin and missing env do not crash the hook', () => {
  const r = execFileSync(process.execPath, [HOOK], { input: '', encoding: 'utf8' });
  assert.equal(typeof r, 'string');
});

test('these tests never mutate the working copy', () => {
  // The regression that made this file necessary. If it ever fails, someone reintroduced a write
  // to the real controls/ directory and the suite is flaky again.
  const before = readFileSync('controls/ctl.iam.enterprise-sso.mfa.yaml', 'utf8');
  withFixture({ broken: true }, (dir) => runHook('controls/x.yaml', dir));
  assert.equal(readFileSync('controls/ctl.iam.enterprise-sso.mfa.yaml', 'utf8'), before,
    'a hook test wrote to the real inventory — that races every other test file');
});
