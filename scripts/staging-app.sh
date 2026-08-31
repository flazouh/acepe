#!/usr/bin/env bash
# Run the built app as a local staging release: the window loads the BUNDLED
# frontend (no dev server, no HMR), exactly like an installed release, but the
# instance id `com.acepe.app.staging` gives it its OWN tracer sqlite DB
# (acepe-tracer-com.acepe.app.staging.sqlite, see
# packages/desktop/src/bun/tracer-db-path.ts) and its own QA socket, so a
# staging test never reads or migrates the real com.acepe.app database.
#
# The bundle is the whole app here: rebuild with `bun run electrobun:build`
# to pick up ANY change, frontend included -- there is no dev url to reload.
#
# Usage:
#   scripts/staging-app.sh          build if missing, start the staging app
#   scripts/staging-app.sh stop     stop the staging app
#   scripts/staging-app.sh reset    stop it and delete the staging DB
#   scripts/staging-app.sh status   show whether the staging app runs
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$ROOT/packages/desktop"
APP="$DESKTOP/electrobun-build/stable-macos-arm64/Acepe.app"
APP_BIN="$APP/Contents/MacOS/launcher"

APP_ID="com.acepe.app.staging"
APP_LABEL="acepe.staging.app"
APP_LOG="/tmp/acepe-app-staging.log"
SOCKET="/tmp/electrobun-qa/$APP_ID.sock"
# Mirrors resolveTracerDbPath: the data ROOT stays the shared com.acepe.app
# directory; only the per-instance sqlite filename differs.
DB_PATH="$HOME/Library/Application Support/com.acepe.app/acepe-tracer-$APP_ID.sqlite"

stop_app() {
  launchctl remove "$APP_LABEL" 2>/dev/null || true
  pkill -f "acepe-instance=$APP_ID" 2>/dev/null || true
  rm -f "$SOCKET"
}

case "${1:-start}" in
  status)
    if pgrep -f "acepe-instance=$APP_ID" >/dev/null 2>&1; then
      echo "staging app running ($APP_ID, log $APP_LOG)"
    else
      echo "staging app not running"
    fi
    ls -lh "$DB_PATH" 2>/dev/null || echo "no staging DB yet ($DB_PATH)"
    exit 0
    ;;
  stop)
    stop_app
    echo "staging app stopped ($APP_ID)"
    exit 0
    ;;
  reset)
    stop_app
    rm -f "$DB_PATH" "$DB_PATH-shm" "$DB_PATH-wal"
    echo "staging app stopped and staging DB deleted ($DB_PATH)"
    exit 0
    ;;
  start) ;;
  *)
    echo "usage: scripts/staging-app.sh [start|stop|reset|status]" >&2
    exit 1
    ;;
esac

if [ ! -d "$APP" ]; then
  echo "No app bundle yet. Building once: bun run electrobun:build"
  (cd "$DESKTOP" && bun run electrobun:build)
fi

if pgrep -f "acepe-instance=$APP_ID" >/dev/null 2>&1; then
  echo "staging app already running ($APP_ID). Rebuild + restart to pick up changes."
  exit 0
fi

# A killed instance leaves its QA socket behind and the next bind fails.
rm -f "$SOCKET"
mkdir -p /tmp/electrobun-qa

VOICE_CMD="${ACEPE_VOICE_STT_COMMAND:-$ROOT/scripts/voice-stt-parakeet.sh}"

# launchd owns the app so it survives this shell. Deliberately NO
# ACEPE_DEV_URL: its absence is what makes this a release-shaped run (see
# readDevWindowUrl in packages/desktop/src/bun/index.ts). PATH is forwarded
# because launchd strips it and the Claude adapter resolves the `claude` CLI
# from the app's PATH.
launchctl remove "$APP_LABEL" 2>/dev/null || true
launchctl submit -l "$APP_LABEL" -o "$APP_LOG" -e "$APP_LOG" -- \
  /bin/sh -c "PATH='$PATH' ELECTROBUN_QA_APP_ID='$APP_ID' ACEPE_VOICE_STT_COMMAND='$VOICE_CMD' exec '$APP_BIN' acepe-instance=$APP_ID"

for _ in $(seq 1 30); do
  [ -S "$SOCKET" ] && break
  sleep 1
done

if [ ! -S "$SOCKET" ]; then
  echo "staging app did not open its QA socket at $SOCKET:" >&2
  tail -5 "$APP_LOG" >&2
  exit 1
fi

echo "staging app started ($APP_ID) from $APP"
echo "  frontend: bundled build (no dev server) -- rebuild to pick up changes"
echo "  DB:       $DB_PATH"
echo "  QA:       ELECTROBUN_QA_APP_ID=$APP_ID bun run qa doctor"
echo "Stop with: scripts/staging-app.sh stop   Fresh DB: scripts/staging-app.sh reset"
