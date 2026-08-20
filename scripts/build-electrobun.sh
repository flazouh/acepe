#!/usr/bin/env bash
# Build the Electrobun desktop app from the existing Svelte bundle.
# Usage:
#   scripts/build-electrobun.sh
#   ACEPE_SIGN=true scripts/build-electrobun.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$ROOT/packages/desktop"

cd "$DESKTOP"
export ACEPE_ELECTROBUN=1

if [ "${ACEPE_SIGN:-}" = "true" ]; then
  export ACEPE_SIGN=true
  export ELECTROBUN_DEVELOPER_ID="${ELECTROBUN_DEVELOPER_ID:-${APPLE_SIGNING_IDENTITY:-}}"
  export ELECTROBUN_APPLEID="${ELECTROBUN_APPLEID:-${APPLE_ID:-}}"
  export ELECTROBUN_APPLEIDPASS="${ELECTROBUN_APPLEIDPASS:-${APPLE_PASSWORD:-}}"
  export ELECTROBUN_TEAMID="${ELECTROBUN_TEAMID:-${APPLE_TEAM_ID:-}}"
  if [ -z "${ELECTROBUN_DEVELOPER_ID}" ] || [ -z "${ELECTROBUN_APPLEID}" ] || [ -z "${ELECTROBUN_APPLEIDPASS}" ] || [ -z "${ELECTROBUN_TEAMID}" ]; then
    echo "ACEPE_SIGN=true needs ELECTROBUN_DEVELOPER_ID, ELECTROBUN_APPLEID, ELECTROBUN_APPLEIDPASS, and ELECTROBUN_TEAMID (or the APPLE_* equivalents)." >&2
    exit 1
  fi
fi

bun run build
# Electrobun only codesigns, notarises, writes artifacts, and generates patches
# when --env is stable or canary. Plain `electrobun build` stays a local dev bundle.
bunx electrobun build --env=stable

if [ "${ACEPE_SIGN:-}" = "true" ]; then
  APP="$(find electrobun-build -name '*.app' -type d ! -path '*.app/*' | head -n 1 || true)"
  if [ -z "${APP}" ]; then
    echo "No .app bundle found under packages/desktop/electrobun-build" >&2
    exit 1
  fi
  xcrun stapler staple "${APP}"
  xcrun stapler validate "${APP}"
  codesign --verify --deep --strict --verbose=2 "${APP}"
fi
