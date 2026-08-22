#!/usr/bin/env node
/**
 * PostToolUse hook. Runs after any Edit or Write and blocks on failure.
 *
 * Written in Node rather than bash or PowerShell deliberately. Node is already a hard dependency
 * of this repo, so one script runs identically on Windows, macOS and Linux. Two platform-specific
 * scripts would drift, and the one that drifts is always the one guarding the thing you care about.
 *
 * The point of a hook rather than CI: latency. A guard violation caught in the same turn is a
 * correction. The same violation caught in CI three commits later is a debugging session.
 *
 * Exit codes follow the Claude Code hook contract:
 *   0  proceed
 *   2  block, and surface stderr back to the model so it can fix the cause
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The inventory this run should validate. Defaults to the repo the hook lives in; overridden only
 * by tests, so they can point at a throwaway fixture rather than writing a deliberately-broken
 * control into the real controls/ directory. Node's test runner executes files in parallel, so a
 * test that mutates shared state races every other test that reads it — which is exactly the bug
 * this indirection exists to prevent.
 */
const validateRoot = process.env.GRC_VALIDATE_ROOT ?? repoRoot;

/** Hook input arrives as JSON on stdin; older versions set env vars. Accept both. */
function changedPath() {
  let stdin = '';
  try { stdin = readStdin(); } catch { /* no stdin, fall through */ }
  if (stdin) {
    try {
      const p = JSON.parse(stdin);
      const v = p?.tool_input?.file_path ?? p?.tool_input?.path ?? p?.file_path;
      if (v) return String(v);
    } catch { /* not JSON, fall through */ }
  }
  return process.env.CLAUDE_TOOL_FILE_PATH ?? process.env.TOOL_FILE_PATH ?? '';
}

/**
 * Read fd 0 directly. NOTE: `require` is not available in an ESM module — an earlier version of
 * this file used it here, the call threw, the catch swallowed it, and the hook silently passed
 * everything. A guard that fails open is worse than no guard, because you stop checking. Hence
 * the two tests in tests/hook.test.mjs that assert the blocking path actually blocks.
 */
function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

/** Normalise separators so the same matcher works on Windows and POSIX. */
const changed = changedPath().replace(/\\/g, '/');

// Anchor on a path BOUNDARY, not a leading slash — the hook receives relative paths
// ("controls/x.yaml") as often as absolute ones. Requiring a leading slash made the guard fail
// open for every relative path, which is the failure mode tests/hook.test.mjs now pins down.
const INVENTORY = /(^|[/])(controls|scenarios|exceptions|schemas|reference)[/]/;
const CODE      = /(^|[/])(src|tests)[/]/;

function run(args, label, guidance) {
  const res = spawnSync(process.execPath, args, { cwd: repoRoot, encoding: 'utf8' });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim();
  if (res.status === 0) return;

  process.stderr.write(`BLOCKED — ${label}\n\n${out}\n\n${guidance}\n`);
  process.exit(2);
}

if (INVENTORY.test(changed)) {
  run(
    ['src/cli.mjs', 'validate', '--root', validateRoot],
    'the control inventory does not validate after that edit.',
    'Fix the cause. Do not relax the guard or loosen the schema to make this pass — the guards are\n' +
    'the rules this repo will not break, and each one exists because breaking it produces a material\n' +
    'misstatement downstream in an SSP, a trust-center claim, or a customer contract. If a guard is\n' +
    'genuinely wrong, change it in a separate commit with an ADR explaining why.',
  );
} else if (CODE.test(changed)) {
  run(
    ['--test', 'tests/assertion.test.mjs', 'tests/faircam.test.mjs', 'tests/gap.test.mjs',
     'tests/guards.test.mjs', 'tests/health.test.mjs', 'tests/intake.test.mjs',
     'tests/oscal.test.mjs', 'tests/scytale-push.test.mjs', 'tests/uuid5.test.mjs'],
    'tests are failing after that edit.',
    'Fix the code, never the assertion. A test changed to make code pass is a control that has been\n' +
    'quietly disabled. tests/faircam.test.mjs contains a worked example of the right way to handle a\n' +
    'genuine disagreement: a published figure conflicted with our arithmetic, and the resolution was\n' +
    'to document the divergence in an additional test — not to edit the original assertion.',
  );
}

process.exit(0);
