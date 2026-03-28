---
title: Restore worktree session identity on app restart
date: 2026-03-27
category: logic-errors
module: acp workspace restore
problem_type: logic_error
component: tooling
symptoms:
  - Sessions created in git worktrees reconnect as main-repo sessions after app restart
  - Early preload restores session content without the saved worktree path
  - Placeholder session state loses worktree identity until a later sidebar scan catches up
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - development_workflow
tags:
  - worktree
  - workspace-persistence
  - session-restore
  - tauri
  - svelte
---

# Restore worktree session identity on app restart

## Problem
Worktree-backed sessions restored correctly when first created, but after restarting the app they were reconstructed as main-repo sessions. The frontend restore path persisted only `projectPath` and `agentId`, so the early reconnect flow dropped the session's worktree identity before the backend resume safety net could help.

## Symptoms
- Restarting the app reconnects a worktree session with main-repo context instead of the worktree path.
- `earlyPreloadPanelSessions()` calls `loadSessionById()` without persisted `sourcePath` or `worktreePath`.
- Placeholder `SessionCold` state is created without `worktreePath`, so the session looks like a root repo session until scan merge catches up.

## What Didn't Work
- Investigating `session-handler.ts` as an argument-order bug. That path was already correct and unrelated to restart restore.
- Relying on the sidebar scan to repair metadata later. The scan runs after early preload, so reconnect already happens with incomplete context.
- Changing backend resume behavior. Rust already reads `worktree_path` from SQLite and overrides cwd safely; the bug was entirely in frontend persistence and restore.

## Solution
Persist the missing restore metadata and thread it through the early preload path.

In `packages/desktop/src/lib/acp/store/types.ts`, extend panel persistence types with optional restore metadata:

```ts
readonly sourcePath?: string;
readonly worktreePath?: string;
```

In `packages/desktop/src/lib/acp/store/workspace-store.svelte.ts`, save and restore those fields for agent panels:

```ts
sourcePath: sessionMetadata?.sourcePath ? sessionMetadata.sourcePath : undefined,
worktreePath: sessionIdentity?.worktreePath ? sessionIdentity.worktreePath : undefined,
```

```ts
sourcePath: p.sourcePath ?? null,
worktreePath: p.worktreePath ?? null,
```

In `packages/desktop/src/lib/components/main-app-view/logic/managers/initialization-manager.ts`, stop hardcoding `sourcePath` to `undefined` and pass both restored fields into preload:

```ts
const sourcePath = panel.sourcePath ?? session?.sourcePath;
const worktreePath = panel.worktreePath ?? session?.worktreePath;

this.sessionStore.loadSessionById(
  sessionId,
  projectPath,
  agentId,
  sourcePath ?? undefined,
  worktreePath ?? undefined,
  sessionTitle ?? undefined
)
```

In `packages/desktop/src/lib/acp/store/session-store.svelte.ts` and `packages/desktop/src/lib/acp/store/services/session-repository.ts`, add the optional `worktreePath` parameter and include it in placeholder `SessionCold` creation so the restored session keeps its identity before scan merge.

## Why This Works
The bug was a frontend serialization gap, not a backend resume bug. Once `sourcePath` and `worktreePath` survive workspace persist/restore and are passed into early preload, the placeholder session and reconnect flow carry the same identity the session had before restart. That removes the race where a later scan had to repair missing worktree metadata after reconnect had already started.

## Prevention
- Add persistence round-trip tests whenever panel/session restore gains new identity fields.
- Cover early preload with explicit argument assertions so restore metadata cannot silently regress.
- Keep backend resume fallbacks and frontend restore context aligned, but fix missing identity at the earliest restore boundary instead of relying on later reconciliation.
- Targeted regression tests that caught this fix:
  - `packages/desktop/src/lib/acp/store/__tests__/workspace-sidebar-state-persistence.test.ts`
  - `packages/desktop/src/lib/components/main-app-view/tests/initialization-manager.test.ts`
  - `packages/desktop/src/lib/acp/store/__tests__/workspace-panels-persistence.test.ts`

## Related Issues
- No related solution doc existed in `docs/solutions/` when this fix was documented.
- Backend fallback intentionally remains unchanged in `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`.
