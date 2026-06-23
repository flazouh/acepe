---
title: "fix: Auto-update Acepe-managed Claude CLI so the model picker stays current"
type: fix
status: completed
date: 2026-06-23
---

# fix: Auto-update Acepe-managed Claude CLI so the model picker stays current

## Overview

The Claude model picker shows a stale model set (e.g. Opus 4.7 instead of 4.8) because Acepe runs its **own managed copy** of the Claude CLI, and that copy is **frozen** — it is downloaded once and never updated. The model picker is built by scanning the managed binary for the models baked into it, so a stale binary produces a stale picker.

This plan keeps the intentional design — **Acepe always provisions and runs its own managed Claude CLI, deliberately separate from any Claude the user has installed** — and fixes the actual defect: the managed copy never refreshes. After this change, Acepe keeps its managed copy updated to the **latest** published Claude CLI (subject only to a minimum-supported floor, with **no upper version ceiling**, per product decision), and the model catalog re-scans automatically when the binary changes.

**Out of scope (explicit product decisions):**
- No discovery or use of the user's own Claude installs (PATH, `~/.local`, native installer). Acepe controls its own binary.
- No version ceiling / compatibility window. Latest always wins above the floor. (See Risk Analysis — the adapter-compatibility risk this introduces is accepted, with cheap mitigations.)

---

## Problem Frame

Current behavior (verified this session):

- `find_claude_cli()` (`packages/desktop/src-tauri/src/cc_sdk/transport/subprocess.rs`) resolves only the managed cache binary via `agent_installer::get_cached_binary(ClaudeCode)` → `cc_sdk::cli_download::get_cached_cli_path()`, a **fixed path with an existence check only** — no version awareness.
- Provisioning fires only when the binary is **absent**: `client_factory.rs:32` installs only when `!provider.is_available()`, and `cli_download::ensure_cli` returns early whenever the file exists. There is **no update path**.
- The download is pinned: `PINNED_CLI_VERSION = "2.1.0"`, and `MIN_CLI_VERSION` / `DEFAULT_CLI_VERSION` both alias it. `expected_npm_integrity` only knows the hash for `2.1.0`, and `npm_package_for_version` hard-fails for any other version — so the system cannot currently install anything but `2.1.0`.
- The model catalog (`acp/providers/claude_code/model_catalog.rs`) scans whatever binary `find_claude_cli()` returns and is keyed on a binary fingerprint (path/size/mtime), so it already self-invalidates when the binary changes.

Net: the managed copy is stuck at whatever was first downloaded, the picker reflects that frozen binary, and there is no mechanism to advance it.

---

## Goal / Success Criteria

1. On a normal launch with network access, Acepe's managed Claude CLI advances to the latest published version (above the floor) without user action, and the model picker shows the newest models that binary contains.
2. The scanned binary is always the spawned binary (scan ≡ spawn) — no regression of that invariant.
3. With no network, no npm, or a registry error, Acepe keeps using the existing cached binary and the app remains fully usable (graceful degradation, no blocking, no crash).
4. A binary below the minimum-supported floor is still rejected (existing safety preserved).
5. Updating the binary triggers a catalog re-scan so the picker reflects the new binary within the same session or on next launch.

---

## High-Level Technical Design

*This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
startup (lib.rs .setup spawn, non-blocking)
  └─ ensure_managed_claude_up_to_date()
       ├─ resolve latest published version   (cheap HTTPS probe of npm dist-tag "latest")
       │     └─ on failure → log + return Ok(no-op)   ← graceful degradation
       ├─ read cached binary version          (existing read_claude_cli_version)
       ├─ if cached missing OR cached < latest → download latest into managed cache (atomic)
       │     └─ on failure → keep existing cached binary, log
       └─ if binary changed → invalidate catalog snapshot → warm_catalog_in_background

resolution (unchanged single chokepoint)
  find_claude_cli() → managed cache path → floor check (ensure_supported_managed_claude_cli)
  both model-catalog scan AND subprocess spawn go through this one function
```

Key shift: version selection moves from a hardcoded pin to **"latest ≥ floor"**, and a new **update check** runs at startup instead of install-only-when-absent.

---

## Key Technical Decisions

- **Latest resolution via a cheap version probe, not a blind reinstall.** Probe the npm registry dist-tag `latest` (HTTPS GET of the package's `latest` metadata) to get a version string, compare to the cached binary's `--version`, and only download when newer or missing. This avoids a ~213 MB reinstall on every launch. `reqwest` is already a dependency.
- **Drop the hardcoded per-version integrity pin; rely on npm's registry integrity verification.** With "always latest" there is no pre-vetted hash to compare against. `npm install` already verifies the downloaded tarball against the registry's signed integrity metadata over HTTPS. We remove the `expected_npm_integrity` hard-gate and the `2.1.0`-only constant. (Defense-in-depth alternative, deferred: fetch the resolved version's `dist.integrity` from the registry packument and compare to the lockfile integrity — redundant with npm's own check, so not included now.)
- **Floor stays, decoupled from the pin.** `MIN_CLI_VERSION` becomes its own real constant (current known-good minimum), no longer an alias of the removed pin. `ensure_supported_managed_claude_cli` keeps rejecting sub-floor binaries.
- **No ceiling.** Any latest ≥ floor is accepted. The adapter-compatibility risk is accepted per product decision; see Risk Analysis for mitigations.
- **Update is best-effort and non-blocking.** It runs in the existing startup `tokio::spawn`. Any failure (offline, npm missing, registry error, download error) is logged and leaves the previously cached binary in place. The app never blocks on it.
- **Atomic replace is NEW behavior, not existing.** ⚠️ Verified against code: today `install_cli_unix`/`install_cli_windows` do `std::fs::copy(&npm_bin_path, target_path)` **directly onto the live cache binary** — non-atomic, same inode, so a partial/failed copy corrupts the working binary and a copy concurrent with a running session can corrupt the executing image. This plan must **replace** that with: copy into a temp file **inside `get_cache_dir()`** (same filesystem as the target — do NOT stage in `std::env::temp_dir()`, which risks a cross-device `EXDEV` rename failure), `chmod 0755`, then `std::fs::rename(temp, target)`. Same-filesystem rename is atomic and yields a fresh inode, so a running Claude subprocess keeps its old inode and is unaffected.
- **Catalog invalidation is mostly free.** The snapshot already keys on binary fingerprint, so a changed binary auto-invalidates on next read. We additionally invalidate explicitly after a successful update and re-warm, so the picker refreshes promptly.

---

## Implementation Units

### U1. Decouple the version floor from the pin and add latest-version resolution

**Goal:** Stop treating `2.1.0` as the only installable version. Establish an explicit floor and a resolver for the latest published version.

**Requirements:** Success criteria 1, 4.

**Dependencies:** none.

**Files:**
- `packages/desktop/src-tauri/src/cc_sdk/cli_download.rs` (modify constants; add `resolve_latest_cli_version`)
- `packages/desktop/src-tauri/src/cc_sdk/cli_download.rs` tests (in-file `#[cfg(test)] mod tests`)

**Approach:**
- Replace the `MIN_CLI_VERSION = PINNED_CLI_VERSION` aliasing: make `MIN_CLI_VERSION` a standalone floor constant. **Keep the literal floor value at the current known-good minimum (`2.1.0`)** — "independent of the pin" means the constant is decoupled (no longer aliased), not that the value changes. Remove `DEFAULT_CLI_VERSION`/`PINNED_CLI_VERSION` (and the `2.1.0` integrity constant) where they force a single version.
- Add `async fn resolve_latest_cli_version() -> Result<SemVer>` that HTTPS-GETs the npm registry endpoint `https://registry.npmjs.org/@anthropic-ai/claude-code`, reads `dist-tags.latest`, and parses it. **Decide prerelease/build-metadata handling explicitly:** the existing `SemVer::parse` silently drops anything after `patch`, while `is_exact_semver` (U2) rejects non-3-part versions — so a prerelease `latest` would parse-then-be-rejected and break the install path. Skip (treat as `AlreadyCurrent`/no-op) any `latest` that is not a clean 3-part release version.
- **Export prerequisites from `subprocess.rs`:** both `SemVer` and `read_claude_cli_version` are currently private; make them crate-visible so U1/U3 can reuse them (avoid duplicating semver logic). 
- Network/parse failures return `Err` (caller degrades gracefully; this fn does not panic or block).

**Patterns to follow:** existing `reqwest::Client` usage in `agent_installer.rs` (timeouts, error mapping to `SdkError`/`AcpError`); existing `SemVer` in `subprocess.rs`.

**Test scenarios:**
- Floor constant parses and is independent of any pin (e.g. `MIN_CLI_VERSION` parses to the expected floor).
- `resolve_latest_cli_version` parses a representative registry `latest` JSON payload into the correct `SemVer` (feed a fixture/mocked response; do not hit the network in tests).
- Malformed/empty registry payload → `Err`, not a panic.
- `Test expectation:` no test asserts on a specific live "latest" value (it changes upstream); assert on parsing behavior only.

### U2. Allow installing any resolved version and remove the hardcoded integrity gate

**Goal:** Make the npm install path install the resolved latest version, verified by npm's own registry integrity, instead of failing for anything but `2.1.0`.

**Requirements:** Success criteria 1, 3.

**Dependencies:** U1.

**Files:**
- `packages/desktop/src-tauri/src/cc_sdk/cli_download.rs` (`npm_package_for_version`, `expected_npm_integrity`, `verify_npm_package_lock_integrity`, `install_cli_unix`, `install_cli_windows`, `download_cli`)
- `packages/desktop/src-tauri/src/cc_sdk/cli_download.rs` tests

**Approach:**
- Remove the `expected_npm_integrity` constant-match gate and the `2.1.0`-only `CLAUDE_CODE_NPM_INTEGRITY_2_1_0` constant. `npm install` over HTTPS already verifies tarball integrity against registry metadata.
- `npm_package_for_version` keeps the exact-semver shape check (reject ranges/tags passed internally) but no longer requires a known integrity.
- `download_cli(version)` accepts the resolved latest version (or `None` → resolve latest via U1) and installs `@<version>`.
- Keep `--ignore-scripts`. Replace the in-place `std::fs::copy` onto the live target with the atomic temp-in-cache-dir + `rename` described in Key Technical Decisions.
- **Delete the integrity helpers entirely** (not just bypass them): remove `CLAUDE_CODE_NPM_INTEGRITY_2_1_0`, `expected_npm_integrity`, and `verify_npm_package_lock_integrity` plus its call sites in `install_cli_unix`/`install_cli_windows` — once the pin is gone the lockfile re-check has nothing to compare against and would be dead code referencing a removed constant.
- Update the user-facing "install manually" error strings to not reference the removed pin.

**Patterns to follow:** existing `install_cli_unix`/`install_cli_windows` structure (temp prefix install, copy `node_modules/.bin/claude`, chmod 0755, cleanup).

**Test scenarios:**
- `npm_package_for_version` accepts a valid exact semver other than `2.1.0` and returns `@anthropic-ai/claude-code@<version>`.
- `npm_package_for_version` rejects a non-exact version (range/tag) with a clear error.
- `is_exact_semver` unchanged behavior (regression guard).
- **Update/remove all pin-coupled existing tests in `cli_download.rs`** (verified present): `test_cli_version_constants` (asserts `DEFAULT_CLI_VERSION == MIN_CLI_VERSION == PINNED_CLI_VERSION` — rewrite to assert the floor is its own constant), `test_download_package_requires_exact_version` (rewrite to assert an arbitrary exact semver is accepted, no longer gated by integrity), and `test_package_lock_integrity_must_match_pin` (remove with the gate). The plan previously named only the integrity test; all three break and must be handled.

### U3. Add a version-aware update check that refreshes the managed binary atomically

**Goal:** Provide the actual "keep it current" mechanism: compare cached vs latest and re-download when stale, without corrupting the working binary.

**Requirements:** Success criteria 1, 3, 5.

**Dependencies:** U1, U2.

**Files:**
- `packages/desktop/src-tauri/src/cc_sdk/cli_download.rs` (new `async fn ensure_managed_claude_up_to_date(...) -> Result<UpdateOutcome>`)
- `packages/desktop/src-tauri/src/cc_sdk/cli_download.rs` tests

**Approach:**
- New entry point that: checks the cached binary exists; if **absent → return `SkippedCold` without downloading** (cold install stays owned by `client_factory`/`install_agent`, which holds the existing `install_guard` mutex — see race note below); otherwise resolves latest (U1), reads the cached version via `read_claude_cli_version`, and if `cached < latest` downloads latest (U2) into a temp file in the cache dir and atomically renames it over the managed path. Returns an outcome enum (`Updated { from, to }` / `AlreadyCurrent` / `SkippedCold` / `SkippedOffline` / `SkippedError`).
- **Cold-start race (verified):** `client_factory.rs:32` still installs ClaudeCode on first session use via `install_agent` (guarded by `install_guard`), and both that path and `download_cli` share the same target path and the same `std::env::temp_dir().join("cc-sdk-npm-install")` scratch dir (each does `remove_dir_all` on it). Skipping the absent case removes the concurrent-writer overlap for cold start. For extra safety, route `ensure_managed_claude_up_to_date`'s download through the same `install_guard` (or a dedicated lock) and give the install a unique temp dir so a manual install triggered concurrently cannot collide.
- All failure modes (probe failure, npm missing, download failure) return a non-error "skipped" outcome and leave the existing binary untouched — the caller must never surface a blocking error from this path.
- Do **not** add a ceiling check. Do add the floor check on the resulting binary (reuse `ensure_supported_managed_claude_cli`) so a (hypothetical) sub-floor latest is rejected rather than installed.

**Execution note:** Start with a failing test for the decision logic (cached < latest → attempts update; cached ≥ latest → no-op; resolve failure → SkippedOffline) using injected version values, before wiring real download.

**Test scenarios:**
- cached version < latest → outcome is an update attempt (mock the download boundary).
- cached version == latest → `AlreadyCurrent`, no download invoked.
- cached version > latest (shouldn't happen, but guard) → `AlreadyCurrent`, no downgrade.
- cached binary missing → `SkippedCold`, no download invoked (cold install owned by client_factory), no race with `install_agent`.
- latest resolution fails (offline) → `SkippedOffline`, existing binary path still returned/usable, no error propagated.
- download fails mid-flight → existing binary remains the valid one (atomic rename never happened); outcome `SkippedError`.
- resolved latest below floor → rejected via floor check, existing binary retained.

### U4. Run the update check at startup and refresh the catalog after an update

**Goal:** Invoke the update check during app startup, non-blocking, and make the model picker reflect a newly updated binary.

**Requirements:** Success criteria 1, 2, 5.

**Dependencies:** U3.

**Files:**
- `packages/desktop/src-tauri/src/lib.rs` (the `.setup()` ClaudeCode catalog-warm call, verified at ~lines 768–774)
- `packages/desktop/src-tauri/src/acp/providers/claude_code/model_catalog.rs` (reuse `invalidate_catalog_snapshot_for_app` + `warm_catalog_in_background`)

**Approach (corrected against real structure):**
- The actual code is a **synchronous `if is_installed(ClaudeCode)` guard** at lib.rs:768–774 that calls `warm_catalog_in_background`, which **self-spawns** via `tauri::async_runtime::spawn`. The `tokio::spawn` at line 729 is the unrelated shell-env prewarm — do **not** nest the update check inside it.
- `ensure_managed_claude_up_to_date` does **not** self-spawn, so wrap the call in its **own** `tauri::async_runtime::spawn`. Place it inside the `is_installed(ClaudeCode)` block: that branch is exactly the "installed but (maybe) stale" case this fix targets, and U3 already returns `SkippedCold` if the binary is absent, so the cold path stays with `client_factory`.
- On an `Updated` outcome, `await` `invalidate_catalog_snapshot_for_app` then call `warm_catalog_in_background` so the picker reflects the new binary. On non-update outcomes, keep current behavior (warm only).
- Do not introduce any synchronous `await` on the startup critical path; the ~213 MB npm install must run inside the spawned task.

**Patterns to follow:** the existing `tokio::spawn` + `warm_catalog_in_background` startup wiring; `model_catalog.rs` `spawn_catalog_refresh` / `invalidate_catalog_snapshot_for_app`.

**Test scenarios:**
- Integration-style: after a simulated `Updated` outcome, the catalog snapshot for the app is invalidated and a re-warm is scheduled (assert via the catalog module's observable state/seams, not by reading source).
- Non-update outcome does not invalidate the snapshot (no needless re-scan / no churn).
- `Test expectation:` startup non-blocking property is covered by keeping the call inside the existing spawn; note that a true timing assertion is an execution-time concern, not unit-tested here.

### U5. Preserve and lock in the scan ≡ spawn invariant

**Goal:** Ensure the model-catalog scan and the subprocess spawn cannot diverge, now that the binary can change under them.

**Requirements:** Success criterion 2.

**Dependencies:** U4.

**Files:**
- `packages/desktop/src-tauri/src/cc_sdk/transport/subprocess.rs` (`find_claude_cli`)
- `packages/desktop/src-tauri/src/acp/providers/claude_code/model_catalog.rs` (`current_binary_fingerprint`, `fetch_authoritative_catalog`)
- test file alongside whichever module hosts the assertion

**Approach (test-only regression guard):**
- **Verified: the invariant already holds today** — `current_binary_fingerprint` (model_catalog.rs:446) and `fetch_authoritative_catalog` (model_catalog.rs:610) both already resolve via `find_claude_cli()`, the same function the spawn path uses. So this unit adds **no production code** under normal circumstances; it is a regression lock for Success Criterion 2.
- Add a test asserting both the fingerprint source and the spawn command resolve to the same path for a given managed-cache state. Only if that test reveals an independently-resolving path, route it through `find_claude_cli()`. No on-disk discovery is added (per product decision).

**Test scenarios:**
- Both the fingerprint source and the spawn command resolve to the same path given the same managed-cache state (assert they call the shared resolver / return equal paths).
- Floor rejection still surfaces from `find_claude_cli` when the managed binary is below `MIN_CLI_VERSION`.

---

## System-Wide Impact

- **Affected:** Claude Code provider runtime (binary resolution, install/update), the Claude model catalog (input freshness only — extraction logic unchanged), app startup sequence.
- **Not affected:** model-extraction regex/logic, catalog snapshot format, UI projection of the picker, other providers (Copilot/Codex/Cursor/OpenCode keep their own install paths).
- **GOD posture:** This moves truth *upstream* — it keeps the canonical, Rust-owned source binary current rather than patching the downstream picker. The model catalog stays Rust-owned canonical data; no provider-quirk repair leaks into TypeScript/UI. Aligned with the GOD architecture gate.

---

## Risk Analysis & Mitigation

- **No ceiling → a future Claude release could break the vendored ACP adapter** (`@zed-industries/claude-agent-acp` patch + `static-entry.ts`). **Blast radius (honest framing):** the failure is *silent, fleet-wide, triggered just by launching, and undiagnosable in-product* — a user who did nothing sees Claude agents stop working after a background update. The floor does **not** catch a too-new break, and logging is post-hoc (logs aren't user-visible). Reviewers (product + security + adversarial) flagged that the current mitigations don't *contain* the failure. **DECISION (accepted):** ship without rollback — floor as a hard gate, manual file-swap as recovery (the procedure used to unblock this session). Last-known-good rollback stays deferred; this is a knowingly accepted P1 risk.
- **Supply chain (honest framing):** removing the hardcoded integrity pin removes an **Acepe-controlled, independent trust anchor** — not merely a redundant check. npm's registry "integrity" is a self-asserted hash served over the *same channel* as the tarball, so it does not defend against a registry compromise or a maintainer-account takeover that republishes `latest`; that poisoned binary would verify clean and be auto-installed **and auto-executed at startup**. (`--ignore-scripts` does not help — the `claude` binary itself is spawned.) The deferred `dist.integrity` re-check is genuinely redundant (same channel); the *real* defense-in-depth is **publisher provenance/signature verification** (npm provenance / sigstore attestations) or an out-of-band known-good hash allowlist. **DECISION (accepted):** rely on npm's standard HTTPS trust model; no independent anchor in v1. Knowingly accepted P1 supply-chain residual risk; provenance verification stays deferred.
- **Offline / npm missing / registry error:** must degrade to "use existing cached binary," never block startup or crash. Covered by U3's skipped-outcome design and U4's non-blocking spawn.
- **Update while a session is running:** atomic temp+rename; running subprocess keeps its inode. New version applies to subsequently spawned sessions.
- **Repeated reinstall churn:** the cheap version probe gates downloads so the ~213 MB install runs only on an actual version bump.

---

## Resolved Decisions (from document review)

Document review surfaced two strategic pushbacks on choices already taken (no ceiling, drop the pin). Both were reviewed and **knowingly accepted by the product owner**:

1. **No-ceiling breakage containment → ACCEPTED AS-IS.** No last-known-good rollback in v1. Recovery is the floor gate + manual binary swap. Accepted P1 risk.
2. **Supply-chain trust anchor → ACCEPTED AS-IS.** Rely on npm's HTTPS integrity; no independent provenance/signature anchor in v1. Accepted P1 risk.

(A lighter alternative reviewers raised — decoupling model-catalog freshness from binary replacement — was considered and not pursued; always-latest binary update is the chosen approach.)

---

## Deferred to Follow-Up Work

- Publisher provenance / signature verification, or an out-of-band known-good hash allowlist (the meaningful supply-chain control; the `dist.integrity` re-check is redundant with npm and is **not** worth doing).
- Last-known-good rollback / remote max-version kill-switch — *unless* promoted to v1 per Open Decision 1.
- A user-facing setting to pin a specific managed version (not requested; current design is "always latest"). Note: product-lens flagged this may be a near-term ask for Acepe's reproducibility-minded audience.

---

## Open Questions (deferred to implementation)

- Exact npm registry endpoint/shape for the `latest` dist-tag probe and its precise JSON path — confirm at implementation against the live registry.
- Whether `SemVer` is best exported from `subprocess.rs` or relocated to a shared module — decide when wiring U1 (prefer the smaller change).
- Update cadence beyond startup (e.g. periodic re-check during a long-running session) — startup-only is sufficient for the stated goal; revisit only if needed.
