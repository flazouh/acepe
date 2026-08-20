#!/usr/bin/env bash
# Dispatch one rebuild ticket to cursor-agent inside an isolated git worktree.
# Usage: scripts/dispatch-ticket.sh AC-002 <base-ref>
set -euo pipefail

TICKET="${1:?ticket id required}"
BASE="${2:-HEAD}"
REPO="/Users/alex/Documents/acepe"
WT="/Users/alex/Documents/acepe-lanes/${TICKET}"
BRANCH="feat/$(echo "$TICKET" | tr "[:upper:]" "[:lower:]")"
MODEL="cursor-grok-4.6-xhigh"

cd "$REPO"
/usr/bin/git worktree add -q -b "$BRANCH" "$WT" "$BASE"
cd "$WT"
bun install --silent >/dev/null 2>&1 || bun install >/dev/null 2>&1 || true

cursor-agent --print --force --model "$MODEL" --output-format text "Implement ticket ${TICKET}. Read docs/plans/electrobun-rebuild/${TICKET}.md first: its acceptance criteria are the complete spec.

Hard rules:
1. Do NOT edit the repo-root package.json or tsconfig.base.json. Other lanes are editing them concurrently. If your work needs a root change (a catalog entry, a workspace script, a typecheck chain entry), write exactly what is needed into ${TICKET}-INTEGRATION.md at the repo root instead, and stop there.
2. Every new package must have its own tsconfig.json extending ../../tsconfig.base.json, and a lint:effect script running: effect-language-service diagnostics --project tsconfig.json --strict --format pretty
3. All 77 Effect lint rules are errors. No async functions, no new Promise, no new Date, no console.*, no process.env, no node: builtin imports, no barrel imports from effect. Use Effect APIs for all of it.
4. Colocate a .test.ts beside every new source file.
5. Do not stage or commit. Do not touch packages/desktop/src/lib/services.

When done, run your package typecheck and lint:effect, and report pass or fail for each." 2>&1 | tee /tmp/lane-${TICKET}.log

# cursor-agent exits 0 even when the API drops the connection and nothing is written.
# Fail loudly so the dispatcher does not report a silent no-op as success.
if grep -qE 'RetriableError|command failed unexpectedly' "/tmp/lane-${TICKET}.log"; then
  echo "LANE FAILED: ${TICKET} hit a cursor-agent transport error and wrote nothing."
  exit 1
fi
if [ -z "$(/usr/bin/git status --porcelain | grep -v 'lib/services')" ]; then
  echo "LANE FAILED: ${TICKET} produced no changes."
  exit 1
fi
echo "LANE OK: ${TICKET} produced changes."
