#!/usr/bin/env bash

set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly INVOCATION_DIR="$PWD"
readonly APP_NAME="Acepe.app"
readonly BUILD_APP="$REPO_ROOT/packages/desktop/src-tauri/target/release/bundle/macos/$APP_NAME"
readonly BUILD_LOCK_ROOT="$REPO_ROOT/packages/desktop/src-tauri/target"
readonly BUILD_LOCK="$BUILD_LOCK_ROOT/.acepe-source-build.lock"

destination="/Applications"
force=false

usage() {
	cat <<'EOF'
Build and install Acepe from source on macOS.

Usage:
  bun run install:source [options]

Options:
  --destination <directory>  Install directory (default: /Applications)
  --force                    Replace an existing Acepe.app after a successful build
  -h, --help                 Show this help

Examples:
  bun run install:source
  bun run install:source --destination "$HOME/Applications"
  bun run install:source --force
EOF
}

die() {
	echo "Error: $1" >&2
	exit 1
}

require_command() {
	local command_name="$1"
	local install_hint="$2"

	command -v "$command_name" >/dev/null 2>&1 || die "$command_name is required. $install_hint"
}

require_supported_bun() {
	local bun_version
	local version_core
	local major
	local minor

	bun_version="$(bun --version)"
	version_core="${bun_version%%-*}"
	IFS='.' read -r major minor _ <<< "$version_core"

	[[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ ]] || die "Could not read the installed Bun version: $bun_version"
	if ((major < 1 || (major == 1 && minor < 3))); then
		die "Bun 1.3 or newer is required; found $bun_version. Update Bun with 'bun upgrade'."
	fi
}

require_stable_rust() {
	local rust_version

	rust_version="$(rustc --version)"
	if [[ "$rust_version" == *nightly* || "$rust_version" == *beta* ]]; then
		die "Stable Rust is required; found $rust_version. Run 'rustup default stable'."
	fi
}

run_privileged() {
	if [[ -w "$destination" ]]; then
		"$@"
		return
	fi

	require_command sudo "Run again with --destination \"\$HOME/Applications\" to install without administrator access."
	sudo "$@"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--destination)
			[[ $# -ge 2 ]] || die "--destination requires a directory."
			[[ -n "$2" ]] || die "--destination requires a non-empty directory."
			if [[ "$2" == "/" ]]; then
				destination="/"
			else
				destination="${2%/}"
			fi
			shift 2
			;;
		--force)
			force=true
			shift
			;;
		-h | --help)
			usage
			exit 0
			;;
		*)
			die "Unknown option: $1. Run 'bun run install:source -- --help' for usage."
			;;
	esac
done

if [[ "$destination" != /* ]]; then
	destination="$INVOCATION_DIR/$destination"
fi

[[ "$(uname -s)" == "Darwin" ]] || die "Acepe source installation currently supports macOS only."

require_command bun "Install Bun 1.3 or newer from https://bun.sh/."
require_command cargo "Install stable Rust from https://rustup.rs/."
require_command rustc "Install stable Rust from https://rustup.rs/."
require_command xcode-select "Install the Xcode Command Line Tools with 'xcode-select --install'."
require_command ditto "Install the standard macOS command-line tools."
require_supported_bun
require_stable_rust

xcode-select -p >/dev/null 2>&1 || die "Xcode Command Line Tools are not configured. Run 'xcode-select --install'."

if [[ ! -d "$destination" ]]; then
	mkdir -p "$destination" 2>/dev/null || run_privileged mkdir -p "$destination"
fi

if [[ "$destination" == "/" ]]; then
	readonly INSTALL_APP="/$APP_NAME"
	readonly STAGED_APP="/.Acepe.app.installing.$$"
	readonly BACKUP_APP="/.Acepe.app.backup.$$"
	readonly INSTALL_LOCK="/.Acepe.app.install.lock"
else
	readonly INSTALL_APP="$destination/$APP_NAME"
	readonly STAGED_APP="$destination/.Acepe.app.installing.$$"
	readonly BACKUP_APP="$destination/.Acepe.app.backup.$$"
	readonly INSTALL_LOCK="$destination/.Acepe.app.install.lock"
fi
transaction_active=false
lock_acquired=false
build_lock_acquired=false

rollback_install() {
	local exit_code="$?"

	trap - EXIT INT TERM
	if [[ "$transaction_active" == true && -e "$BACKUP_APP" && ! -e "$INSTALL_APP" ]]; then
		run_privileged mv "$BACKUP_APP" "$INSTALL_APP" || true
	fi
	if [[ -e "$STAGED_APP" ]]; then
		run_privileged rm -rf "$STAGED_APP" || true
	fi
	if [[ "$lock_acquired" == true ]]; then
		run_privileged rmdir "$INSTALL_LOCK" || true
	fi
	if [[ "$build_lock_acquired" == true ]]; then
		rmdir "$BUILD_LOCK" || true
	fi
	exit "$exit_code"
}

acquire_build_lock() {
	mkdir -p "$BUILD_LOCK_ROOT"
	if mkdir "$BUILD_LOCK" 2>/dev/null; then
		build_lock_acquired=true
		return
	fi

	die "Another Acepe source build is using this checkout. If no build is running, remove the stale lock with: rmdir \"$BUILD_LOCK\""
}

acquire_install_lock() {
	local recovery_command

	if run_privileged mkdir "$INSTALL_LOCK" 2>/dev/null; then
		lock_acquired=true
		return
	fi

	if [[ -w "$destination" ]]; then
		recovery_command="rmdir \"$INSTALL_LOCK\""
	else
		recovery_command="sudo rmdir \"$INSTALL_LOCK\""
	fi
	die "Another Acepe source installation is active in $destination. If no installer is running, remove the stale lock with: $recovery_command"
}

trap rollback_install EXIT INT TERM
acquire_build_lock
acquire_install_lock

if [[ -e "$INSTALL_APP" && "$force" != true ]]; then
	die "$INSTALL_APP already exists. Re-run with --force to replace it after a successful build."
fi

echo "→ Installing locked dependencies"
cd "$REPO_ROOT"
bun install --frozen-lockfile

echo "→ Building Acepe.app from source (this may take several minutes)"
bun run --cwd packages/desktop bunx tauri build \
	--bundles app \
	--no-sign \
	--ci \
	--config '{"bundle":{"createUpdaterArtifacts":false}}' \
	-- \
	--no-default-features \
	--features auto-download

[[ -d "$BUILD_APP" ]] || die "Build completed without producing $BUILD_APP."

run_privileged rm -rf "$STAGED_APP"
run_privileged ditto "$BUILD_APP" "$STAGED_APP"

# The build can take a long time. Check again so an app installed while it was
# running is never replaced without explicit consent.
if [[ -e "$INSTALL_APP" && "$force" != true ]]; then
	run_privileged rm -rf "$STAGED_APP"
	die "$INSTALL_APP appeared while the build was running. Re-run with --force to replace it."
fi

if [[ -e "$INSTALL_APP" ]]; then
	run_privileged rm -rf "$BACKUP_APP"
	transaction_active=true
	run_privileged mv "$INSTALL_APP" "$BACKUP_APP"
fi

if ! run_privileged mv "$STAGED_APP" "$INSTALL_APP"; then
	if [[ -e "$BACKUP_APP" ]]; then
		run_privileged mv "$BACKUP_APP" "$INSTALL_APP"
	fi
	transaction_active=false
	run_privileged rm -rf "$STAGED_APP"
	die "Could not install the new app. The previous Acepe.app was restored."
fi
run_privileged rm -rf "$BACKUP_APP"
transaction_active=false
run_privileged rmdir "$INSTALL_LOCK"
lock_acquired=false
rmdir "$BUILD_LOCK"
build_lock_acquired=false
trap - EXIT INT TERM

echo
echo "✓ Acepe was built from source and installed at:"
echo "  $INSTALL_APP"
echo
echo "Open it with: open \"$INSTALL_APP\""
