/**
 * Preflight for the continuous-controls-monitoring workflow.
 *
 * WHY THIS EXISTS. Every scheduled CCM run between 2026-08-23 and 2026-08-26 failed in under
 * fifteen seconds at `aws-actions/configure-aws-credentials`, with:
 *
 *     Credentials could not be loaded, please check your action inputs:
 *     Could not load credentials from any providers
 *
 * That error is true and useless. It names a symptom four steps before the real problem, says
 * nothing about the five unset secrets behind it, and nothing at all about the four commands the
 * workflow invokes that do not exist. It sent the first investigation to "restore the secrets",
 * which would not have fixed anything — the run would simply have died one step later instead.
 *
 * So the job asks the whole question first and answers it in ONE run: what is missing, all of it,
 * before anything tries to use any of it.
 *
 * WHAT THIS IS NOT. It does not make CCM collect. It cannot: the secrets are Susan's to set and
 * `collect`/`assert`/`drift`/`route` are unbuilt work blocked on the organization access. It replaces a
 * misleading failure with an accurate one, which is the part that was actually fixable.
 *
 * REQUIREMENTS ARE DERIVED FROM THE WORKFLOW, NEVER HARDCODED. A second list of required secrets
 * would drift from the one in ccm.yml and then contradict it — the failure mode this repository
 * keeps meeting. Parsing the workflow means adding a secret to it cannot silently escape the check.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** `${{ secrets.NAME }}` — every secret the workflow actually references. */
const SECRET_REF = /\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g;

/** `node src/cli.mjs <command>` / `node src/cli.mjs <command> --flag` */
const CLI_INVOCATION = /node\s+src\/cli\.mjs\s+([a-z][a-zA-Z:-]*)/g;

export function requirementsOf(workflowText) {
  const secrets = [...new Set([...workflowText.matchAll(SECRET_REF)].map((m) => m[1]))].sort();
  const commands = [...new Set([...workflowText.matchAll(CLI_INVOCATION)].map((m) => m[1]))].sort();
  return { secrets, commands };
}

/**
 * A secret is "present" when the runner exported it as a non-empty environment variable.
 *
 * GitHub substitutes an unset secret with the EMPTY STRING rather than failing, which is precisely
 * how `role-to-assume` received nothing and the AWS action fell through to its default provider
 * chain. So empty is treated as absent — the distinction GitHub declines to make.
 */
const present = (name, env) => typeof env[name] === 'string' && env[name].trim() !== '';

export function preflight({ workflowText, commandNames, env = process.env }) {
  const { secrets, commands } = requirementsOf(workflowText);

  const missingSecrets = secrets.filter((s) => !present(s, env));
  const missingCommands = commands.filter((c) => !commandNames.includes(c));

  return {
    ready: missingSecrets.length === 0 && missingCommands.length === 0,
    secrets: { required: secrets, missing: missingSecrets },
    commands: { required: commands, missing: missingCommands },
  };
}

/**
 * The report. Written to be read once, in a CI log, by somebody who has just been paged — so it
 * says what is wrong, what that blocks, and who can unblock it, without requiring the reader to
 * already know the history.
 */
export function report(result) {
  const lines = [];
  const ok = (s) => `  ok       ${s}`;
  const bad = (s) => `  MISSING  ${s}`;

  lines.push('CCM PREFLIGHT — what this run needs, checked before anything tries to use it.', '');

  lines.push(`Secrets (${result.secrets.required.length} referenced by the workflow):`);
  for (const s of result.secrets.required) {
    lines.push(result.secrets.missing.includes(s) ? bad(s) : ok(s));
  }

  lines.push('', `CLI commands (${result.commands.required.length} invoked by the workflow):`);
  for (const c of result.commands.required) {
    lines.push(result.commands.missing.includes(c) ? bad(`${c}  — not implemented in src/cli.mjs`) : ok(c));
  }

  if (result.ready) {
    lines.push('', 'Ready. Every referenced secret is set and every invoked command exists.');
    return lines.join('\n');
  }

  lines.push('', '-'.repeat(78), '');

  if (result.secrets.missing.length) {
    lines.push(
      `${result.secrets.missing.length} secret(s) unset. GitHub substitutes an unset secret with the EMPTY`,
      'STRING rather than failing, which is why this used to surface as "Could not load credentials',
      'from any providers" four steps later instead of as the configuration problem it is.',
      '',
      'These were lost when the repository was deleted and recreated on 2026-08-22 to purge commits',
      'carrying a personal email address. Actions secrets do not survive repository deletion. The',
      'purge was correct; restoring the secrets was the step that did not follow it.',
      '',
      'Only a human with the credential values can fix this:',
      '  gh secret set <NAME> --repo RootCawsLLC/grc-program',
      '',
    );
  }

  if (result.commands.missing.length) {
    lines.push(
      `${result.commands.missing.length} command(s) do not exist. RESTORING THE SECRETS WOULD NOT MAKE THIS RUN`,
      'GREEN — it would fail at the first of these instead, one step later.',
      '',
      'These are unbuilt pipeline work, blocked on the organization access rather than on anything in this repo:',
      '  collect  BUILD-ORDER B2/B5 — collectors have never run against a live tenant',
      '  assert   BUILD-ORDER B2 — needs a collection to assert over',
      '  drift    needs an assertion history to compare against',
      '  route    needs failures to route',
      '',
    );
  }

  lines.push('Not ready. See issue #5.');
  return lines.join('\n');
}

/** Reads the workflow and the CLI's own command list, so neither can be restated wrongly here. */
export function loadInputs(root = process.cwd()) {
  const workflowText = readFileSync(join(root, '.github/workflows/ccm.yml'), 'utf8');
  const cliText = readFileSync(join(root, 'src/cli.mjs'), 'utf8');
  const commandNames = [...cliText.matchAll(/^\s{2}(?:async )?([a-z][a-zA-Z:]*)\(\)\s*\{/gm)].map((m) => m[1]);
  return { workflowText, commandNames };
}
