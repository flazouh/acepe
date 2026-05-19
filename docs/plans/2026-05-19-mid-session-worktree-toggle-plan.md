---
date: 2026-05-19
topic: mid-session-worktree-toggle
---

# Mid-session worktree toggle confirmation

## Goal

When a user turns on the worktree toggle under an already-working agent, Acepe should not silently change where future work lands. It should ask whether to continue future changes in a new worktree or move this session's existing changes into that new worktree first.

This keeps worktree isolation explicit and prevents accidental loss, duplication, or surprise movement of user changes.

## Product behavior

### Entry point

The existing worktree pill under the composer remains the entry point. Behavior depends on session state:

- **Before first send / no session work yet:** keep current behavior. Turning Worktree on just marks the pending launch.
- **Active session without an attached worktree:** turning Worktree on opens a confirmation dialog.
- **Session already in a worktree:** turning Worktree off keeps current "return to project root / discard prepared launch" behavior, with existing dirty-worktree close checks preserved.

### Dialog copy

Title: `Start using a worktree?`

Body:

`Future agent changes can go into a fresh worktree. Existing changes from this session can either stay where they are, or Acepe can move the session-owned changes into the new worktree first.`

Actions:

1. `Continue in new worktree`
   - Creates a new worktree.
   - Updates the current session to use that worktree for future sends.
   - Does not move existing changes from the current checkout.
   - Shows helper text: `Existing changes stay in the current checkout. Future turns use the new worktree.`

2. `Move session changes`
   - Creates a new worktree.
   - Moves only changes Acepe can prove are fully owned by this session.
   - Updates the current session to use that worktree.
   - Shows a file count with an expandable, reviewable file list before execution.
   - Runs as an all-or-nothing transfer: if any session file cannot be moved safely, the move action is disabled before confirmation or the backend leaves the source checkout untouched.

3. `Cancel`
   - Leaves the session and toggle unchanged.

### Availability rules

`Move session changes` should only be enabled when Acepe can safely identify session-owned changed files and verify they can be transferred without clobbering user work.

Disable it with an explanation when:

- There are no session-attributed modified files.
- A session-attributed file also has unrelated user edits that Acepe cannot prove belong to this session.
- The source checkout has staged changes for one of the files.
- A session-attributed file is deleted. Deleted-file transfer is out of scope for v1 because restoring the source state safely needs separate semantics.
- Backend preflight finds a target conflict after creating the prepared worktree.
- Any file path is outside the project root or resolves through unsafe path traversal.
- Any session-attributed file is a symlink or resolves through a symlink path.

The safe default is always `Continue in new worktree`.

If unrelated dirty files exist outside the session-attributed file set, they do not block `Move session changes`. They remain in the current checkout, and the dialog shows: `Other local changes will stay in the current checkout.`

## Technical approach

### 1. Separate worktree toggle intent from immediate mutation

Current code path:

- `WorktreeTogglePill` calls `handlePreSessionWorktreeYes()`.
- `handlePreSessionWorktreeYes()` immediately calls `panelStore.setPendingWorktreeEnabled(panelId, true)`.
- First-send creation later flows through `AgentInput` and `prepareWorktreePathForPendingSend()`.

Change:

- Introduce a small controller-level state in `agent-panel.svelte`:
  - `worktreeSwitchDialogOpen`
  - `worktreeSwitchBusy`
  - `worktreeSwitchError`
  - `worktreeSwitchPreview`
- Update the toggle handler:
  - If `sessionId === null` or the session has no completed agent/tool work entries, keep current pending behavior.
  - If `sessionId !== null` and `effectiveActiveWorktreePath === null`, open the dialog instead of setting pending directly.
  - If the session already has a worktree, keep existing off/discard behavior.

This avoids overloading `pendingWorktreeEnabled` with both "future first send" and "mid-session switch" semantics.

### 2. Add a presentational dialog in `@acepe/ui`

Create a reusable dumb component in `packages/ui/src/components/agent-panel/`:

- `agent-panel-worktree-switch-dialog.svelte`
- Props:
  - `open`
  - `sessionFileCount`
  - `sessionFiles`
  - `moveAvailable`
  - `moveUnavailableReason`
  - `otherLocalChangesMessage`
  - `busy`
  - `errorMessage`
  - labels/copy
  - callbacks: `onContinue`, `onMove`, `onCancel`

Desktop owns all state and Tauri calls. Shared UI only renders copy, actions, loading, disabled state, and the optional file list.

Accessibility and interaction requirements:

- Use a modal dialog with focus trapped while open.
- Move initial focus to the primary safe action, `Continue in new worktree`.
- Disable both action buttons while `busy` is true and keep `Cancel` available only when no irreversible backend step has started.
- Announce `errorMessage`, `moveUnavailableReason`, and transfer status with an accessible live region.
- Render the file list as semantic list content with each path readable by screen readers.

### 3. Create a mid-session worktree service

Add a desktop service:

- `packages/desktop/src/lib/acp/components/agent-panel/services/mid-session-worktree-switch-service.ts`

Responsibilities:

- Create a prepared worktree launch using the existing Tauri command:
  - `tauriClient.git.prepareWorktreeSessionLaunch(projectPath, agentId)`
- Run setup commands using existing worktree setup orchestration.
- Return:
  - `PreparedWorktreeLaunch`
  - target worktree path
  - optional transfer report

Use `ResultAsync`/`neverthrow` style. Do not add `try/catch`.

### 4. Continue-only flow

Implementation steps:

1. User clicks Worktree on mid-session.
2. Dialog opens.
3. User chooses `Continue in new worktree`.
4. Service creates prepared worktree.
5. Run existing worktree setup orchestration for the prepared launch.
6. Rebind the active session/provider context to the prepared worktree so future provider tool calls, terminal launches, permission checks, and git actions execute from the worktree path rather than only updating UI-derived paths.
7. `handlePreparedWorktreeLaunch()` stores prepared launch on the panel.
8. `handleWorktreeCreated()` / equivalent session update sets:
   - `activeWorktreePath`
   - `activeWorktreeOwnerProjectPath`
   - `sessionStore.updateSession(sessionId, { worktreeDeleted: false, worktreePath })`
9. Future sends use `effectiveActiveWorktreePath` / `effectiveProjectPath`.

Durable success boundary:

- Persist `session.worktreePath` only after worktree creation, setup, and provider/session rebind all succeed.
- If any step fails before persistence, discard the prepared launch, clear optimistic panel worktree state, leave the durable session unchanged, and show the error in the dialog.
- If persistence fails after rebind succeeds, surface a blocking recovery error and do not claim the session has moved until the durable session record converges.

Acceptance criteria:

- The existing transcript remains attached to the same session.
- Future provider tool/file/terminal/git actions resolve against the new worktree, verified by actual execution context rather than UI state alone.
- Existing dirty files in the original checkout remain untouched.

### 5. Move-session-changes flow

This is the risky path and should be implemented with a dedicated backend command rather than shelling out from the frontend.

Add a Tauri git command:

- `prepare_and_transfer_session_changes_to_worktree`

Inputs:

- `projectPath`
- `agentId`
- `sessionId`

Output:

- `PreparedWorktreeLaunch`
- `transferredFiles: string[]`
- `blockedFiles: { path: string; reason: string }[]` on preflight failure

Backend algorithm:

1. Derive session-attributed candidate paths on the backend from persisted/session transcript data. Do not trust a frontend-supplied `sessionEditedFiles` list as authority.
   - For v1, a path is transferable only when the backend can reconstruct the complete session-owned file delta from edit tool arguments, including the original baseline and final expected content.
   - If the transcript only proves that a file path was touched, but not that the whole current file delta belongs to the session, the path blocks `Move session changes`.
2. Validate all candidate file paths:
   - Normalize relative paths.
   - Reject absolute paths, `..` traversal, path separators that escape the project root, symlink files, and paths that resolve through symlink directories.
   - Canonicalize existing source and target parent paths and verify they remain under `projectPath` and the prepared worktree root.
3. Preflight source status for every candidate before writing:
   - Reject staged files.
   - Reject deleted files in v1.
   - Reject unsupported statuses such as renames, type changes, submodules, ignored candidates, and nested untracked directories.
   - Reject candidates whose current file delta cannot be proven to equal session-owned edits.
4. Create a prepared worktree from the current HEAD.
5. Run target preflight after worktree creation:
   - Reject if any target path already has tracked, untracked, ignored, or filesystem content that would be clobbered.
   - If target preflight fails, remove the prepared worktree and leave the source checkout untouched.
6. For each session-attributed file:
   - Resolve source path in `projectPath`.
   - Resolve target path in new worktree.
   - Copy regular modified/untracked file contents to target.
7. Verify target git status contains the transferred paths and, for regular files, verify copied bytes match the source snapshot.
8. Remove the moved paths from the source checkout only after successful target write and verification:
   - Modified tracked file: restore source from HEAD.
   - Untracked file: delete source file.
9. Verify the source checkout no longer has the moved file changes.
10. Rebind the active session/provider context to the prepared worktree.
11. Persist `session.worktreePath`.
12. Return a detailed report.

Important safety rule:

Do not move partial hunks. If a file has both session edits and user edits, Acepe cannot safely split them with current data. In that case the whole move is unavailable until Acepe can prove ownership or the user chooses `Continue in new worktree`.

Rollback and failure behavior:

- The command is all-or-nothing for v1.
- If any preflight or target-write step fails before source cleanup, remove the prepared worktree and leave the source checkout untouched.
- If source cleanup fails after target verification, return a blocking recovery error with the exact files and do not persist `session.worktreePath`.
- Never return a success-shaped partial transfer. `blockedFiles` only appears in failure/preflight responses.
- Execute git operations through argv-style command invocation, never through shell-interpolated strings.

### 6. Session-owned file detection

Use existing modified-files aggregation:

- `aggregateFileEdits(sessionEntries)`
- Existing `modifiedFilesState`

Then cross-check against git status from source checkout.

Plan:

- Add a small pure helper:
  - `deriveWorktreeSwitchMovePreview({ modifiedFilesState, gitStatus })`
- Output:
  - `moveAvailable`
  - `files`
  - `unavailableReason`
  - `unsafeFiles`
  - `otherDirtyFiles`

Initial scope:

- Treat files from edit tool calls as candidate session-owned files.
- Only allow move when every candidate path is dirty, unstaged, not deleted, not a symlink, and ownership can be proven from a reconstructable original-to-final delta.
- If there are extra dirty paths not attributed to the session, allow continue-only but show: `Other local changes will stay in the current checkout.`
- Source-only preview does not claim target safety. Target conflicts are execution-time backend preflight failures because the prepared worktree does not exist until execution.

V1 preview matrix:

| Source status | Preview result |
|---------------|----------------|
| Modified tracked file, unstaged, ownership proven | Movable |
| Untracked regular file, ownership proven | Movable |
| Staged or partially staged file | Move unavailable |
| Deleted tracked file | Move unavailable in v1 |
| Renamed/typechanged/submodule path | Move unavailable in v1 |
| Symlink file or symlink-resolving path | Move unavailable in v1 |
| Candidate with unproven mixed user edits | Move unavailable |
| Dirty file not attributed to session | Not moved; does not block move |

### 7. Canonical state boundary

This touches session worktree path and active working directory. Before implementation, run the GOD architecture check.

Expected rule:

- The durable session `worktreePath` remains the canonical session-level fact once a worktree is attached.
- Panel-local `activeWorktreePath` can remain an optimistic/transient bridge during creation, but must converge to `sessionStore.updateSession(... worktreePath)` after success.
- Do not introduce a second durable worktree authority in panel hot state.

## Test plan

### Unit tests

1. `worktree-switch-preview.test.ts`
   - Candidate files from `modifiedFilesState` become movable.
   - Extra dirty user files do not block continue-only or a safe all-or-nothing move of proven session files.
   - Staged files disable move.
   - Path traversal candidates are rejected.
   - Deleted-file candidates disable move in v1.
   - Candidate files without reconstructable ownership proof disable move.
   - No candidate files disables move.

2. `mid-session-worktree-switch-service.test.ts`
   - Continue-only creates a prepared launch and returns target path.
   - Failure returns an explicit error and does not update session state.

3. Rust git command tests
   - Modified tracked file moves to target and restores source.
   - Untracked file moves to target and deletes source.
   - Staged file is rejected.
   - Deleted tracked file disables move in v1.
   - Unsafe path is rejected.
   - Symlink files and symlink escape paths are rejected.
   - Conflicting target content is rejected.
   - Target-write failure leaves source and durable session state unchanged.
   - Source-restore/delete failure returns a blocking recovery error and does not persist `session.worktreePath`.
   - Nested untracked directories and unsupported statuses are rejected.
   - Binary regular files move by byte equality, not text decoding.

### Component tests

1. `agent-panel-worktree-switch-dialog.svelte.vitest.ts`
   - Renders both options when move is available.
   - Disables move with reason.
   - Calls `onContinue`, `onMove`, `onCancel`.

2. Agent panel toggle flow test
   - Mid-session Worktree click opens dialog instead of immediately setting pending.
   - Continue action updates session worktree path.
   - Cancel leaves toggle state unchanged.

### Manual verification

- Start a project-root session.
- Make an agent edit.
- Turn on Worktree from the footer pill.
- Choose `Continue in new worktree`; verify future terminal/git context points at the worktree and source dirty files remain.
- Repeat and choose `Move session changes`; verify session files appear dirty in target worktree, source checkout is clean for moved files, unrelated source dirty files remain, and deleted-file candidates disable move.

## Implementation order

1. Add pure preview helper and tests.
2. Add continue-only mid-session worktree service and provider/session rebind tests.
3. Add shared UI dialog and component tests for continue/cancel plus disabled move states.
4. Wire the mid-session dialog for continue-only and cancel.
5. Add backend transfer command with Rust tests.
6. Wire `Move session changes` behind the preview/capability gate.
7. Run:
   - `cd packages/desktop && bun run check`
   - targeted Bun/Vitest tests
   - relevant Rust git tests
   - `cd packages/desktop/src-tauri && cargo clippy` if Rust command changes require it.

## Resolved scope decisions

1. `Move session changes` is all-or-nothing in v1.
2. Deleted files are not transferred in v1. A deleted session-attributed file disables `Move session changes` with a clear reason.
3. The dialog shows a count plus an expandable file list.
