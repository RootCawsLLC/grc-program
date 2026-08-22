# Setup

Do this before `docs/DAY-ONE.md`. Fifteen minutes, and it removes the four things that otherwise
eat an hour on a fresh machine.

---

## Windows

Everything in this repo runs on Windows. Four things need doing first, and none of them are
optional.

### 1. Let PowerShell run npm

Fresh Windows installs ship with script execution disabled, so `npm` fails with
*"npm.ps1 cannot be loaded because running scripts is disabled on this system."*

```powershell
Get-ExecutionPolicy -List
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

`RemoteSigned` at `CurrentUser` scope is the standard developer setting: locally authored scripts
run, anything downloaded needs a signature, and machine policy is untouched.

**If this laptop is managed and you would rather not change the policy at all**, skip it and call
the batch shims instead — `npm.cmd test`, `npm.cmd run baseline`. They bypass PowerShell script
execution entirely and work indefinitely. Nothing in this repo requires the policy change; it just
saves you typing `.cmd` forever.

### 2. Turn on long path support

```powershell
git config --global core.longpaths true
```

Without it, git fails with *"Filename too long"* on deep paths. You will hit this the moment
`node_modules` or a nested OSCAL output directory appears.

### 3. Line endings — this one is a correctness issue, not cosmetics

The repo ships a `.gitattributes` that pins `.sh`, `.mjs`, `.sql`, `.yaml`, `.json` and `.md` to
LF. Confirm git is not overriding it:

```powershell
git config --global core.autocrlf false
```

Why it matters here specifically. A CRLF-terminated YAML file can carry a trailing `\r` into a
`control_id` or a `population_definition`. That value then fails to match anywhere it is
compared — a crosswalk lookup, a scenario join, a `query_ref` reconciliation — and it fails
**silently**, because `"ctl.iam.enterprise-sso.mfa\r"` looks identical to
`"ctl.iam.enterprise-sso.mfa"` in every terminal you will read it in.

If you cloned before `.gitattributes` existed, renormalise once:

```powershell
git add --renormalize .
git status
```

### 4. Node 22 or later

```powershell
node --version
```

The repo uses the built-in test runner and ESM throughout. Node 22+ is declared in
`package.json` under `engines`.

### About the validation hook

`.claude/hooks/validate-on-change.mjs` is **Node, not bash or PowerShell**, on purpose. Node is
already a hard dependency of this repo, so one script runs identically on Windows, macOS and
Linux. Two platform-specific scripts drift, and the one that drifts is always the one guarding the
thing you care about.

The hook is itself tested — `tests/hook.test.mjs` asserts the *blocking* path actually blocks,
across relative, POSIX-absolute and Windows-backslash paths. That is deliberate: two bugs during
the build made this hook **fail open**, exiting 0 and looking fine. A guard that fails open is
worse than no guard, because you stop checking. Tests that only assert the pass path would have
caught neither.

Verify it works on your machine:

```powershell
npm test
```

Test names beginning "a broken inventory BLOCKS" are the ones that matter.

**One more thing the hook tests taught us, worth knowing before you write any test in this repo.**
`node --test` runs test **files** in parallel, one per core. An earlier version of
`tests/hook.test.mjs` wrote a deliberately-broken control into the real `controls/` directory and
restored it in a `finally`. That raced `tests/cli.test.mjs`, which validates those same files — it
passed on a 4-core machine and failed on a 32-thread laptop. Worse, a killed run left the working
copy dirty, because `finally` never ran.

So: **no test in this repo writes to `controls/`, `scenarios/` or `exceptions/`.** Anything needing
a mutated inventory copies one into the OS temp directory and points the tool at it via `--root` or
`GRC_VALIDATE_ROOT`. `tests/hook.test.mjs` has a test that asserts this rule holds, so if someone
reintroduces the pattern the suite says so instead of going quietly flaky.

The wrong fix here is `--concurrency=1`. It hides the race, slows every run, and leaves the shared
mutable state in place for the next person to trip over.

---

## macOS / Linux

```bash
node --version    # 22+
npm ci
npm test
```

Nothing else. The hook, the CLI and the workflows are all cross-platform.

---

## Verify the whole thing

Same on every platform:

```
npm ci
npm test          # 75 passing
npm run validate  # 0 errors, 0 warnings
npm run baseline  # intake + control health + gap assessment
```

`npm run oscal` twice in a row should produce a byte-identical file. If it does not, the
deterministic-UUID contract is broken and every downstream diff becomes unreviewable — CI gates on
this, but it is worth confirming locally once.

---

## Claude Code

Open Claude Code in the repo root. `CLAUDE.md`, eight subagents, four slash commands, three skills
and the hook all load from `.claude/` with no configuration.

Confirm with `/week-one`.

If slash commands do not appear, you opened Claude Code somewhere other than the repo root — the
`.claude/` directory is discovered relative to the working directory.

---

## Passing arguments to npm scripts

Both shells need the `--` separator, and it is easy to lose:

```
npm run gap -- --direction remediation
npm run health -- --detail
```

Without `--`, npm swallows the flag and you get the unfiltered output while assuming you filtered
it. Worth knowing before you report a number to anyone.

---

## Branch name

`gh repo create` may have set your default branch to `master`. If your org standardises on `main`:

```
git branch -m master main
git push -u origin main
gh repo edit --default-branch main
git push origin --delete master
```

Do this before anyone else clones, not after.
