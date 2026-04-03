---
title: Keep kanban threads backed by real session panels
date: 2026-04-02
category: logic-errors
module: desktop kanban panel orchestration
problem_type: logic_error
component: assistant
symptoms:
  - Active sessions disappeared from kanban unless the user had already opened a normal panel
  - Clicking a kanban card forced the app into single-panel mode instead of showing the real thread inline
  - Dismissing a background-created live session caused it to immediately reappear on the next sync pass
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - panel-store
  - workspace-persistence
  - attention-queue
tags:
  - kanban
  - panel-store
  - session-sync
  - svelte
  - workspace-persistence
---

# Keep kanban threads backed by real session panels

## Problem
Kanban and the normal panel layout had drifted into two different models of session state. The queue/kanban view projected sessions independently, while the real thread UI only existed for explicitly opened panels, so active threads could be missing from kanban and opening a card had to fall back to a layout switch.

## Symptoms
- Live sessions with pending questions, permissions, or active work were absent from kanban until a user opened them elsewhere.
- Clicking a kanban card called `panelStore.setViewMode("single")` and navigated away from kanban.
- Closing an automatically surfaced live thread panel caused it to rematerialize immediately because the sync layer had no dismissal provenance.
- `finished` and `idle` collapsed together, so unseen completion was not distinguishable from a merely idle restored thread.

## What Didn't Work
- Treating kanban as a pure queue projection. That preserved the old missing-panel problem because kanban still had no stable backing panel to open.
- Reusing explicit `openSession(...)` for background sync. That stole focus and changed layout, which violated the requirement that active sessions appear quietly in the background.
- Relying on a simple “panel exists / panel does not exist” check. Dismissed live panels immediately reappeared because the sync loop had no signal-level suppression.

## Solution
Make panel state the source of truth for live threads and let kanban project from those real panels.

In `packages/desktop/src/lib/acp/store/panel-store.svelte.ts`, add background materialization with provenance and suppression:

```ts
materializeSessionPanel(sessionId: string, width: number): Panel | null {
  const existing = this.panelBySessionId.get(sessionId);
  if (existing) {
    return existing;
  }

  const panel = this.createSessionPanel(sessionId, width, true);
  this.panels = this.panels.concat(panel);
  this.onPersist();
  return panel;
}
```

```ts
if (panel.kind === "agent" && panel.autoCreated === true && panel.sessionId) {
  const signal = this.latestLiveSessionSignals.get(panel.sessionId);
  if (signal !== undefined) {
    this.suppressedAutoSessionSignals.set(panel.sessionId, signal);
  }
}
```

Persist `autoCreated` through workspace restore in `packages/desktop/src/lib/acp/store/types.ts` and `packages/desktop/src/lib/acp/store/workspace-store.svelte.ts` so background-created panels keep the correct lifecycle after restart.

Add `packages/desktop/src/lib/components/main-app-view/logic/live-session-panel-sync.ts` and run it from `packages/desktop/src/lib/components/main-app-view/components/app-queue-row.svelte` so active sessions quietly gain backing panels without stealing focus:

```ts
syncLiveSessionPanels(
  liveSessionSyncInputs,
  {
    hasPanel(sessionId: string): boolean {
      return panelStore.isSessionOpen(sessionId);
    },
    syncSuppression(sessionId: string, signal: string): boolean {
      return panelStore.syncAutoSessionSuppression(sessionId, signal);
    },
    materialize(sessionId: string, width: number): void {
      panelStore.materializeSessionPanel(sessionId, width);
    },
  },
  DEFAULT_PANEL_WIDTH
);
```

Build kanban from panel-backed thread sources in `packages/desktop/src/lib/components/main-app-view/components/content/kanban-view.svelte` using `buildThreadBoard(...)`, and open the real `AgentPanel` in `kanban-thread-dialog.svelte` instead of leaving kanban.

## Why This Works
The bug was not just a visual kanban issue; it was a split-brain state model. Once every live session is guaranteed to have a real backing panel, kanban no longer needs to invent a second thread model. The `autoCreated` flag preserves the distinction between background-surfaced panels and user-owned panels, while suppression keyed by the live-session signal prevents immediate rematerialization after dismissal. Separating `finished` from `idle` keeps unseen completion semantics intact.

## Prevention
- When a new UI surface needs to open a thread, make it reference a real panel rather than building a parallel session container.
- Preserve provenance for background-created state. A boolean like `autoCreated` is cheap, but it prevents incorrect close, reconnect, and persistence behavior.
- Suppression for auto-surfaced items should be keyed to the underlying live signal, not just the session ID, so genuine state changes can resurface the panel.
- Keep `finished` and `idle` as separate board states whenever unseen completion is part of the UX contract.
- Regression coverage that caught this fix:
  - `packages/desktop/src/lib/acp/store/__tests__/panel-store-background-open.vitest.ts`
  - `packages/desktop/src/lib/components/main-app-view/tests/live-session-panel-sync.test.ts`
  - `packages/desktop/src/lib/components/main-app-view/components/content/kanban-view.svelte.vitest.ts`

## Related Issues
- Related area: `docs/solutions/logic-errors/worktree-session-restore-2026-03-27.md` documents another case where session identity had to survive restore boundaries.
- No prior solution doc covered panel-backed kanban synchronization or auto-created panel suppression.