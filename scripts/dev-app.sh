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

# strictPort makes Vite exit when the port is still held by a dying server, and
# launchd then restarts it into the same failure, so wait for the port to free.
wait_for_free_port() {
  for _ in $(seq 1 20); do
    lsof -nP -iTCP:1420 -sTCP:LISTEN >/dev/null 2>&1 || return 0
    sleep 1
  done
  echo "port 1420 is still in use" >&2
  return 1
}

if [ "${1:-start}" = "stop" ]; then
  launchctl remove "$LABEL" 2>/dev/null || true
  launchctl unsetenv ACEPE_DEV_URL
  osascript -e 'tell application "Acepe" to quit' 2>/dev/null || true
  wait_for_free_port || true
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
  wait_for_free_port
  # ACEPE_ELECTROBUN_DEV makes the dev server reload the window on a code edit,
  # because Svelte's in-place swap does not repaint this tree in the WebView.
  launchctl submit -l "$LABEL" -o "$LOG" -e "$LOG" -- \
    /bin/sh -c "cd '$DESKTOP' && VITE_ENABLE_QA_HOOKS=1 ACEPE_ELECTROBUN_DEV=1 exec $(command -v bun) run dev"
  # A first start, or any vite.config.js change, re-optimizes dependencies and
  # can take over a minute before the server answers.
  for _ in $(seq 1 150); do
    serving && break
    sleep 1
  done
  if ! serving; then
    echo "dev server did not answer on $DEV_URL:" >&2
    tail -5 "$LOG" >&2
    exit 1
  fi
  echo "dev server serving $DEV_URL (launchd label $LABEL, log $LOG)"
fi

if pgrep -f 'Acepe.app/Contents/MacOS' >/dev/null; then
  echo "app already running. Edit a component and the window updates in place."
  exit 0
fi

# A killed instance leaves its QA socket file behind, and the next instance then
# fails to bind it, which reads as "no Electrobun app is listening".
rm -f "/tmp/electrobun-qa/com.acepe.app.sock"

open -g "$APP"
echo "app started in the background from $APP"
echo "Edit a component and the window updates in place. Stop with: scripts/dev-app.sh stop"
