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
