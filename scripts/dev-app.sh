#!/usr/bin/env bash
# Run one long-lived dev app per checkout, whose UI updates through Vite HMR.
#
# The window loads the checkout's dev server instead of the copied bundle, so a
# change under packages/desktop/src or packages/ui/src reaches the running app
# with no rebuild and no relaunch. Only a change to the Bun side (src/bun,
# @acepe/electrobun-shell, @acepe/server) needs `bun run electrobun:build`.
#
# Several worktrees can run at once, which is what makes parallel QA possible.
# Each checkout gets its own Vite port, launchd label and QA socket, all derived
# from its path by scripts/dev-instance.ts, so nothing has to be assigned by
# hand and the same worktree always comes back to the same port. The primary
# checkout keeps port 1420 and the bare com.acepe.app socket.
#
# launchd owns both the dev server and the app so they outlive the shell that
# started them. The app is started from its executable rather than `open`,
# because `open` cannot carry per-instance environment and macOS would hand a
# second `open` of the same bundle back to the first window.
#
# Usage:
#   scripts/dev-app.sh          start this checkout's dev server and app
#   scripts/dev-app.sh stop     stop this checkout's dev server and app
#   scripts/dev-app.sh status   show every running Acepe dev instance
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$ROOT/packages/desktop"
BUNDLE_REL="packages/desktop/electrobun-build/stable-macos-arm64/Acepe.app"

# The primary checkout is the main worktree, so a worktree keeps its own
# identity even when invoked from inside the primary's directory tree.
PRIMARY_ROOT="$(git -C "$ROOT" worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2; exit}')"
PRIMARY_ROOT="${PRIMARY_ROOT:-$ROOT}"

# The bundle is only a shell: the window loads the dev url, so the UI under
# test comes from this checkout's Vite server, not from the copied bundle.
# A worktree can therefore borrow the primary's bundle and skip a multi-minute
# `electrobun:build` it would not exercise. Build in the worktree only when the
# Bun side (src/bun, @acepe/electrobun-shell, @acepe/server) is what changed.
APP="$ROOT/$BUNDLE_REL"
if [ ! -d "$APP" ] && [ -d "$PRIMARY_ROOT/$BUNDLE_REL" ]; then
  APP="$PRIMARY_ROOT/$BUNDLE_REL"
  BORROWED_BUNDLE=1
fi
APP_BIN="$APP/Contents/MacOS/launcher"

eval "$(bun "$ROOT/scripts/dev-instance.ts" "$ROOT" "$PRIMARY_ROOT")"

PORT="$ACEPE_INSTANCE_PORT"
APP_ID="$ACEPE_INSTANCE_APP_ID"
LABEL="$ACEPE_INSTANCE_LABEL"
LOG="$ACEPE_INSTANCE_LOG"
APP_LABEL="$LABEL.app"
APP_LOG="/tmp/acepe-app-$ACEPE_INSTANCE_ID.log"
DEV_URL="http://localhost:$PORT"
SOCKET="/tmp/electrobun-qa/$APP_ID.sock"

# Vite binds [::1] here, and whether "localhost" reaches that depends on how the
# resolver orders IPv6 and IPv4. Probing the name alone made readiness a
# coin flip: the server was up and the script waited anyway, then gave up and
# restarted it into the same race. Ask both addresses and accept either.
serving() {
  for host in "localhost" "127.0.0.1" "[::1]"; do
    if curl -sf -o /dev/null --max-time 2 "http://$host:$PORT/" 2>/dev/null; then
      return 0
    fi
  done
  return 1
}

# strictPort makes Vite exit when the port is still held by a dying server, and
# launchd then restarts it into the same failure, so wait for the port to free.
wait_for_free_port() {
  for _ in $(seq 1 20); do
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || return 0
    sleep 1
  done
  echo "port $PORT is still in use" >&2
  return 1
}

if [ "${1:-start}" = "status" ]; then
  printf '%-34s %-52s %s\n' "instance" "socket" "app"
  for sock in /tmp/electrobun-qa/*.sock; do
    [ -e "$sock" ] || continue
    id="$(basename "$sock" .sock)"
    if pgrep -f "acepe-instance=$id" >/dev/null 2>&1; then state="running"; else state="stale socket"; fi
    printf '%-34s %-52s %s\n' "$id" "$sock" "$state"
  done
  exit 0
fi

if [ "${1:-start}" = "stop" ]; then
  launchctl remove "$LABEL" 2>/dev/null || true
  launchctl remove "$APP_LABEL" 2>/dev/null || true
  pkill -f "acepe-instance=$APP_ID" 2>/dev/null || true
  rm -f "$SOCKET"
  wait_for_free_port || true
  echo "dev app stopped ($ACEPE_INSTANCE_ID, port $PORT, $APP_ID)"
  exit 0
fi

if [ ! -d "$APP" ]; then
  echo "No app bundle yet. Building once: bun run electrobun:build"
  (cd "$DESKTOP" && VITE_ENABLE_QA_HOOKS=1 bun run electrobun:build)
  APP="$ROOT/$BUNDLE_REL"
  APP_BIN="$APP/Contents/MacOS/launcher"
fi

# Dictation runs outside the app, through the command this points at. Without
# it the voice service falls back to a stub that transcribes everything to an
# empty string, which the app used to report as "no speech detected".
VOICE_CMD="${ACEPE_VOICE_STT_COMMAND:-$ROOT/scripts/voice-stt-parakeet.sh}"

if serving; then
  echo "dev server already serving $DEV_URL"
else
  launchctl remove "$LABEL" 2>/dev/null || true
  wait_for_free_port
  launchctl submit -l "$LABEL" -o "$LOG" -e "$LOG" -- \
    /bin/sh -c "cd '$DESKTOP' && VITE_ENABLE_QA_HOOKS=1 PORT='$PORT' exec $(command -v bun) run dev --port '$PORT' --strictPort"
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

if pgrep -f "acepe-instance=$APP_ID" >/dev/null 2>&1; then
  echo "app already running ($ACEPE_INSTANCE_ID). Edit a component and the window updates in place."
  exit 0
fi

# A killed instance leaves its QA socket file behind, and the next instance then
# fails to bind it, which reads as "no Electrobun app is listening".
rm -f "$SOCKET"
mkdir -p /tmp/electrobun-qa

# launchd owns the app so it survives this shell, and the env goes to this
# process only -- `launchctl setenv` is machine-wide and two checkouts starting
# at once would overwrite each other's dev url.
# `acepe-instance=` is an inert marker argument the stop and status paths match
# on, so one checkout never signals another checkout's app.
launchctl remove "$APP_LABEL" 2>/dev/null || true
# launchd strips PATH to /usr/bin:/bin:/usr/sbin:/sbin, and the Claude
# adapter resolves the `claude` CLI from the app's PATH (the packaged SDK
# carries no native binary -- see resolveClaudeExecutablePath). Pass the
# caller's PATH through or every real Claude session fails at startSession.
# The fake microphone is opt-in and only reachable in an unsigned build (see
# VoiceRuntime.ts). launchd strips the environment, so the two variables that
# turn it on have to be forwarded here or a QA run gets the real hardware and
# its permission prompt. Empty when the caller did not ask for it.
FAKE_AUDIO_ENV=""
if [ -n "${ELECTROBUN_QA_FAKE_AUDIO:-}" ]; then
  FAKE_AUDIO_ENV="ELECTROBUN_QA_FAKE_AUDIO='$ELECTROBUN_QA_FAKE_AUDIO' "
fi
if [ -n "${ELECTROBUN_QA_FAKE_AUDIO_PATH:-}" ]; then
  FAKE_AUDIO_ENV="${FAKE_AUDIO_ENV}ELECTROBUN_QA_FAKE_AUDIO_PATH='$ELECTROBUN_QA_FAKE_AUDIO_PATH' "
fi

# Remove any stale launchd job from before this app was detached this way.
launchctl remove "$APP_LABEL" 2>/dev/null || true
# Detached with nohup, NOT launchd-managed. launchd keeps a submitted job
# alive and respawns it when the process exits, so closing the window used to
# relaunch the app a second later. nohup + disown lets the app outlive this
# shell without launchd owning it, so a close (or a crash) stays closed. When
# the app exits, tear down the dev-server label too, so closing the window
# stops the whole dev stack rather than leaving vite running headless.
# `stop`/`status` match the app by its `acepe-instance=` marker with
# pkill/pgrep, so they still work.
nohup bash -c "PATH='$PATH' ACEPE_DEV_URL='$DEV_URL' ELECTROBUN_QA_APP_ID='$APP_ID' ACEPE_VOICE_STT_COMMAND='$VOICE_CMD' ${FAKE_AUDIO_ENV}'$APP_BIN' acepe-instance=$APP_ID; launchctl remove '$LABEL' 2>/dev/null || true" >"$APP_LOG" 2>&1 &
disown

for _ in $(seq 1 30); do
  [ -S "$SOCKET" ] && break
  sleep 1
done

if [ ! -S "$SOCKET" ]; then
  echo "app did not open its QA socket at $SOCKET:" >&2
  tail -5 "$APP_LOG" >&2
  exit 1
fi

echo "app started ($ACEPE_INSTANCE_ID) from $APP"
if [ "${BORROWED_BUNDLE:-0}" = "1" ]; then
  echo "  bundle:  borrowed from the primary checkout; the UI comes from this checkout's dev server"
fi
echo "  dev url: $DEV_URL"
echo "  QA:      ELECTROBUN_QA_APP_ID=$APP_ID bun run qa doctor"
echo "Edit a component and the window updates in place. Stop with: scripts/dev-app.sh stop"
