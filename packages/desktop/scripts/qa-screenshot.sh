#!/bin/sh
# Capture the dev Acepe window (this checkout's electrobun-build) as a PNG.
# Usage: sh scripts/qa-screenshot.sh [out.png]
# Prints the output path on success. Companion to `bun run qa`: DOM facts stay
# the QA evidence; this exists so every QA pass can show the user the window.
set -e
out="${1:-/tmp/acepe-qa-screenshot.png}"
script_dir="$(cd "$(dirname "$0")" && pwd)"
desktop_root="$(cd "$script_dir/.." && pwd)"
pid="$(pgrep -f "$desktop_root/electrobun-build/.*Resources/main.js" | head -1 || true)"
if [ -z "$pid" ]; then
	echo "dev Acepe from this checkout is not running" >&2
	exit 1
fi
win="$(swift - "$pid" <<'SWIFT'
import CoreGraphics
import Foundation
let pid = Int(CommandLine.arguments[1])!
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
for w in list {
	if w[kCGWindowOwnerPID as String] as? Int == pid, (w[kCGWindowLayer as String] as? Int ?? 1) == 0 {
		print(w[kCGWindowNumber as String] as? Int ?? 0)
		break
	}
}
SWIFT
)"
if [ -z "$win" ]; then
	echo "no on-screen window for dev Acepe pid $pid" >&2
	exit 1
fi
screencapture -x -o -l "$win" "$out"
echo "$out"
