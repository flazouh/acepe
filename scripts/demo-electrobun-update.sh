#!/usr/bin/env bash
# Demonstrate an Electrobun differential update from build N to N+1.
# Serves the N artifacts locally, then builds N+1 with generatePatch.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$ROOT/packages/desktop"
FROM_VERSION="${ACEPE_VERSION:-2026.3.33}"
TO_VERSION="${FROM_VERSION%.*}.$((${FROM_VERSION##*.} + 1))"
N_DIR="$(mktemp -d "${TMPDIR:-/tmp}/acepe-electrobun-n.XXXXXX")"
SERVER_PID=""

cleanup() {
  if [ -n "${SERVER_PID}" ]; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
  fi
  rm -rf "${N_DIR}"
}
trap cleanup EXIT

cd "$ROOT"
ACEPE_VERSION="${FROM_VERSION}" ACEPE_SIGN="${ACEPE_SIGN:-false}" bash scripts/build-electrobun.sh
mkdir -p "${N_DIR}"
cp -R "${DESKTOP}/electrobun-artifacts/." "${N_DIR}/"

(
  cd "${N_DIR}"
  bun -e 'Bun.serve({ port: 41799, fetch(req) { const path = new URL(req.url).pathname; return new Response(Bun.file("." + path)) } })'
) &
SERVER_PID=$!

ACEPE_VERSION="${TO_VERSION}" ACEPE_BASEURL="http://127.0.0.1:41799/" ACEPE_SIGN="${ACEPE_SIGN:-false}" bash scripts/build-electrobun.sh

PATCH="$(find "${DESKTOP}/electrobun-artifacts" -name '*.patch' | head -n 1 || true)"
if [ -z "${PATCH}" ]; then
  echo "No patch artifact produced for ${FROM_VERSION} -> ${TO_VERSION}" >&2
  ls -la "${DESKTOP}/electrobun-artifacts" >&2 || true
  exit 1
fi

echo "Differential update ${FROM_VERSION} -> ${TO_VERSION}: ${PATCH}"
