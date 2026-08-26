import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

/**
 * Regression: `baseline` used to stop after `intake`, because sub-commands called process.exit
 * directly. It reported success having run one third of the assessment — the worst kind of bug,
 * because the output looked fine. Sub-commands now return an exit code and the dispatcher exits.
 */
test('baseline runs all three phases, not just the first', async () => {
  const { stdout } = await run('node', ['src/cli.mjs', 'baseline']);
  assert.match(stdout, /AUDIT INTAKE/,      'intake did not run');
  assert.match(stdout, /CONTROL HEALTH/,    'health did not run — baseline truncated after intake');
  assert.match(stdout, /GAP ASSESSMENT/,    'gap did not run — baseline truncated');
});

test('validate exits 0 on a clean inventory', async () => {
  const { stdout } = await run('node', ['src/cli.mjs', 'validate']);
  assert.match(stdout, /0 error\(s\)/);
});

test('gap can be filtered to one direction', async () => {
  const { stdout } = await run('node', ['src/cli.mjs', 'gap', '--direction', 'risk']);
  assert.match(stdout, /── RISK ──/);
  assert.ok(!stdout.includes('── COVERAGE ──'), 'direction filter leaked other directions');
});

/**
 * Second instance of the regression at the top of this file, and it reached production config.
 *
 * The dispatcher was `commands[cmd] ?? commands.help`. `help()` returns undefined, so an unknown
 * command printed the help text and exited 0. ccm.yml invokes four commands that do not exist —
 * collect, assert, drift, route — so every one of them SUCCEEDED. With that workflow's credentials
 * restored it would have gone green end to end having collected no evidence whatsoever.
 *
 * The asymmetry below is the whole point: a bare invocation is a question and answering it is not
 * an error; a named command that does not exist is a failure and must say so in the exit code,
 * because that is the only part a CI runner reads.
 */
test('an unknown command exits non-zero rather than printing help and succeeding', async () => {
  await assert.rejects(
    () => run('node', ['src/cli.mjs', 'collect', '--all']),
    (err) => {
      assert.equal(err.code, 1, 'unknown command exited 0 — a fictional workflow step would pass');
      assert.match(err.stderr, /unknown command "collect"/, 'did not name the command it rejected');
      return true;
    }
  );
});

test('a bare invocation still prints help and exits 0', async () => {
  // Asking what the tool does is not a failure. Only a NAMED command that does not exist is.
  const { stdout } = await run('node', ['src/cli.mjs']);
  assert.match(stdout, /grc — Reco control inventory/);
});

test('help is a real command and exits 0', async () => {
  const { stdout } = await run('node', ['src/cli.mjs', 'help']);
  assert.match(stdout, /grc — Reco control inventory/);
});
