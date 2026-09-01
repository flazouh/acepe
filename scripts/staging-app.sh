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
#   scripts/staging-app.sh seed     stop it and copy the REAL DB into staging
#                                   (upgrade rehearsal: new migrations run
#                                   against a copy of live data, never the
#                                   real file)
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
  seed)
    PROD_DB="$HOME/Library/Application Support/com.acepe.app/acepe-tracer-com.acepe.app.sqlite"
    [ -f "$PROD_DB" ] || { echo "no production DB at $PROD_DB" >&2; exit 1; }
    stop_app
    rm -f "$DB_PATH" "$DB_PATH-shm" "$DB_PATH-wal"
    # sqlite's own .backup reads a consistent snapshot even while the real
    # app is running (WAL-safe); a plain cp mid-write would not be.
    sqlite3 "$PROD_DB" ".backup '$DB_PATH'"
    echo "staging DB seeded from a copy of the real DB ($(du -h "$DB_PATH" | cut -f1 | tr -d ' '))"
    echo "start it: scripts/staging-app.sh"
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
# Remove any stale launchd job from before this app was detached this way.
launchctl remove "$APP_LABEL" 2>/dev/null || true
# Detached with nohup, NOT launchd-managed. launchd keeps a submitted job
# alive and respawns it when the process exits, so closing the window used to
# relaunch the app a second later. nohup + disown lets the app outlive this
# shell without launchd owning it, so a close (or a crash) stays closed.
# `stop`/`status` match it by its `acepe-instance=` marker with pkill/pgrep,
# not by a launchd label, so they still work.
# Staging is the release, built here: it runs UNINSTRUMENTED by default, so
# what you test is what ships. No preload script, no QA socket -- the same app
# a user gets. `ELECTROBUN_QA_APP_ID` still rides along, but only to name this
# instance's own tracer DB (never the real one); it no longer implies QA.
# Opt in deliberately when a run has to be driven:
#   ACEPE_QA_SURFACE=1 scripts/staging-app.sh
QA_SURFACE_ENV=""
if [ "${ACEPE_QA_SURFACE:-}" = "1" ]; then
  QA_SURFACE_ENV="ACEPE_QA_SURFACE=1 "
fi

nohup bash -c "PATH='$PATH' ${QA_SURFACE_ENV}ELECTROBUN_QA_APP_ID='$APP_ID' ACEPE_VOICE_STT_COMMAND='$VOICE_CMD' '$APP_BIN' acepe-instance=$APP_ID" >"$APP_LOG" 2>&1 &
disown

# An uninstrumented run opens no QA socket -- that is the point -- so the
# readiness signal is the app process itself. Only an opted-in run waits for
# the socket, which is the thing its caller actually needs.
if [ -n "$QA_SURFACE_ENV" ]; then
  for _ in $(seq 1 30); do
    [ -S "$SOCKET" ] && break
    sleep 1
  done
  if [ ! -S "$SOCKET" ]; then
    echo "staging app did not open its QA socket at $SOCKET:" >&2
    tail -5 "$APP_LOG" >&2
    exit 1
  fi
else
  for _ in $(seq 1 30); do
    pgrep -f "acepe-instance=$APP_ID" >/dev/null 2>&1 && break
    sleep 1
  done
  if ! pgrep -f "acepe-instance=$APP_ID" >/dev/null 2>&1; then
    echo "staging app did not start:" >&2
    tail -5 "$APP_LOG" >&2
    exit 1
  fi
fi

echo "staging app started ($APP_ID) from $APP"
echo "  frontend: bundled build (no dev server) -- rebuild to pick up changes"
echo "  DB:       $DB_PATH"
if [ -n "$QA_SURFACE_ENV" ]; then
  echo "  QA:       instrumented -- ELECTROBUN_QA_APP_ID=$APP_ID bun run qa doctor"
else
  echo "  QA:       off (release-identical). Drive it with: ACEPE_QA_SURFACE=1 scripts/staging-app.sh"
fi
echo "Stop with: scripts/staging-app.sh stop   Fresh DB: scripts/staging-app.sh reset"
