import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requirementsOf, preflight, report, loadInputs } from '../src/preflight.mjs';

/**
 * The failure this replaces: four CCM runs died at configure-aws-credentials with "Could not load
 * credentials from any providers" — a true statement that named a symptom four steps before the
 * cause, and sent the first investigation to a fix that would not have worked.
 */

const WORKFLOW = `
jobs:
  collect:
    steps:
      - uses: aws-actions/configure-aws-credentials@abc
        with:
          role-to-assume: \${{ secrets.CCM_READONLY_ROLE_ARN }}
      - name: Collect
        env:
          IDP_TOKEN: \${{ secrets.IDP_READONLY_TOKEN }}
        run: node src/cli.mjs collect --all
      - run: node src/cli.mjs assert
      - run: npm run oscal
      - name: Push
        env:
          SCYTALE_TOKEN: \${{ secrets.SCYTALE_TOKEN }}
        run: node src/cli.mjs push
`;

// ── requirements come FROM the workflow ──────────────────────────────────────────────────────

test('requirements are parsed from the workflow, never hardcoded', () => {
  // A second list of required secrets would drift from ccm.yml and then contradict it — the exact
  // failure mode this repo keeps meeting. Adding a secret to the workflow must not escape the check.
  const { secrets, commands } = requirementsOf(WORKFLOW);
  assert.deepEqual(secrets, ['CCM_READONLY_ROLE_ARN', 'IDP_READONLY_TOKEN', 'SCYTALE_TOKEN']);
  assert.deepEqual(commands, ['assert', 'collect', 'push']);
});

test('a secret added to the workflow is picked up with no code change', () => {
  const extended = `${WORKFLOW}\n          NEW_THING: \${{ secrets.A_BRAND_NEW_SECRET }}`;
  assert.ok(requirementsOf(extended).secrets.includes('A_BRAND_NEW_SECRET'));
});

test('npm-run steps are not mistaken for cli commands', () => {
  // `npm run oscal` is in the workflow and is not a src/cli.mjs invocation. Counting it would
  // report a missing command that is not missing.
  assert.ok(!requirementsOf(WORKFLOW).commands.includes('oscal'));
});

// ── the empty-string behaviour that caused the original failure ──────────────────────────────

test('an EMPTY secret counts as missing — the distinction GitHub declines to make', () => {
  // GitHub substitutes an unset secret with the empty string rather than failing. That is precisely
  // how role-to-assume received nothing and the AWS action fell through to its default provider
  // chain. Treating empty as present would reproduce the original bug inside the check for it.
  const env = { CCM_READONLY_ROLE_ARN: '', IDP_READONLY_TOKEN: '   ', SCYTALE_TOKEN: 'real-value' };
  const r = preflight({ workflowText: WORKFLOW, commandNames: ['collect', 'assert', 'push'], env });
  assert.deepEqual(r.secrets.missing, ['CCM_READONLY_ROLE_ARN', 'IDP_READONLY_TOKEN']);
  assert.equal(r.ready, false);
});

test('ready only when every secret is set AND every command exists', () => {
  const env = { CCM_READONLY_ROLE_ARN: 'arn', IDP_READONLY_TOKEN: 't', SCYTALE_TOKEN: 't' };
  const all = ['collect', 'assert', 'push'];

  assert.equal(preflight({ workflowText: WORKFLOW, commandNames: all, env }).ready, true);

  // secrets fine, one command missing
  const noCollect = preflight({ workflowText: WORKFLOW, commandNames: ['assert', 'push'], env });
  assert.equal(noCollect.ready, false);
  assert.deepEqual(noCollect.commands.missing, ['collect']);

  // commands fine, one secret missing
  const noSecret = preflight({ workflowText: WORKFLOW, commandNames: all, env: { ...env, SCYTALE_TOKEN: undefined } });
  assert.equal(noSecret.ready, false);
});

// ── the report has to be readable by somebody who was just paged ─────────────────────────────

test('the report says who can fix the secrets, and that it is not the model', () => {
  const r = preflight({ workflowText: WORKFLOW, commandNames: ['collect', 'assert', 'push'], env: {} });
  const text = report(r);
  assert.match(text, /Only a human with the credential values can fix this/);
  assert.match(text, /gh secret set/);
  // Why they vanished, so nobody re-investigates it from scratch.
  assert.match(text, /deleted and recreated on 2026-08-22/);
});

test('the report refuses the wrong fix explicitly', () => {
  // The original investigation concluded "restore the secrets". That would have moved the failure
  // one step, not removed it. The report has to say so where somebody will actually read it.
  const r = preflight({ workflowText: WORKFLOW, commandNames: ['push'], env: { CCM_READONLY_ROLE_ARN: 'a', IDP_READONLY_TOKEN: 'b', SCYTALE_TOKEN: 'c' } });
  const text = report(r);
  assert.match(text, /RESTORING THE SECRETS WOULD NOT MAKE THIS RUN\nGREEN/);
  assert.match(text, /fail at the first of these instead/);
});

test('a ready result says so plainly and claims nothing more', () => {
  const env = { CCM_READONLY_ROLE_ARN: 'a', IDP_READONLY_TOKEN: 'b', SCYTALE_TOKEN: 'c' };
  const text = report(preflight({ workflowText: WORKFLOW, commandNames: ['collect', 'assert', 'push'], env }));
  assert.match(text, /^Ready\./m);
  assert.doesNotMatch(text, /Not ready/);
});

// ── against the real repository ──────────────────────────────────────────────────────────────

test('the real ccm.yml and cli.mjs parse, and today the answer is NOT READY', () => {
  // Pins the actual state rather than describing it. When collect/assert/drift/route are built and
  // the secrets are restored, this test starts failing — which is the correct moment to revisit it.
  const { workflowText, commandNames } = loadInputs(process.cwd());

  assert.ok(commandNames.includes('validate'), 'failed to parse commands out of src/cli.mjs');
  assert.ok(commandNames.includes('preflight'), 'preflight must be able to see itself');

  const r = preflight({ workflowText, commandNames, env: {} });
  assert.deepEqual(r.secrets.required, [
    'CCM_READONLY_ROLE_ARN', 'GRC_READONLY_TOKEN', 'IDP_READONLY_TOKEN',
    'SCYTALE_CUSTOM_INTEGRATION_URL', 'SCYTALE_TOKEN',
  ]);
  assert.deepEqual(r.commands.missing, ['assert', 'collect', 'drift', 'route']);
  assert.equal(r.ready, false);
});
