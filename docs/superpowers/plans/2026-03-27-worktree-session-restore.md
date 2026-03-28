# Worktree Session Restore on App Restart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve worktree session identity across app restarts so a session created in a git worktree restores and resumes with the correct `worktreePath` instead of falling back to the main repository path.

**Architecture:** The backend resume safety net already works: Rust reads persisted `worktree_path` from SQLite and overrides the frontend-provided cwd when the worktree still exists. The fix is entirely in the frontend restore path. Persist `sourcePath` and `worktreePath` in workspace state, carry them through restored `Panel` objects, and thread `worktreePath` into the placeholder session hydration path used by `earlyPreloadPanelSessions()`.

**Tech Stack:** Tauri 2, SvelteKit 2, Svelte 5, TypeScript, neverthrow, bun:test, Vitest

**Constraints:**
- Preserve the Rust backend fallback exactly as-is; no Rust code changes
- Do not change session identity semantics
- The previously suspected `selectSession()` argument-order bug is not real; do not modify `session-handler.ts` for this issue

---

## File Structure

**Persisted workspace and panel typing**
- Modify: `packages/desktop/src/lib/acp/store/types.ts`
  - Add optional `sourcePath` and `worktreePath` to `Panel`
  - Add optional `sourcePath` and `worktreePath` to `PersistedPanelState`

**Workspace persistence and restore**
- Modify: `packages/desktop/src/lib/acp/store/workspace-store.svelte.ts`
  - Persist `sourcePath` and `worktreePath` into saved panel state
  - Restore those fields onto rebuilt `Panel` objects
  - Check whether persisted workspace versioning needs adjustment for additive optional fields

**Session hydration path**
- Modify: `packages/desktop/src/lib/components/main-app-view/logic/managers/initialization-manager.ts`
  - Stop hardcoding `sourcePath` to `undefined`
  - Pass restored `worktreePath` into `loadSessionById()`
- Modify: `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
  - Add optional `worktreePath` parameter to `loadSessionById()`
- Modify: `packages/desktop/src/lib/acp/store/services/session-repository.ts`
  - Add optional `worktreePath` parameter to `loadSessionById()`
  - Include `worktreePath` in placeholder `SessionCold`

**Tests**
- Modify: `packages/desktop/src/lib/acp/store/__tests__/workspace-sidebar-state-persistence.test.ts`
  - Verify `sourcePath` and `worktreePath` survive workspace persist/restore
- Modify: `packages/desktop/src/lib/components/main-app-view/tests/initialization-manager.test.ts`
  - Verify restored worktree metadata is passed through preload hydration
- Verify only: `packages/desktop/src/lib/acp/store/services/session-connection-manager.test.ts`
  - Existing Vitest regression coverage for resume behavior remains green

---

### Task 1: Add failing tests for persisted worktree restore

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/__tests__/workspace-sidebar-state-persistence.test.ts`
- Modify: `packages/desktop/src/lib/components/main-app-view/tests/initialization-manager.test.ts`

- [ ] **Step 1: Write the failing workspace persistence test**
- [ ] **Step 2: Write the failing preload hydration test**
- [ ] **Step 3: Run the targeted tests and confirm they fail**
- [ ] **Step 4: Commit the failing tests**

### Task 2: Persist worktree metadata in restored panels

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/types.ts`
- Modify: `packages/desktop/src/lib/acp/store/workspace-store.svelte.ts`

- [ ] **Step 1: Extend the panel-related types**
- [ ] **Step 2: Persist both fields from existing session state**
- [ ] **Step 3: Restore both fields onto rebuilt Panel objects**
- [ ] **Step 4: Check persisted workspace version behavior**
- [ ] **Step 5: Run the persistence test and confirm it passes**
- [ ] **Step 6: Commit**

### Task 3: Thread restored worktree metadata through early session hydration

**Files:**
- Modify: `packages/desktop/src/lib/components/main-app-view/logic/managers/initialization-manager.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/services/session-repository.ts`

- [ ] **Step 1: Add `worktreePath` to the store-level `loadSessionById()` API**
- [ ] **Step 2: Add `worktreePath` to the repository-level `loadSessionById()` API**
- [ ] **Step 3: Pass restored metadata from early preload**
- [ ] **Step 4: Run the targeted preload test and confirm it passes**
- [ ] **Step 5: Run a focused typecheck**
- [ ] **Step 6: Commit**

### Task 4: Verify unchanged resume behavior and regression coverage

**Files:**
- Verify only: `packages/desktop/src/lib/acp/store/services/session-connection-manager.test.ts`
- Verify only: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`

- [ ] **Step 1: Verify the Rust backend fallback remains untouched**
- [ ] **Step 2: Run existing frontend resume regression coverage**
- [ ] **Step 3: Run the required TypeScript check**
- [ ] **Step 4: Commit if any regression-only test updates were needed**

### Task 5: Final verification and manual runtime proof

- [ ] **Step 1: Run the affected frontend test set**
- [ ] **Step 2: Run the required repository check**
- [ ] **Step 3: Manually verify the restart flow in a running dev app**
- [ ] **Step 4: Final commit**
