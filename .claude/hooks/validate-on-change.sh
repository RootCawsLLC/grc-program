#!/usr/bin/env bash
# Runs after any Edit or Write. If the inventory was touched, validate it immediately.
#
# The point is latency. A guard violation caught in the same turn is a correction; the same
# violation caught in CI three commits later is a debugging session. The nine guards are cheap
# enough to run on every edit, so run them on every edit.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 0

CHANGED="${CLAUDE_TOOL_FILE_PATH:-}"
case "$CHANGED" in
  *controls/*|*scenarios/*|*exceptions/*|*schemas/*|*reference/*)
    OUT="$(npm run --silent validate 2>&1)" || {
      echo "BLOCKED — the control inventory does not validate after that edit:" >&2
      echo "$OUT" >&2
      echo "" >&2
      echo "Fix the cause. Do not relax the guard or the schema to make this pass — the guards are" >&2
      echo "the rules this repo will not break, and each one exists because breaking it produces a" >&2
      echo "material misstatement downstream. If a guard is genuinely wrong, change it in a separate" >&2
      echo "commit with an ADR explaining why." >&2
      exit 2
    }
    ;;
  *src/*|*tests/*)
    npm test --silent >/dev/null 2>&1 || {
      echo "Tests are failing after that edit. Fix the code, never the assertion." >&2
      exit 2
    }
    ;;
esac
exit 0
