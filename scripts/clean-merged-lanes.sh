#!/usr/bin/env bash
# Remove lane worktrees whose work is genuinely merged.
#
# A previous version checked only `git branch --merged`. That is the branch
# POINTER, not the worktree contents. Lanes are told not to commit, so an
# unmerged lane's branch still points at its base commit, which IS merged —
# and `worktree remove --force` then deletes hours of uncommitted work.
# AC-051's 6,684-to-136 lint burn-down was lost exactly this way.
#
# Refuse to remove any worktree with uncommitted changes, full stop.
set -uo pipefail
REPO="/Users/alex/Documents/acepe"
cd "$REPO"

for dir in /Users/alex/Documents/acepe-lanes/*/; do
  [ -d "$dir" ] || continue
  ticket="$(basename "$dir")"
  branch="feat/$(echo "$ticket" | tr '[:upper:]' '[:lower:]')"

  dirty="$(cd "$dir" && /usr/bin/git status --porcelain 2>/dev/null | grep -v 'lib/services' | wc -l | tr -d ' ')"
  if [ "$dirty" != "0" ]; then
    echo "KEEP $ticket — $dirty uncommitted files. Commit or discard them deliberately."
    continue
  fi

  if ! /usr/bin/git branch --merged 2>/dev/null | grep -q " ${branch}$"; then
    echo "KEEP $ticket — $branch is not merged."
    continue
  fi

  /usr/bin/git worktree remove --force "$dir" 2>/dev/null &&
    /usr/bin/git branch -d "$branch" >/dev/null 2>&1 &&
    echo "removed $ticket"
done

/usr/bin/git worktree prune
