---
title: Reactive state in async callbacks and MVC boundaries in Svelte 5
date: 2026-04-15
category: best-practices
module: agent-panel-review
problem_type: best_practice
component: frontend_stimulus
severity: medium
applies_when:
  - Svelte 5 reactive values ($derived, $state) used inside async callbacks (Tauri IPC, fetch, timers)
  - Restore/resume flows where saved selection must survive recomputation
  - Navigation logic based on status labels rather than canonical state
  - Shared UI components computing business policy instead of receiving resolved props
tags:
  - svelte-5
  - reactive-state
  - async-race-condition
  - mvc-separation
  - tauri-ipc
  - review-panel
  - agent-panel
  - state-management
---

# Reactive state in async callbacks and MVC boundaries in Svelte 5

## Context

A review-panel redesign (PR #120) introduced a two-pane ReviewWorkspace that replaced the old side-pane review. The ce:review process surfaced 4 findings — a P1 race condition and three P2 state/architecture issues — all rooted in the same family of reactive-UI pitfalls. These patterns recur whenever Svelte 5 reactive values cross async boundaries, when restore flows compete with recomputation, when navigation relies on display labels instead of source-of-truth state, or when UI components absorb controller-layer policy.

## Guidance

### 1. Capture reactive values before async boundaries

Svelte 5 `$derived` and `$state` values are live references. Inside an async callback (Tauri IPC, `fetch`, `setTimeout`), the value may have changed by the time the callback executes.

**Rule:** Snapshot any reactive value into a local `const` before the async call.

```typescript
function handleHunkReject(hunkIndex: number, revertedContent: string): void {
  if (!selectedFile) return;

  // Capture before async boundary
  const capturedFile = selectedFile;
  const capturedFileIndex = selectedFileIndex;

  tauriClient.fs.writeTextFile(capturedFile.filePath, revertedContent, sessionId).match(
    () => {
      // Safe: capturedFile is the file that was selected when the user clicked
      recordResolvedAction(capturedFile, hunkIndex, "reject");
      maybeAutoAdvanceAfterResolve(nextState, capturedFileIndex);
    },
    (error) => toast.error(m.hunk_revert_failed({ error: error.message }))
  );
}
```

### 2. Pass restored state explicitly — don't let recomputation overwrite it

When a restore/resume flow retrieves a saved value (e.g., `consumePendingReviewRestore`), pass it through the API explicitly. If the function also has a default-computation path, make the restored value an optional parameter that takes precedence.

```typescript
function handleEnterReviewMode(filesState: ModifiedFilesState, restoredFileIndex?: number): void {
  const fileIndex = restoredFileIndex ?? resolveReviewWorkspaceEntryIndex(filesState);
  onEnterReviewMode?.(filesState, fileIndex);
}
```

### 3. Navigate by canonical state, not display labels

Status labels like `"accepted"`, `"partial"`, `"denied"` are summaries for rendering. Navigation logic (auto-advance, next/prev) should check the source-of-truth fields they summarize.

A file with all hunks rejected is `"partial"` (not `"accepted"`) but has 0 pending hunks. Advancing to it based on status string means landing on a file with nothing to review.

```typescript
// Instead of checking status !== "accepted", check actual pending hunks
for (let i = resolvedIndex + 1; i < files.length; i += 1) {
  const state = fileStatuses.get(getReviewFileRevisionKey(files[i]));
  if (!state || state.pendingHunks > 0) {
    onFileIndexChange(i);
    return;
  }
}
```

### 4. Keep selection policy in the controller, not the UI component

Per the Agent Panel MVC separation rule: presentational components in `@acepe/ui` receive resolved data as props. They do not compute which item should be selected, what the default is, or how to handle invalid indices. That logic belongs in the desktop controller.

**Before (wrong):** UI component imports `resolveReviewWorkspaceSelectedIndex`, computes `effectiveSelectedIndex` internally, and calls `onFileSelect` on mount to auto-correct.

**After (correct):** UI component accepts `selectedFileIndex` prop, renders it. The desktop controller resolves the index before passing it down.

## Why This Matters

- **Race conditions corrupt user data.** The reject race could write file contents and update review state for the wrong file — silent data corruption with no error signal.
- **Lost restored state frustrates users.** Tab-switching always jumping back to file 1 instead of preserving position breaks flow.
- **Status-label navigation creates dead ends.** Landing on a fully-resolved file with nothing to do forces the user to manually advance.
- **Policy in UI components blocks reuse.** Components with baked-in selection logic can't be rendered from `packages/website` with mock data, and they resist testing without the full store chain.

## When to Apply

- Any Svelte 5 component using `$derived` or `$state` values inside `.then()`, `.match()`, `setTimeout`, event listeners, or Tauri IPC callbacks
- Restore/resume flows that retrieve saved state from a store (panel restore, session restore, undo/redo)
- Auto-advance, next/prev, or skip logic that decides which item to navigate to based on item state
- Any new presentational component in `@acepe/ui` — verify it receives resolved data, not policy functions

## Examples

### Async capture — before/after

```typescript
// ❌ Before: reactive selectedFile used in async callback
writeTextFile(selectedFile.filePath, ...).match(() => {
  recordResolvedAction(selectedFile, ...); // selectedFile may have changed!
});

// ✅ After: captured before async boundary
const capturedFile = selectedFile;
writeTextFile(capturedFile.filePath, ...).match(() => {
  recordResolvedAction(capturedFile, ...); // always the right file
});
```

### Restore flow — before/after

```typescript
// ❌ Before: restored index ignored
const pendingFileIndex = consumePendingReviewRestore(panelId);
handleEnterReviewMode(modifiedFilesState); // always recomputes default

// ✅ After: restored index threaded through
handleEnterReviewMode(modifiedFilesState, pendingFileIndex);
```

### Navigation — before/after

```typescript
// ❌ Before: status string — "partial" includes fully-rejected files
nextUnacceptedFileIndex(selectedFileIndex, nextFileStatuses);

// ✅ After: canonical state — check actual pending hunks
if (!state || state.pendingHunks > 0) onFileIndexChange(i);
```

## Related

- [Provider-owned policy, not UI projections](../best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md) — same principle applied to provider identity and model selection
- [Operation-interaction association](../logic-errors/operation-interaction-association-2026-04-07.md) — UI recomputing state independently instead of using a canonical owner
- [Kanban live session panel sync](../logic-errors/kanban-live-session-panel-sync-2026-04-02.md) — status/UI mismatch and split-brain UI models
- [Worktree session restore](../logic-errors/worktree-session-restore-2026-03-27.md) — restored state overwritten by later recomputation
- PR #120 — Review panel redesign (implementation)
- PR #124 — Review findings fix (this learning)
