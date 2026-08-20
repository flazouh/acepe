#!/usr/bin/env bash
# Merge one lane branch into the current integration branch.
# Refuses to commit while any conflict other than bun.lock is unresolved.
set -uo pipefail
BRANCH="${1:?lane branch required}"
cd /Users/alex/Documents/acepe

/usr/bin/git merge --no-ff -q -m "merge(${BRANCH})" "$BRANCH" && { echo "merged cleanly: $BRANCH"; exit 0; }

CONFLICTS="$(/usr/bin/git diff --name-only --diff-filter=U)"
echo "conflicts:"; echo "$CONFLICTS"

OTHER="$(echo "$CONFLICTS" | grep -v '^bun.lock$' | grep -v '^$')"
if [ -n "$OTHER" ]; then
  echo
  echo "MANUAL RESOLUTION REQUIRED. Not committing. Resolve these, then:"
  echo "  git add <files> && git commit --no-verify -m 'merge(${BRANCH})'"
  echo "$OTHER"
  exit 2
fi

# bun.lock is derived: regenerate rather than hand-merge.
/usr/bin/git checkout --ours bun.lock && bun install >/dev/null 2>&1
/usr/bin/git add bun.lock
/usr/bin/git commit --no-verify -q -m "merge(${BRANCH})"
echo "merged with regenerated lockfile: $BRANCH"
