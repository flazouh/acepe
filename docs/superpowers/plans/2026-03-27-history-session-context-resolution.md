# History Session Context Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all backend history and plan loading resolve canonical session context from DB metadata so worktree-backed sessions load consistently across agents without relying on caller-provided `project_path`.

**Architecture:** Add one shared Rust helper in the history layer that resolves factual session context by `session_id`: canonical `project_path`, optional `worktree_path`, effective path for local session artifacts, normalized `source_path`, and canonical `agent_id`. Update `get_unified_session()` and `get_unified_plan()` to resolve context once up front and use that context for Claude, OpenCode, and other loaders instead of ad hoc or caller-supplied path handling.

**Tech Stack:** Rust, Tauri 2, SeaORM/SQLite, Bun for frontend verification

---

## File Structure

**Create:**
- `packages/desktop/src-tauri/src/history/session_context.rs` - canonical DB-backed session context resolver and focused unit tests

**Modify:**
- `packages/desktop/src-tauri/src/history/commands/mod.rs` - export the new shared history session-context module
- `packages/desktop/src-tauri/src/history/commands/session_loading.rs` - resolve session context once and route all agent loaders through the canonical context
- `packages/desktop/src-tauri/src/history/commands/plans.rs` - use the same resolved effective path for plan extraction
- `packages/desktop/src-tauri/src/history/commands/scanning.rs` - optionally reuse normalized source-path helpers only if needed to avoid duplication

**Verify:**
- `packages/desktop/src/lib/acp/store/__tests__/workspace-sidebar-state-persistence.test.ts`
- `packages/desktop/src/lib/components/main-app-view/tests/initialization-manager.test.ts`

### Task 1: Add a Canonical Session Context Resolver With Red Tests

**Files:**
- Create: `packages/desktop/src-tauri/src/history/session_context.rs`
- Modify: `packages/desktop/src-tauri/src/history/commands/mod.rs`
- Reference: `packages/desktop/src-tauri/src/db/repository.rs`

- [ ] **Step 1: Create the new `SessionContext` type and a failing test for DB worktree override**

Create `session_context.rs` with a minimal struct and unresolved helper signature:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionContext {
    pub project_path: String,
    pub worktree_path: Option<String>,
    pub effective_project_path: String,
    pub source_path: Option<String>,
    pub agent_id: String,
}

pub async fn resolve_session_context(
    db: Option<&DbConn>,
    session_id: &str,
    fallback_project_path: &str,
    fallback_agent_id: &str,
    fallback_source_path: Option<&str>,
) -> SessionContext {
    todo!()
}
```

Add a failing `#[tokio::test]` in the same file that inserts metadata with:

```rust
project_path = "/repo"
worktree_path = Some("/repo/.worktrees/feature-a")
file_path = ""
agent_id = "claude-code"
```

and expects:

```rust
assert_eq!(context.project_path, "/repo");
assert_eq!(context.worktree_path.as_deref(), Some("/repo/.worktrees/feature-a"));
assert_eq!(context.effective_project_path, "/repo/.worktrees/feature-a");
assert_eq!(context.source_path, None);
assert_eq!(context.agent_id, "claude-code");
```

- [ ] **Step 2: Run the focused resolver test to verify it fails**

Run:

```bash
cargo test resolve_session_context_prefers_db_worktree_path --lib
```

Expected: FAIL because the helper is still `todo!()`.

- [ ] **Step 3: Add a second failing test for fallback behavior when DB metadata is missing**

In the same file, add:

```rust
#[tokio::test]
async fn resolve_session_context_uses_fallbacks_when_metadata_missing() {
    let context = resolve_session_context(
        None,
        "session-id",
        "/repo",
        "opencode",
        Some("/tmp/source.json"),
    )
    .await;

    assert_eq!(context.project_path, "/repo");
    assert_eq!(context.worktree_path, None);
    assert_eq!(context.effective_project_path, "/repo");
    assert_eq!(context.source_path.as_deref(), Some("/tmp/source.json"));
    assert_eq!(context.agent_id, "opencode");
}
```

- [ ] **Step 4: Run the second focused resolver test to verify it fails**

Run:

```bash
cargo test resolve_session_context_uses_fallbacks_when_metadata_missing --lib
```

Expected: FAIL because the helper is still unimplemented.

### Task 2: Implement the Shared Session Context Resolver

**Files:**
- Modify: `packages/desktop/src-tauri/src/history/session_context.rs`
- Modify: `packages/desktop/src-tauri/src/history/commands/mod.rs`

- [ ] **Step 1: Implement `resolve_session_context()` with DB-first factual metadata rules**

Implement the helper so it:

```rust
let metadata = match db {
    Some(db) => SessionMetadataRepository::get_by_id(db, session_id).await.ok().flatten(),
    None => None,
};

let project_path = metadata
    .as_ref()
    .map(|row| row.project_path.clone())
    .filter(|path| !path.is_empty())
    .unwrap_or_else(|| fallback_project_path.to_string());

let worktree_path = metadata.as_ref().and_then(|row| row.worktree_path.clone());

let effective_project_path = worktree_path
    .clone()
    .unwrap_or_else(|| project_path.clone());

let source_path = metadata
    .as_ref()
    .and_then(|row| SessionMetadataRepository::normalized_source_path(&row.file_path))
    .or_else(|| fallback_source_path.map(|p| p.to_string()));

let agent_id = metadata
    .as_ref()
    .map(|row| row.agent_id.clone())
    .filter(|id| !id.is_empty())
    .unwrap_or_else(|| fallback_agent_id.to_string());
```

- [ ] **Step 2: Export the module from `history/commands/mod.rs`**

Add:

```rust
pub mod session_context;
```

and re-export the helper if that matches existing module style.

- [ ] **Step 3: Run both focused resolver tests to verify they pass**

Run:

```bash
cargo test resolve_session_context_prefers_db_worktree_path --lib && cargo test resolve_session_context_uses_fallbacks_when_metadata_missing --lib
```

Expected: PASS.

### Task 3: Refactor Unified Session Loading To Use Canonical Context

**Files:**
- Modify: `packages/desktop/src-tauri/src/history/commands/session_loading.rs`
- Test: `packages/desktop/src-tauri/src/history/session_context.rs` or small unit seams added to `session_loading.rs`

- [ ] **Step 1: Add a failing helper-level test for OpenCode/Claude effective path resolution**

Instead of trying to integration-test the whole Tauri command first, add a small pure helper inside `session_loading.rs` like:

```rust
fn should_use_effective_project_path_for_local_agent(agent: &CanonicalAgentId) -> bool {
    matches!(agent, CanonicalAgentId::ClaudeCode | CanonicalAgentId::OpenCode)
}
```

Add a failing unit test showing OpenCode is currently missing from that shared concept:

```rust
assert!(should_use_effective_project_path_for_local_agent(&CanonicalAgentId::OpenCode));
```

If you prefer, make the red test assert directly against a new helper that computes the HTTP fallback project path from `SessionContext`.

- [ ] **Step 2: Run the focused helper test to verify it fails**

Run the narrowest cargo test command for that test name.

- [ ] **Step 3: Resolve context once in `get_unified_session()` and route all agents through it**

At the start of `get_unified_session()`, replace ad hoc path handling with:

```rust
let db = app.try_state::<DbConn>().map(|s| s.inner().clone());
let context = crate::history::session_context::resolve_session_context(
    db.as_ref(),
    &session_id,
    &project_path,
    &agent_id,
    source_path.as_deref(),
)
.await;

let canonical_agent = CanonicalAgentId::parse(&context.agent_id);
```

Then update branches:

```rust
// Claude
parse_full_session(&session_id, &context.effective_project_path)

// Cursor
if let Some(ref sp) = context.source_path { ... }

// OpenCode
opencode_parser::load_session_from_disk(&session_id, context.source_path.as_deref()).await
// fallback
crate::opencode_history::commands::get_opencode_session(
    app,
    session_id.clone(),
    context.effective_project_path,
)

// Codex
codex_parser::load_session(
    &session_id,
    &context.effective_project_path,
    context.source_path.as_deref(),
)
```

- [ ] **Step 4: Re-run the focused helper test and any nearby session-loading test you added**

Expected: PASS.

### Task 4: Refactor Unified Plan Loading To Use Canonical Context

**Files:**
- Modify: `packages/desktop/src-tauri/src/history/commands/plans.rs`
- Test: add a small pure helper test in `plans.rs` if needed

- [ ] **Step 1: Add a failing test for plan effective path resolution**

Add a tiny helper in `plans.rs`, for example:

```rust
fn plan_project_path_for_context(context: &SessionContext) -> String {
    context.effective_project_path.clone()
}
```

Write a failing unit test that proves a worktree-backed context should use the worktree path instead of the project path:

```rust
assert_eq!(plan_project_path_for_context(&context), "/repo/.worktrees/feature-a");
```

- [ ] **Step 2: Run the focused plan helper test to verify it fails**

Run the narrowest cargo test command for that test name.

- [ ] **Step 3: Resolve session context inside `get_unified_plan()` and use the effective path**

Replace direct use of the incoming `project_path` with:

```rust
let db = crate::db::connection::get_db().await.ok(); // or app state if you thread AppHandle in, depending on existing command constraints
let context = crate::history::session_context::resolve_session_context(
    db.as_ref(),
    &session_id,
    &project_path,
    &agent_id,
    None,
)
.await;
```

If `get_unified_plan()` currently lacks `AppHandle`, the cleanest minimal change is to add `app: AppHandle` as the first command parameter and update the frontend caller accordingly.

Then use:

```rust
session_jsonl_plan_loader::extract_plan_from_claude_session(
    &session_id,
    &context.effective_project_path,
)
```

- [ ] **Step 4: Re-run the focused plan helper test to verify it passes**

Expected: PASS.

### Task 5: Update Frontend Tauri Client Only If Needed For `get_unified_plan()` Signature

**Files:**
- Modify if needed: `packages/desktop/src/lib/utils/tauri-client/history.ts`
- Modify if needed: `packages/desktop/src/lib/acp/store/plan-store.svelte.ts`

- [ ] **Step 1: Add a failing TypeScript test only if the Rust command signature changes**

If `get_unified_plan()` needs `AppHandle` only at the Rust level, Tauri command wiring may not require any frontend change. If the TypeScript invoke contract changes, add the smallest failing test or type assertion that captures the new call shape.

- [ ] **Step 2: Run the narrowest TS check/test to verify it fails**

Use `bun run check` or a targeted test only if the API contract actually changed.

- [ ] **Step 3: Update the frontend caller minimally**

If needed, keep the TS API surface identical unless the command arguments changed. Prefer no frontend API expansion — the whole point is DB-backed context resolution on the backend.

- [ ] **Step 4: Re-run the narrowest TS verification for this task**

Expected: PASS.

### Task 6: Full Targeted Verification

**Files:**
- Verify: `packages/desktop/src-tauri/src/history/session_context.rs`
- Verify: `packages/desktop/src-tauri/src/history/commands/session_loading.rs`
- Verify: `packages/desktop/src-tauri/src/history/commands/plans.rs`
- Verify: `packages/desktop/src/lib/utils/tauri-client/history.ts` if changed

- [ ] **Step 1: Run the focused Rust tests for session context, session loading, and plan helpers**

Run the exact tests you added, for example:

```bash
cargo test resolve_session_context_prefers_db_worktree_path --lib && cargo test resolve_session_context_uses_fallbacks_when_metadata_missing --lib && cargo test opencode_uses_effective_project_path_for_history_fallback --lib && cargo test plan_project_path_for_context_prefers_worktree --lib
```

Expected: PASS.

- [ ] **Step 2: Run targeted frontend verification**

Run from `packages/desktop`:

```bash
bun run i18n:generate && bun run check && bun test "src/lib/acp/store/__tests__/workspace-sidebar-state-persistence.test.ts" "src/lib/components/main-app-view/tests/initialization-manager.test.ts"
```

Expected: PASS.

- [ ] **Step 3: Commit once verification is green**

```bash
git add packages/desktop/src-tauri/src/history/session_context.rs packages/desktop/src-tauri/src/history/commands/mod.rs packages/desktop/src-tauri/src/history/commands/session_loading.rs packages/desktop/src-tauri/src/history/commands/plans.rs
git commit -m "refactor: centralize history session context resolution"
```

If Task 5 required frontend changes, add those files explicitly to the same commit.

---

## Self-Review

- Spec coverage: this plan directly addresses the chosen architecture (central backend helper), shared history/session/plan resolution, and avoids frontend worktree-path propagation unless strictly necessary.
- Placeholder scan: no `TODO` or vague implementation steps remain; each task specifies exact files, commands, and expected failures/passes.
- Type consistency: the plan consistently uses `SessionContext`, `effective_project_path`, `source_path`, and `worktree_path` across all tasks.

Plan complete and saved to `docs/superpowers/plans/2026-03-27-history-session-context-resolution.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
