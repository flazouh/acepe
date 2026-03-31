# Session Metadata Placeholder Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove fake `__worktree__/...` session metadata semantics so session loading, scanning, and resume behavior derive only from real persisted facts.

**Architecture:** Keep a single `session_metadata` record per session, but redefine it as factual metadata only: `project_path`, optional `worktree_path`, optional real `source_path`/`file_path`, and timestamps. Replace placeholder-path conventions with explicit null handling, normalize legacy sentinel rows on read/write, and update scan/resume logic to reason from actual fields rather than `is_placeholder()` heuristics.

**Tech Stack:** Rust, Tauri 2, SeaORM/SQLite, Bun test runner for frontend verification

---

## File Structure

**Modify:**
- `packages/desktop/src-tauri/src/db/repository.rs` - remove sentinel placeholder file-path writes, add legacy normalization helpers, redefine placeholder semantics around factual metadata
- `packages/desktop/src-tauri/src/db/repository_test.rs` - repository tests for legacy row normalization and placeholder insertion/update behavior
- `packages/desktop/src-tauri/src/history/commands/scanning.rs` - never emit fake `source_path` values into `HistoryEntry`
- `packages/desktop/src-tauri/src/history/commands/session_loading.rs` - keep OpenCode/other loaders working when `source_path` is absent and add tests around explicit factual metadata
- `packages/desktop/src-tauri/src/acp/commands/session_commands.rs` - make resume decisions from real persisted metadata instead of sentinel-placeholder rejection
- `packages/desktop/src-tauri/src/acp/commands/tests.rs` - regression tests for resume behavior with normalized legacy metadata rows

**Optional modify if tests demand it:**
- `packages/desktop/src-tauri/src/opencode_history/parser.rs` - only if a test proves OpenCode loading still relies on fake `source_path`
- `packages/desktop/src/lib/acp/store/services/session-connection-manager.ts` - only if frontend assumptions conflict with the cleaned backend contract

**Verify:**
- `packages/desktop/src/lib/acp/store/__tests__/workspace-sidebar-state-persistence.test.ts`
- `packages/desktop/src/lib/components/main-app-view/tests/initialization-manager.test.ts`

### Task 1: Lock Down Repository Semantics With Failing Rust Tests

**Files:**
- Modify: `packages/desktop/src-tauri/src/db/repository_test.rs`
- Reference: `packages/desktop/src-tauri/src/db/repository.rs`

- [ ] **Step 1: Write a failing test proving legacy sentinel file paths normalize to no source path**

Add a repository test near the existing `set_worktree_path` coverage that inserts a `session_metadata` row with:

```rust
file_path: "__worktree__/ses_legacy".to_string(),
file_mtime: 0,
file_size: 0,
worktree_path: Some("/tmp/real-worktree".to_string()),
```

Then assert the row returned through repository access does **not** surface the sentinel as a usable source path contract. Concretely, the test should exercise whatever helper you add for normalization and expect:

```rust
assert_eq!(normalized_source_path(row.file_path.as_str()), None);
```

- [ ] **Step 2: Run the focused repository test to verify it fails**

Run:

```bash
cargo test --lib db::repository_test::test_normalized_source_path_hides_worktree_sentinel
```

Expected: FAIL because no normalization helper exists yet, or because sentinel paths are still treated as real file paths.

- [ ] **Step 3: Write a failing test proving placeholder insertion no longer invents fake file paths**

Add a second test for `SessionMetadataRepository::ensure_exists(...)` that creates a session with `worktree_path: Some(...)` and asserts the inserted row stores factual values only:

```rust
assert_eq!(session.worktree_path.as_deref(), Some("/tmp/real-worktree"));
assert!(session.file_path.is_empty());
assert_eq!(session.file_mtime, 0);
assert_eq!(session.file_size, 0);
```

- [ ] **Step 4: Run that focused repository test to verify it fails**

Run:

```bash
cargo test --lib db::repository_test::test_ensure_exists_for_worktree_session_does_not_write_sentinel_file_path
```

Expected: FAIL because `insert_placeholder()` still writes `__worktree__/...`.

### Task 2: Implement Canonical Metadata Semantics In The Repository Layer

**Files:**
- Modify: `packages/desktop/src-tauri/src/db/repository.rs`
- Test: `packages/desktop/src-tauri/src/db/repository_test.rs`

- [ ] **Step 1: Add explicit normalization helpers in `repository.rs`**

Add small helpers near `SessionMetadataRow`:

```rust
fn is_legacy_worktree_sentinel(file_path: &str) -> bool {
    file_path.starts_with("__worktree__/")
}

fn normalized_source_path(file_path: &str) -> Option<String> {
    if file_path.is_empty() || is_legacy_worktree_sentinel(file_path) {
        None
    } else {
        Some(file_path.to_string())
    }
}
```

Keep them private unless tests require wider visibility.

- [ ] **Step 2: Replace placeholder-file-path writes with factual null/empty semantics**

In `insert_placeholder(...)`, replace:

```rust
let placeholder_file_path = format!("__worktree__/{}", session_id);
file_path: Set(placeholder_file_path),
```

with:

```rust
file_path: Set(String::new()),
```

and leave `worktree_path` as the only worktree indicator.

- [ ] **Step 3: Redefine `is_placeholder()` so it no longer depends on the sentinel path**

Update `SessionMetadataRow::is_placeholder()` to express placeholder-ness as “no real source metadata yet”, for example:

```rust
pub fn is_placeholder(&self) -> bool {
    self.file_mtime == 0
        && self.file_size == 0
        && normalized_source_path(&self.file_path).is_none()
}
```

This preserves compatibility for both legacy sentinel rows and new empty-path rows.

- [ ] **Step 4: Run the two focused repository tests to verify they now pass**

Run:

```bash
cargo test --lib db::repository_test::test_normalized_source_path_hides_worktree_sentinel && cargo test --lib db::repository_test::test_ensure_exists_for_worktree_session_does_not_write_sentinel_file_path
```

Expected: PASS.

### Task 3: Stop Leaking Sentinel Paths Through History Scan Output

**Files:**
- Modify: `packages/desktop/src-tauri/src/history/commands/scanning.rs`
- Modify: `packages/desktop/src-tauri/src/db/repository_test.rs` or add a focused scanning test in existing Rust test modules if one already exists

- [ ] **Step 1: Write a failing test proving scan output does not expose sentinel `source_path`**

Add a test that builds an indexed `SessionMetadataRow` equivalent with:

```rust
file_path = "__worktree__/ses_legacy"
worktree_path = Some("/tmp/real-worktree")
```

and expects the produced `HistoryEntry` to contain:

```rust
assert_eq!(entry.source_path, None);
assert_eq!(entry.worktree_path.as_deref(), Some("/tmp/real-worktree"));
```

- [ ] **Step 2: Run the focused scan test to verify it fails**

Run the narrowest cargo test for that test name.

Expected: FAIL because `scanning.rs` currently treats any non-empty `file_path` as `Some(source_path)`.

- [ ] **Step 3: Update `scanning.rs` to derive `source_path` from normalized semantics**

Replace:

```rust
source_path: if s.file_path.is_empty() {
    None
} else {
    Some(s.file_path)
},
```

with logic equivalent to:

```rust
source_path: if s.file_path.is_empty() || s.file_path.starts_with("__worktree__/") {
    None
} else {
    Some(s.file_path)
},
```

If practical, route this through the shared normalization helper instead of duplicating the rule.

- [ ] **Step 4: Re-run the focused scan test to verify it passes**

Run the same cargo test command.

Expected: PASS.

### Task 4: Redesign Resume Semantics Around Real Persisted Facts

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
- Modify: `packages/desktop/src-tauri/src/acp/commands/tests.rs`

- [ ] **Step 1: Write a failing resume test for placeholder metadata with valid worktree path**

Add a Rust test in `session_commands` tests that inserts metadata equivalent to:

```rust
project_path = "/Users/example/Documents/acepe"
file_path = ""
file_mtime = 0
file_size = 0
worktree_path = Some(existing_temp_dir)
```

Then call `acp_resume_session(...)` with the project path as `cwd` and assert it does **not** return `SessionNotFound` purely because the row lacks source metadata.

- [ ] **Step 2: Run the focused resume test to verify it fails**

Run the narrowest cargo test for that new test.

Expected: FAIL because `acp_resume_session` currently rejects placeholder rows before considering whether `worktree_path` is sufficient.

- [ ] **Step 3: Change resume gating to use explicit factual requirements**

In `session_commands.rs`, replace the unconditional placeholder rejection:

```rust
if let Some(row) = metadata.as_ref() {
    if row.is_placeholder() {
        return Err(SerializableAcpError::SessionNotFound { ... });
    }
}
```

with logic shaped like:

```rust
if let Some(row) = metadata.as_ref() {
    let has_resume_context = row.worktree_path.as_ref().is_some_and(|path| std::path::Path::new(path).is_dir())
        || !row.project_path.is_empty();

    if row.is_placeholder() && !has_resume_context {
        return Err(SerializableAcpError::SessionNotFound { session_id: session_id.clone() });
    }
}
```

The exact helper can vary, but the rule must be: placeholder rows are only rejected when they do not contain enough real persisted context to resume safely.

- [ ] **Step 4: Re-run the focused resume test to verify it passes**

Run the same cargo test command.

Expected: PASS.

### Task 5: Verify OpenCode Loading Still Works Without Fake Source Paths

**Files:**
- Modify if needed: `packages/desktop/src-tauri/src/history/commands/session_loading.rs`
- Modify if needed: `packages/desktop/src-tauri/src/opencode_history/parser.rs`
- Test: existing OpenCode/history Rust tests in `packages/desktop/src-tauri/src/opencode_history/test_integration.rs` or nearby modules

- [ ] **Step 1: Add a failing test only if one is needed**

If existing tests do not already cover it, add a test proving OpenCode session loading with:

```rust
source_path = None
worktree_path = Some(existing_worktree_dir)
```

still loads from disk or follows the intended fallback path without depending on a fake source path.

- [ ] **Step 2: Run the focused OpenCode/history test**

Use the narrowest cargo test command for the specific test name.

Expected: either PASS already, or FAIL in a way that shows another hidden sentinel dependency.

- [ ] **Step 3: Implement the minimal follow-up only if the test failed**

If needed, keep OpenCode logic source-less by design:

```rust
let disk_result = opencode_parser::load_session_from_disk(&session_id, source_path.as_deref()).await;
```

should continue to work when `source_path` is `None`; only title lookup may degrade gracefully.

- [ ] **Step 4: Re-run the focused OpenCode/history test**

Expected: PASS.

### Task 6: Full Targeted Verification

**Files:**
- Verify: `packages/desktop/src-tauri/src/db/repository.rs`
- Verify: `packages/desktop/src-tauri/src/history/commands/scanning.rs`
- Verify: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
- Verify: `packages/desktop/src/lib/acp/store/__tests__/workspace-sidebar-state-persistence.test.ts`
- Verify: `packages/desktop/src/lib/components/main-app-view/tests/initialization-manager.test.ts`

- [ ] **Step 1: Run all focused Rust tests for repository, scanning, and resume**

Run the narrowest combined cargo commands that cover the new tests, for example:

```bash
cargo test --lib db::repository_test::test_normalized_source_path_hides_worktree_sentinel && cargo test --lib db::repository_test::test_ensure_exists_for_worktree_session_does_not_write_sentinel_file_path && cargo test --lib acp::commands::tests::test_resume_allows_worktree_backed_placeholder_metadata
```

If the scan/OpenCode tests live elsewhere, include their exact names too.

Expected: PASS.

- [ ] **Step 2: Run TypeScript verification to catch integration regressions**

Run:

```bash
bun run i18n:generate && bun run check && bun test "src/lib/acp/store/__tests__/workspace-sidebar-state-persistence.test.ts" "src/lib/components/main-app-view/tests/initialization-manager.test.ts"
```

from `packages/desktop`.

Expected: PASS.

- [ ] **Step 3: Commit the cleanup once verification is green**

```bash
git add packages/desktop/src-tauri/src/db/repository.rs packages/desktop/src-tauri/src/db/repository_test.rs packages/desktop/src-tauri/src/history/commands/scanning.rs packages/desktop/src-tauri/src/acp/commands/session_commands.rs packages/desktop/src-tauri/src/acp/commands/tests.rs
git commit -m "refactor: remove sentinel session metadata paths"
```

If Task 5 required more files, add them explicitly to the same commit.

---

## Self-Review

- Spec coverage: user asked for the broader architecture cleanup rather than the narrow bugfix; this plan covers repository semantics, scan output, resume rules, and OpenCode verification.
- Placeholder scan: no `TODO`/`TBD` placeholders remain; each task has exact files, commands, and expected outcomes.
- Type consistency: the plan consistently refers to `source_path`/`worktree_path` in Rust and `sourcePath`/`worktreePath` only where frontend verification already uses those names.

Plan complete and saved to `docs/superpowers/plans/2026-03-27-session-metadata-placeholder-cleanup.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
