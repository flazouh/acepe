#!/usr/bin/env bash
# Verify one dispatched lane before it is merged.
# Usage: scripts/verify-lane.sh AC-002
set -uo pipefail
TICKET="${1:?ticket id required}"
WT="/Users/alex/Documents/acepe-lanes/${TICKET}"
[ -d "$WT" ] || { echo "no worktree at $WT"; exit 1; }
cd "$WT"

echo "=== ${TICKET}: changed files ==="
/usr/bin/git status --short | grep -v 'packages/desktop/src/lib/services' || true
echo
echo "=== diffstat (tracked) ==="
/usr/bin/git diff --stat | tail -20
echo
if ls ${TICKET}-INTEGRATION.md >/dev/null 2>&1; then
  echo "=== root integration requested ==="
  cat "${TICKET}-INTEGRATION.md"
  echo
fi
echo "=== forbidden-file check ==="
if /usr/bin/git status --short -- package.json tsconfig.base.json | grep -q .; then
  echo "FAIL: lane modified a root file it was told not to touch:"
  /usr/bin/git status --short -- package.json tsconfig.base.json
else
  echo "ok: root package.json and tsconfig.base.json untouched"
fi
echo
echo "=== per-package checks ==="
for pkg in $(/usr/bin/git status --short | awk '{print $2}' | grep -oE '^packages/[a-z-]+' | sort -u); do
  [ -f "$pkg/package.json" ] || continue
  echo "--- $pkg"
  bun run --cwd "$pkg" typecheck 2>&1 | tail -4
  echo "  typecheck exit=$?"
  if grep -q '"lint:effect"' "$pkg/package.json"; then
    bun run --cwd "$pkg" lint:effect 2>&1 | tail -6
    echo "  lint:effect exit=$?"
  else
    echo "  FAIL: $pkg has no lint:effect script"
  fi
done
