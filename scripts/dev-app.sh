#!/usr/bin/env bash
# Run one long-lived dev app whose UI updates through Vite HMR.
#
# The window loads http://localhost:1420 instead of the copied bundle, so a
# change under packages/desktop/src or packages/ui/src reaches the running app
# with no rebuild and no relaunch. Only a change to the Bun side (src/bun,
# @acepe/electrobun-shell, @acepe/server) needs `bun run electrobun:build`.
#
# launchd owns the dev server so it outlives the shell that started it, and
# `open -g` starts the app in the background so it never steals focus.
#
# Usage:
#   scripts/dev-app.sh          start the dev server and the app
#   scripts/dev-app.sh stop     stop both and drop the dev url
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$ROOT/packages/desktop"
APP="$DESKTOP/electrobun-build/stable-macos-arm64/Acepe.app"
DEV_URL="http://localhost:1420"
LABEL="acepe.vite"
LOG="/tmp/acepe-vite.log"

serving() {
  curl -sf -o /dev/null --max-time 2 "$DEV_URL/" 2>/dev/null
}

if [ "${1:-start}" = "stop" ]; then
  launchctl remove "$LABEL" 2>/dev/null || true
  launchctl unsetenv ACEPE_DEV_URL
  osascript -e 'tell application "Acepe" to quit' 2>/dev/null || true
  echo "dev app stopped"
  exit 0
fi

if [ ! -d "$APP" ]; then
  echo "No app bundle yet. Building once: bun run electrobun:build"
  (cd "$DESKTOP" && VITE_ENABLE_QA_HOOKS=1 bun run electrobun:build)
fi

# The Bun process reads ACEPE_DEV_URL. `open` inherits the launchd session
# environment, which is the only channel that survives LaunchServices.
launchctl setenv ACEPE_DEV_URL "$DEV_URL"

if serving; then
  echo "dev server already serving $DEV_URL"
else
  launchctl remove "$LABEL" 2>/dev/null || true
  launchctl submit -l "$LABEL" -o "$LOG" -e "$LOG" -- \
    /bin/sh -c "cd '$DESKTOP' && VITE_ENABLE_QA_HOOKS=1 exec $(command -v bun) run dev"
  for _ in $(seq 1 40); do
    serving && break
    sleep 1
  done
  if ! serving; then
    echo "dev server did not answer on $DEV_URL. See $LOG" >&2
    exit 1
  fi
  echo "dev server serving $DEV_URL (launchd label $LABEL, log $LOG)"
fi

if pgrep -f 'Acepe.app/Contents/MacOS' >/dev/null; then
  echo "app already running. Edit a component and the window updates in place."
  exit 0
fi

open -g "$APP"
echo "app started in the background from $APP"
echo "Edit a component and the window updates in place. Stop with: scripts/dev-app.sh stop"
