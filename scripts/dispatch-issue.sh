#!/usr/bin/env bash
# Dispatch one GitHub issue to cursor-agent inside an isolated git worktree.
# Usage: scripts/dispatch-issue.sh <issue-number> <base-ref> [assigned-migration-id]
set -euo pipefail

# Bash reads a script incrementally, so editing this file while lanes are
# running corrupts them mid-flight. Re-exec from an immutable copy.
if [ "${LANE_SELF_COPY:-}" != "1" ]; then
  _copy="$(mktemp -t dispatch-issue)"
  cat "$0" > "$_copy"
  LANE_SELF_COPY=1 exec bash "$_copy" "$@"
fi

ISSUE="${1:?issue number required}"
BASE="${2:-HEAD}"
ASSIGNED_MIGRATION="${3:-}"
REPO="/Users/alex/Documents/acepe"
WT="/Users/alex/Documents/acepe-lanes/issue-${ISSUE}"
BRANCH="feat/issue-${ISSUE}"
MODEL="cursor-grok-4.6-xhigh"

cd "$REPO"
# A lane that branches from a stale base collides with every sibling merged
# since. Issue #259 branched three domains back and came home with 37
# conflicted files, which is a rewrite, not a merge. Always branch from the
# current tip of the integration branch.
if [ "$BASE" != "$(/usr/bin/git rev-parse --short HEAD)" ]; then
  echo "NOTE: base $BASE is not current HEAD; using HEAD instead to avoid a stale-base merge."
  BASE="$(/usr/bin/git rev-parse --short HEAD)"
fi
TITLE="$(gh issue view "$ISSUE" --json title --jq .title)"
/usr/bin/git worktree add -q -b "$BRANCH" "$WT" "$BASE"
cd "$WT"
# Cleanup refuses any worktree holding this file. Process introspection was
# tried and failed: cursor-agent's argv does not contain the worktree path,
# only its cwd does, so a grep over args never matched and live lanes were
# deleted twice.
touch "$WT/.lane-active"
trap 'rm -f "$WT/.lane-active"' EXIT
bun install --silent >/dev/null 2>&1 || bun install >/dev/null 2>&1 || true

cursor-agent --print --force --model "$MODEL" --output-format text "Implement GitHub issue #${ISSUE}: ${TITLE}

Read the issue first: gh issue view ${ISSUE} --comments
Its acceptance criteria are the complete spec. The parent issue #238 and docs/plans/electrobun-rebuild/SPEC-PHASE-2.md carry the constraints.

Hard rules:
1. Do NOT edit the repo-root package.json or tsconfig.base.json. Other lanes are editing them concurrently. If your work needs a root change, write what is needed into ISSUE-${ISSUE}-INTEGRATION.md at the repo root instead.
2. Every new package needs its own tsconfig.json extending ../../tsconfig.base.json and a lint:effect script running: effect-language-service diagnostics --project tsconfig.json --strict --format pretty
3. All 77 Effect lint rules are errors. No async functions, no new Promise, no new Date, no console.*, no process.env, no node: builtin imports, no barrel imports from effect. Use Effect APIs.
4. Colocate a .test.ts beside every new source file.
4b. If you add a SQL migration, its number is ASSIGNED to you: ${ASSIGNED_MIGRATION:-none assigned, use the next free number}. Use exactly that number; other lanes hold the numbers around it.
4c. If a criterion mentions grading against recorded traffic, use packages/harness against packages/harness/fixtures. Never write your own substitute fixture. If no recorded fixture exists, say the criterion is blocked.
4d. NO FOURTH RPC PRIMITIVE. Everything goes through dispatch, snapshot and events. If your domain seems to need another, the domain is modelled wrong.
5. Do not stage or commit. Do not touch these six files under packages/desktop/src/lib/services: converted-session-types.ts, file-index-types.ts, session-jsonl-types.ts, session-update-types.ts, tauri-command-client.ts, user-settings-types.ts.
6. If a criterion says 'verified through electrobun-qa, DOM-checked', build the app, launch it, run the heredoc, and PASTE THE ACTUAL OUTPUT in your report. Do not claim it passes without pasting what you saw.

When done, run your package typecheck, lint:effect and test, and report pass or fail for each." 2>&1 | tee "/tmp/lane-issue-${ISSUE}.log"

if grep -qE 'RetriableError|command failed unexpectedly' "/tmp/lane-issue-${ISSUE}.log"; then
  echo "LANE FAILED: #${ISSUE} hit a cursor-agent transport error."
  exit 1
fi
if [ -z "$(/usr/bin/git status --porcelain | grep -v 'lib/services')" ]; then
  echo "LANE FAILED: #${ISSUE} produced no changes."
  exit 1
fi
echo "LANE OK: #${ISSUE} produced changes."
