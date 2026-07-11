#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALL_SCRIPT="$REPO_ROOT/scripts/install-from-source.sh"
TEMP_ROOT="$(mktemp -d)"

cleanup() {
	rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT

fail() {
	echo "FAIL: $1" >&2
	exit 1
}

assert_contains() {
	local haystack="$1"
	local needle="$2"

	[[ "$haystack" == *"$needle"* ]] || fail "expected output to contain: $needle"
}

create_fixture_repo() {
	local fixture_root="$1"

	mkdir -p "$fixture_root/scripts" "$fixture_root/packages/desktop"
	cp "$INSTALL_SCRIPT" "$fixture_root/scripts/install-from-source.sh"
}

create_fake_tools() {
	local fixture_root="$1"
	local bin_dir="$fixture_root/fake-bin"

	mkdir -p "$bin_dir"

	cat > "$bin_dir/uname" <<'EOF'
#!/usr/bin/env bash
echo Darwin
EOF

	cat > "$bin_dir/bun" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "--version" ]]; then
	echo 1.3.13
	exit 0
fi
echo "$*" >> "$ACEPE_TEST_COMMAND_LOG"
if [[ "$*" == *"tauri build"* ]]; then
	mkdir -p "$ACEPE_TEST_REPO/packages/desktop/src-tauri/target/release/bundle/macos/Acepe.app"
	printf 'built-from-source\n' > "$ACEPE_TEST_REPO/packages/desktop/src-tauri/target/release/bundle/macos/Acepe.app/build-marker"
	if [[ -n "${ACEPE_TEST_LATE_APP:-}" ]]; then
		mkdir -p "$ACEPE_TEST_LATE_APP"
		printf 'late-install\n' > "$ACEPE_TEST_LATE_APP/existing-marker"
	fi
fi
EOF

	cat > "$bin_dir/cargo" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

	cat > "$bin_dir/rustc" <<'EOF'
#!/usr/bin/env bash
echo 'rustc 1.88.0 (stable)'
EOF

	cat > "$bin_dir/xcode-select" <<'EOF'
#!/usr/bin/env bash
echo /Applications/Xcode.app/Contents/Developer
EOF

	cat > "$bin_dir/mv" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${ACEPE_TEST_FAIL_FINAL_MOVE:-}" && "$1" == *'.Acepe.app.installing.'* ]]; then
	exit 1
fi
/bin/mv "$@"
EOF

	chmod +x "$bin_dir"/*
}

test_help_is_self_contained() {
	local output

	output="$(bash "$INSTALL_SCRIPT" --help)"
	assert_contains "$output" "bun run install:source"
	assert_contains "$output" "--destination"
	assert_contains "$output" "--force"
}

test_builds_and_installs_the_app() {
	local fixture_root="$TEMP_ROOT/success"
	local destination="$fixture_root/Applications"
	local command_log="$fixture_root/commands.log"
	local output

	create_fixture_repo "$fixture_root/repo"
	create_fake_tools "$fixture_root"
	mkdir -p "$destination"

	output="$(
		ACEPE_TEST_COMMAND_LOG="$command_log" \
		ACEPE_TEST_REPO="$fixture_root/repo" \
		PATH="$fixture_root/fake-bin:/usr/bin:/bin" \
		bash "$fixture_root/repo/scripts/install-from-source.sh" --destination "$destination"
	)"

	[[ -f "$destination/Acepe.app/build-marker" ]] || fail "Acepe.app was not installed"
	assert_contains "$(cat "$command_log")" "install --frozen-lockfile"
	assert_contains "$(cat "$command_log")" "tauri build --bundles app --no-sign --ci"
	assert_contains "$output" "$destination/Acepe.app"
}

test_refuses_to_overwrite_an_existing_app() {
	local fixture_root="$TEMP_ROOT/existing"
	local destination="$fixture_root/Applications"
	local output

	create_fixture_repo "$fixture_root/repo"
	create_fake_tools "$fixture_root"
	mkdir -p "$destination/Acepe.app"
	printf 'keep-me\n' > "$destination/Acepe.app/existing-marker"

	if output="$(
		ACEPE_TEST_COMMAND_LOG="$fixture_root/commands.log" \
		ACEPE_TEST_REPO="$fixture_root/repo" \
		PATH="$fixture_root/fake-bin:/usr/bin:/bin" \
		bash "$fixture_root/repo/scripts/install-from-source.sh" --destination "$destination" 2>&1
	)"; then
		fail "install unexpectedly overwrote an existing app"
	fi

	[[ -f "$destination/Acepe.app/existing-marker" ]] || fail "existing app was modified"
	assert_contains "$output" "already exists"
	assert_contains "$output" "--force"
}

test_force_replaces_an_existing_app() {
	local fixture_root="$TEMP_ROOT/force"
	local destination="$fixture_root/Applications"

	create_fixture_repo "$fixture_root/repo"
	create_fake_tools "$fixture_root"
	mkdir -p "$destination/Acepe.app"
	printf 'old-build\n' > "$destination/Acepe.app/existing-marker"

	ACEPE_TEST_COMMAND_LOG="$fixture_root/commands.log" \
	ACEPE_TEST_REPO="$fixture_root/repo" \
	PATH="$fixture_root/fake-bin:/usr/bin:/bin" \
		bash "$fixture_root/repo/scripts/install-from-source.sh" --destination "$destination" --force >/dev/null

	[[ -f "$destination/Acepe.app/build-marker" ]] || fail "forced install did not install the new app"
	[[ ! -e "$destination/Acepe.app/existing-marker" ]] || fail "forced install kept the old app"
}

test_refuses_an_app_that_appears_during_build() {
	local fixture_root="$TEMP_ROOT/late-app"
	local destination="$fixture_root/Applications"
	local output

	create_fixture_repo "$fixture_root/repo"
	create_fake_tools "$fixture_root"
	mkdir -p "$destination"

	if output="$(
		ACEPE_TEST_COMMAND_LOG="$fixture_root/commands.log" \
		ACEPE_TEST_REPO="$fixture_root/repo" \
		ACEPE_TEST_LATE_APP="$destination/Acepe.app" \
		PATH="$fixture_root/fake-bin:/usr/bin:/bin" \
		bash "$fixture_root/repo/scripts/install-from-source.sh" --destination "$destination" 2>&1
	)"; then
		fail "install overwrote an app that appeared during the build"
	fi

	[[ -f "$destination/Acepe.app/existing-marker" ]] || fail "late app was modified"
	assert_contains "$output" "appeared while the build was running"
}

test_restores_existing_app_when_swap_fails() {
	local fixture_root="$TEMP_ROOT/rollback"
	local destination="$fixture_root/Applications"
	local output

	create_fixture_repo "$fixture_root/repo"
	create_fake_tools "$fixture_root"
	mkdir -p "$destination/Acepe.app"
	printf 'keep-me\n' > "$destination/Acepe.app/existing-marker"

	if output="$(
		ACEPE_TEST_COMMAND_LOG="$fixture_root/commands.log" \
		ACEPE_TEST_REPO="$fixture_root/repo" \
		ACEPE_TEST_FAIL_FINAL_MOVE=1 \
		PATH="$fixture_root/fake-bin:/usr/bin:/bin" \
		bash "$fixture_root/repo/scripts/install-from-source.sh" --destination "$destination" --force 2>&1
	)"; then
		fail "install unexpectedly succeeded when the final swap failed"
	fi

	[[ -f "$destination/Acepe.app/existing-marker" ]] || fail "existing app was not restored"
	assert_contains "$output" "previous Acepe.app was restored"
}

test_reports_missing_prerequisite() {
	local fixture_root="$TEMP_ROOT/missing-rust"
	local output

	create_fixture_repo "$fixture_root/repo"
	create_fake_tools "$fixture_root"
	rm "$fixture_root/fake-bin/rustc"

	if output="$(
		ACEPE_TEST_COMMAND_LOG="$fixture_root/commands.log" \
		ACEPE_TEST_REPO="$fixture_root/repo" \
		PATH="$fixture_root/fake-bin:/usr/bin:/bin" \
		bash "$fixture_root/repo/scripts/install-from-source.sh" --destination "$fixture_root/Applications" 2>&1
	)"; then
		fail "install unexpectedly succeeded without rustc"
	fi

	assert_contains "$output" "rustc is required"
}

test_rejects_an_old_bun_version() {
	local fixture_root="$TEMP_ROOT/old-bun"
	local output

	create_fixture_repo "$fixture_root/repo"
	create_fake_tools "$fixture_root"
	sed -i '' 's/echo 1\.3\.13/echo 1.2.9/' "$fixture_root/fake-bin/bun"

	if output="$(
		ACEPE_TEST_COMMAND_LOG="$fixture_root/commands.log" \
		ACEPE_TEST_REPO="$fixture_root/repo" \
		PATH="$fixture_root/fake-bin:/usr/bin:/bin" \
		bash "$fixture_root/repo/scripts/install-from-source.sh" --destination "$fixture_root/Applications" 2>&1
	)"; then
		fail "install unexpectedly accepted an old Bun version"
	fi

	assert_contains "$output" "Bun 1.3 or newer is required"
}

test_rejects_an_unstable_rust_toolchain() {
	local fixture_root="$TEMP_ROOT/nightly-rust"
	local output

	create_fixture_repo "$fixture_root/repo"
	create_fake_tools "$fixture_root"
	sed -i '' 's/rustc 1\.88\.0 (stable)/rustc 1.90.0-nightly/' "$fixture_root/fake-bin/rustc"

	if output="$(
		ACEPE_TEST_COMMAND_LOG="$fixture_root/commands.log" \
		ACEPE_TEST_REPO="$fixture_root/repo" \
		PATH="$fixture_root/fake-bin:/usr/bin:/bin" \
		bash "$fixture_root/repo/scripts/install-from-source.sh" --destination "$fixture_root/Applications" 2>&1
	)"; then
		fail "install unexpectedly accepted nightly Rust"
	fi

	assert_contains "$output" "Stable Rust is required"
}

test_resolves_relative_destination_from_the_calling_directory() {
	local fixture_root="$TEMP_ROOT/relative-destination"
	local caller="$fixture_root/caller"

	create_fixture_repo "$fixture_root/repo"
	create_fake_tools "$fixture_root"
	mkdir -p "$caller/Applications"

	(
		cd "$caller"
		ACEPE_TEST_COMMAND_LOG="$fixture_root/commands.log" \
		ACEPE_TEST_REPO="$fixture_root/repo" \
		PATH="$fixture_root/fake-bin:/usr/bin:/bin" \
			bash "$fixture_root/repo/scripts/install-from-source.sh" --destination Applications >/dev/null
	)

	[[ -f "$caller/Applications/Acepe.app/build-marker" ]] || fail "relative destination was not resolved from the calling directory"
	[[ ! -e "$fixture_root/repo/Applications/Acepe.app" ]] || fail "relative destination changed after entering the repository"
}

test_reports_how_to_clear_a_stale_install_lock() {
	local fixture_root="$TEMP_ROOT/stale-lock"
	local destination="$fixture_root/Applications"
	local output

	create_fixture_repo "$fixture_root/repo"
	create_fake_tools "$fixture_root"
	mkdir -p "$destination/.Acepe.app.install.lock"

	if output="$(
		ACEPE_TEST_COMMAND_LOG="$fixture_root/commands.log" \
		ACEPE_TEST_REPO="$fixture_root/repo" \
		PATH="$fixture_root/fake-bin:/usr/bin:/bin" \
		bash "$fixture_root/repo/scripts/install-from-source.sh" --destination "$destination" 2>&1
	)"; then
		fail "install unexpectedly ignored an existing install lock"
	fi

	assert_contains "$output" "remove the stale lock with"
	assert_contains "$output" "$destination/.Acepe.app.install.lock"
}

test_blocks_a_concurrent_build_for_another_destination() {
	local fixture_root="$TEMP_ROOT/build-lock"
	local build_lock="$fixture_root/repo/packages/desktop/src-tauri/target/.acepe-source-build.lock"
	local output

	create_fixture_repo "$fixture_root/repo"
	create_fake_tools "$fixture_root"
	mkdir -p "$build_lock"

	if output="$(
		ACEPE_TEST_COMMAND_LOG="$fixture_root/commands.log" \
		ACEPE_TEST_REPO="$fixture_root/repo" \
		PATH="$fixture_root/fake-bin:/usr/bin:/bin" \
		bash "$fixture_root/repo/scripts/install-from-source.sh" --destination "$fixture_root/OtherApplications" 2>&1
	)"; then
		fail "install unexpectedly entered a checkout with an active source build"
	fi

	assert_contains "$output" "Another Acepe source build is using this checkout"
	assert_contains "$output" "$build_lock"
}

test_help_is_self_contained
test_builds_and_installs_the_app
test_refuses_to_overwrite_an_existing_app
test_force_replaces_an_existing_app
test_refuses_an_app_that_appears_during_build
test_restores_existing_app_when_swap_fails
test_reports_missing_prerequisite
test_rejects_an_old_bun_version
test_rejects_an_unstable_rust_toolchain
test_resolves_relative_destination_from_the_calling_directory
test_reports_how_to_clear_a_stale_install_lock
test_blocks_a_concurrent_build_for_another_destination

echo "install-from-source: all tests passed"
