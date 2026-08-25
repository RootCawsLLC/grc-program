import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `intake/source/` holds NDA-gated, watermarked audit reports. Nothing may read them — not the
 * model, not the tooling.
 *
 * WHY THIS TEST EXISTS RATHER THAN JUST THE DENY RULE. `.claude/settings.json` denies
 * `Read(intake/source/**)`, which binds the Read tool and nothing else. `Bash(npm run:*)` is
 * auto-allowed, so a script under `src/` or `scripts/` that read the directory would never surface
 * a prompt — the deny rule would be intact and irrelevant. That is the hole this closes, and it is
 * a control the REPOSITORY owns rather than one that depends on the harness's permission model.
 *
 * The layers, in order of how much weight they carry:
 *
 *   1. `.gitignore`  — load-bearing. Stops a watermarked PDF ever reaching a commit. Verified here.
 *   2. this test     — stops repo code reading it, which is the auto-allowed path.
 *   3. the deny rule — stops the Read tool. Verified here so it cannot be dropped silently.
 *   4. deny-listed Bash verbs — defence in depth, and KNOWN INCOMPLETE. See docs/adr/0008.
 *
 * See docs/adr/0008-intake-source-is-not-readable.md for why layer 4 is not treated as the control.
 */

const ROOT = process.cwd();
const CODE_DIRS = ['src', 'scripts', '.claude/hooks'];
const READS = /\b(readFile|readFileSync|readdir|readdirSync|createReadStream|openSync|open)\s*\(/;

function* codeFiles(dir) {
  let entries;
  try { entries = readdirSync(join(ROOT, dir)); } catch { return; }
  for (const e of entries) {
    const rel = `${dir}/${e}`;
    if (statSync(join(ROOT, rel)).isDirectory()) { yield* codeFiles(rel); continue; }
    if (/\.(mjs|js|sh)$/.test(e)) yield rel;
  }
}

test('no repository code reads intake/source', () => {
  // The realistic regression is somebody adding a convenience reader — `readFile('intake/source/…')`
  // — behind `npm run something`, which is auto-allowed and would therefore never prompt.
  const offenders = [];
  for (const rel of codeFiles('.')) {
    if (!CODE_DIRS.some((d) => rel.startsWith(`./${d}`) || rel.startsWith(d))) continue;
    const text = readFileSync(join(ROOT, rel), 'utf8');
    text.split('\n').forEach((line, i) => {
      if (!line.includes('intake/source')) return;
      const isComment = /^\s*(\/\/|\*|#)/.test(line);
      const isUserFacingString = /console\.(log|warn|error)/.test(line);
      if (isComment || isUserFacingString) return;      // talking ABOUT it is fine
      if (READS.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
      else offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], `repository code must not touch intake/source:\n${offenders.join('\n')}`);
});

test('.gitignore still excludes intake/source — the load-bearing layer', () => {
  // If only one of these layers survives, it must be this one: a watermarked report in a commit is
  // the failure that cannot be undone.
  const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  assert.match(gitignore, /^intake\/source\/\*\*$/m);
  assert.match(gitignore, /^!intake\/source\/\.gitkeep$/m, 'the directory itself must survive a clone');
});

test('the Read deny rule is still present and still scoped to the whole directory', () => {
  // Config drift guard. This rule binds the Read tool only — see the ADR — but dropping it would
  // remove a layer silently, and the extraction command tells the operator it is there.
  const settings = JSON.parse(readFileSync(join(ROOT, '.claude/settings.json'), 'utf8'));
  assert.ok(settings.permissions.deny.includes('Read(intake/source/**)'));
});

test('the extraction command does not overstate what the deny rule does', () => {
  // The original wording said the settings prevent reading it, full stop. They prevent the Read
  // tool from reading it. A control described more strongly than it behaves is worse than a weak
  // control honestly described, because nobody checks the one they have been told is handled.
  const cmd = readFileSync(join(ROOT, '.claude/commands/intake-soc2.md'), 'utf8');
  assert.match(cmd, /intake\/source/);
  assert.match(cmd, /ADR-0008|adr\/0008/, 'the command must point at the decision that scopes the control');
});
