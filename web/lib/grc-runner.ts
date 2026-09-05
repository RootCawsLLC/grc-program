/**
 * Server-only bridge to the real grc-program tool.
 *
 * It does NOT reimplement or import the tool into the Next bundle. It spawns a
 * plain Node ESM process (scripts/run-grc.mjs) that imports the tool's modules
 * natively, opens its own DuckDB warehouse, and runs the exact shipped code path
 * that `npm run demo` / `grc health` / `grc gap` / `grc emit` drive, then relays
 * that process's JSON result.
 *
 * Running out-of-process keeps the tool's ESM resolution and filesystem behaviour
 * identical to the CLI, avoids the ESM/CJS interop that breaks when a pure-ESM
 * tool is pulled into the Next bundle under `next start`, and — critically here —
 * keeps the duckdb native addon loaded by a normal Node process rather than by
 * the Next server. The child runs with cwd = the tool repo root so the tool's
 * CWD-relative data paths (controls/, models/, fixtures/landing/, scenarios/…)
 * resolve exactly as they do for the CLI.
 */
import 'server-only';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

export interface RunRequest {
  sections?: {
    pipeline?: boolean;
    health?: boolean;
    gap?: boolean;
    oscal?: boolean;
  };
}

function scriptPath(): string {
  return process.env.GRC_SCRIPT ?? join(process.cwd(), 'scripts', 'run-grc.mjs');
}

// The tool reads controls/, models/, fixtures/, scenarios/, exceptions/,
// reference/ relative to its own root. `next start` runs from web/, so the root
// is the parent unless overridden (the container sets GRC_ROOT=/repo).
function toolRoot(): string {
  return process.env.GRC_ROOT ?? join(process.cwd(), '..');
}

const HARD_TIMEOUT_MS = 120_000;

export async function runGrc(req: RunRequest): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath()], {
      cwd: toolRoot(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    let err = '';
    const killer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Run timed out.'));
    }, HARD_TIMEOUT_MS);

    child.stdout.on('data', (c) => (out += c.toString()));
    child.stderr.on('data', (c) => (err += c.toString()));
    child.on('error', (e) => {
      clearTimeout(killer);
      reject(e);
    });
    child.on('close', () => {
      clearTimeout(killer);
      let parsed: (Record<string, unknown> & { error?: string }) | null = null;
      try {
        parsed = JSON.parse(out);
      } catch {
        reject(new Error(`Run process produced no valid result.${err ? ` (${err.slice(0, 400)})` : ''}`));
        return;
      }
      if (parsed && parsed.error) {
        reject(new Error(String(parsed.error).split('\n')[0]));
        return;
      }
      resolve(parsed as Record<string, unknown>);
    });

    child.stdin.write(JSON.stringify(req));
    child.stdin.end();
  });
}
