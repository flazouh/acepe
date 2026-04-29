# Agent Env Settings Loading Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make GUI-launched Acepe sessions inherit shell-defined environment variables required by `~/.claude/settings.json` and `~/.codex/settings.toml`, so providers like Azure work without manually exporting keys into the app process.

**Architecture:** Add a shared Rust helper that builds subprocess env maps for agent launches. The helper should start from the current process env, fill missing keys from a cached login-shell environment snapshot, and then re-apply Acepe-controlled `PATH`. Use that helper for Claude, Codex, Cursor, OpenCode, and OpenCode's direct server launch so all agent subprocesses behave consistently. Verify with unit tests that inject shell env data instead of depending on the real machine shell state.

**Tech Stack:** Rust, Tauri 2, tokio/std process spawning, cargo test, bun test, bun run check, cargo clippy

---

## Problem Summary

Acepe currently repairs `PATH` at startup via `fix-path-env`, but every agent provider otherwise forwards only `std::env::vars()` from the GUI app process. When Acepe is launched from Finder/Launchpad, shell-defined variables like `AZURE_API_KEY` are often absent even though the user has them in shell startup files. Claude and Codex still read their settings files, but those files can reference env vars that never make it into the spawned subprocess, which matches the reported "Missing environment variable: AZURE_API_KEY" failure.

## Proposed Scope

- Fix agent subprocess environment construction in Rust.
- Keep the change out of Svelte/UI unless debugging output proves we need surface-level messaging.
- Do not parse Claude/Codex settings files ourselves.
- Do not mutate the entire app process environment globally unless the shared helper approach proves insufficient.

## Task 1: Add Failing Spawn Env Tests

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/provider.rs`
- Read for reference: `packages/desktop/src-tauri/src/acp/providers/claude_code.rs`
- Read for reference: `packages/desktop/src-tauri/src/acp/providers/codex.rs`

**Step 1: Write the failing tests**

Add focused unit tests around a new pure helper seam in `provider.rs`:

```rust
#[test]
fn build_agent_spawn_env_fills_missing_keys_from_shell_env() {
    let base = HashMap::from([
        ("PATH".to_string(), "/gui/bin".to_string()),
        ("HOME".to_string(), "/Users/test".to_string()),
    ]);
    let shell = HashMap::from([
        ("AZURE_API_KEY".to_string(), "secret".to_string()),
        ("PATH".to_string(), "/shell/bin".to_string()),
    ]);

    let env = merge_shell_env(base, Some(shell), "/acepe/path".to_string());

    assert_eq!(env.get("AZURE_API_KEY"), Some(&"secret".to_string()));
    assert_eq!(env.get("PATH"), Some(&"/acepe/path".to_string()));
}

#[test]
fn build_agent_spawn_env_preserves_existing_process_values() {
    let base = HashMap::from([("AZURE_API_KEY".to_string(), "from-process".to_string())]);
    let shell = HashMap::from([("AZURE_API_KEY".to_string(), "from-shell".to_string())]);

    let env = merge_shell_env(base, Some(shell), "/acepe/path".to_string());

    assert_eq!(env.get("AZURE_API_KEY"), Some(&"from-process".to_string()));
}

#[test]
fn build_agent_spawn_env_survives_shell_capture_failure() {
    let base = HashMap::from([("HOME".to_string(), "/Users/test".to_string())]);

    let env = merge_shell_env(base, None, "/acepe/path".to_string());

    assert_eq!(env.get("HOME"), Some(&"/Users/test".to_string()));
    assert_eq!(env.get("PATH"), Some(&"/acepe/path".to_string()));
}
```

**Step 2: Run the targeted tests to verify RED**

Run:

```bash
cd packages/desktop/src-tauri
cargo test build_agent_spawn_env --lib
```

Expected: fail because the merge helper does not exist yet.

**Step 3: Add one parser-focused failure if needed**

If the implementation uses NUL-delimited shell output, add:

```rust
#[test]
fn parse_shell_env_output_reads_nul_delimited_pairs() {
    let parsed = parse_shell_env_output(b"AZURE_API_KEY=secret\0HOME=/Users/test\0");
    assert_eq!(parsed.get("AZURE_API_KEY"), Some(&"secret".to_string()));
}
```

**Step 4: Re-run targeted tests**

Run:

```bash
cd packages/desktop/src-tauri
cargo test build_agent_spawn_env --lib
```

Expected: still red, now on all intended missing behavior.

**Step 5: Commit checkpoint**

```bash
git add packages/desktop/src-tauri/src/acp/provider.rs
git commit -m "test: cover agent spawn env merging"
```

## Task 2: Implement Shared Agent Spawn Env Helper

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/provider.rs`

**Step 1: Add the minimal implementation**

Implement a small helper surface in `provider.rs`:

```rust
pub fn build_agent_spawn_env() -> HashMap<String, String> {
    let base: HashMap<String, String> = std::env::vars().collect();
    let shell_env = load_cached_login_shell_env().ok();
    merge_shell_env(base, shell_env, get_enhanced_path_string())
}
```

Supporting pieces:

- `merge_shell_env(base, shell_env, enhanced_path) -> HashMap<String, String>`
- `load_cached_login_shell_env() -> Result<HashMap<String, String>, String>`
- `capture_login_shell_env() -> Result<HashMap<String, String>, String>`
- `parse_shell_env_output(bytes) -> HashMap<String, String>`

Behavior rules:

- Fill missing keys from shell env, but do not overwrite existing process values except `PATH`.
- Always set `PATH` to `get_enhanced_path_string()` last.
- Cache shell capture result so we do not spawn a login shell for every session.
- Log failures and fall back cleanly instead of failing session creation.

**Step 2: Keep implementation narrow**

Avoid provider-specific knowledge. The helper should not know about Claude, Codex, Azure, or settings file formats.

**Step 3: Re-run targeted tests to verify GREEN**

Run:

```bash
cd packages/desktop/src-tauri
cargo test build_agent_spawn_env --lib
```

Expected: pass.

**Step 4: Add one regression test for cache/fallback behavior if the code path needs it**

Only if the final helper has branching that is not already covered:

```rust
#[test]
fn build_agent_spawn_env_handles_empty_shell_snapshot() { ... }
```

**Step 5: Commit checkpoint**

```bash
git add packages/desktop/src-tauri/src/acp/provider.rs
git commit -m "fix: build agent env from login shell"
```

## Task 3: Route All Agent Launches Through the Helper

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/providers/claude_code.rs`
- Modify: `packages/desktop/src-tauri/src/acp/providers/codex.rs`
- Modify: `packages/desktop/src-tauri/src/acp/providers/cursor.rs`
- Modify: `packages/desktop/src-tauri/src/acp/providers/opencode.rs`
- Modify: `packages/desktop/src-tauri/src/acp/opencode/manager.rs`

**Step 1: Write a provider-level failing test**

Add one minimal assertion in an existing provider test module, for example in `codex.rs`:

```rust
#[test]
fn spawn_config_includes_shared_agent_env() {
    let provider = CodexProvider;
    let config = provider.spawn_config();
    assert!(config.env.contains_key("PATH"));
}
```

If the shared helper is extracted in a way that can be injected for tests, prefer a stronger assertion that verifies `AZURE_API_KEY` gets surfaced via the helper seam instead of touching the real process env.

**Step 2: Replace ad-hoc env construction**

Swap each direct `std::env::vars()` collection with the shared helper:

```rust
let env = build_agent_spawn_env();
```

Also update Cursor model discovery commands and OpenCode's direct `Command` spawn path to use the same env map, so model listing and HTTP-mode startups do not regress.

**Step 3: Run targeted Rust tests**

Run:

```bash
cd packages/desktop/src-tauri
cargo test acp::providers --lib
```

Expected: pass.

**Step 4: Refactor only after green**

If multiple providers need the same import pattern or helper comment, clean that up now without changing behavior.

**Step 5: Commit checkpoint**

```bash
git add packages/desktop/src-tauri/src/acp/providers/claude_code.rs \
        packages/desktop/src-tauri/src/acp/providers/codex.rs \
        packages/desktop/src-tauri/src/acp/providers/cursor.rs \
        packages/desktop/src-tauri/src/acp/providers/opencode.rs \
        packages/desktop/src-tauri/src/acp/opencode/manager.rs
git commit -m "fix: use shared env for agent subprocesses"
```

## Task 4: Full Verification and Manual Smoke

**Files:**
- No new files expected

**Step 1: Run Rust lint**

```bash
cd packages/desktop/src-tauri
cargo clippy --all-targets --all-features -- -D warnings
```

Expected: pass.

**Step 2: Run desktop tests**

```bash
cd packages/desktop
bun test
```

Expected: pass.

**Step 3: Run desktop type-check**

```bash
cd packages/desktop
bun run check
```

Expected: pass.

**Step 4: Manual smoke test**

Manual verification on macOS:

1. Launch Acepe the same way the user does (Finder/Launchpad, not terminal).
2. Ensure `AZURE_API_KEY` is defined in the login shell startup files, not injected manually into the app process.
3. Keep Azure-backed config in `~/.claude/settings.json` and `~/.codex/settings.toml`.
4. Create a Claude session and a Codex session.
5. Confirm neither reports `Missing environment variable: AZURE_API_KEY`.

**Step 5: Final commit**

```bash
git add packages/desktop/src-tauri/src/acp/provider.rs \
        packages/desktop/src-tauri/src/acp/providers/claude_code.rs \
        packages/desktop/src-tauri/src/acp/providers/codex.rs \
        packages/desktop/src-tauri/src/acp/providers/cursor.rs \
        packages/desktop/src-tauri/src/acp/providers/opencode.rs \
        packages/desktop/src-tauri/src/acp/opencode/manager.rs
git commit -m "fix: load shell env for agent settings-backed providers"
```

## Acceptance Criteria

- Claude sessions launched from Acepe can resolve env-backed values from `~/.claude/settings.json`.
- Codex sessions launched from Acepe can resolve env-backed values from `~/.codex/settings.toml`.
- The fix does not require manual `.env` duplication inside Acepe.
- Provider startup still succeeds when shell env capture fails.
- `PATH` handling remains controlled by Acepe and does not regress command discovery.

## Open Questions

- `CustomAgentConfig` currently uses only its explicit `env` map and does not inherit the process env at all. That behavior is probably intentional enough to leave out of this bugfix unless we see a related report.
- The terminal subsystem has the same "PATH only" behavior. It is out of scope for this fix, but worth revisiting if users expect terminal tabs to inherit shell-only env vars too.
