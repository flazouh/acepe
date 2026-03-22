#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TAURI_DIR="${DESKTOP_DIR}/src-tauri"
TARGET_DIR="${TAURI_DIR}/target"
STREAMING_LOG_DIR="${TAURI_DIR}/logs/streaming"

# Auto-clean Rust target when it crosses this size.
MAX_TARGET_GB="${MAX_TARGET_GB:-20}"
# Keep only recent streaming logs.
LOG_RETENTION_DAYS="${LOG_RETENTION_DAYS:-14}"

echo "Storage maintenance"
echo "Desktop dir: ${DESKTOP_DIR}"
echo "Target max: ${MAX_TARGET_GB}G"
echo "Log retention: ${LOG_RETENTION_DAYS} days"

if [[ -d "${STREAMING_LOG_DIR}" ]]; then
	find "${STREAMING_LOG_DIR}" -type f -name "*.jsonl" -mtime +"${LOG_RETENTION_DAYS}" -delete
fi

if [[ -d "${TARGET_DIR}" ]]; then
	target_kb="$(du -sk "${TARGET_DIR}" | awk '{ print $1 }')"
	max_target_kb=$((MAX_TARGET_GB * 1024 * 1024))
	if (( target_kb > max_target_kb )); then
		echo "Target exceeded ${MAX_TARGET_GB}G. Running cargo clean..."
		(
			cd "${TAURI_DIR}"
			cargo clean
		)
	else
		echo "Target below threshold. Skipping cargo clean."
	fi
fi

echo "Current sizes:"
du -sh "${TARGET_DIR}" "${TAURI_DIR}/logs" 2>/dev/null || true
