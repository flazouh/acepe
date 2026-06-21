# New Chat Panel Options Surface — Requirements

**Date:** 2026-06-20
**Status:** Ready for planning
**Scope tier:** Deep — feature (inherits existing product shape)

## Problem

Creating a new chat panel today exposes its setup controls inconsistently. The
agent-panel pre-session composer shows an inline footer row (`AgentSelector` +
`ProjectSelector` + `PreSessionWorktreeCard`) at
`packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte:1644`,
while **Model** and **Autonomous** are surfaced elsewhere (model in the trailing
controls, autonomous in the attach menu). There is no single, legible place to
see and set the parameters a new thread will start with.

## Goal

When a **new chat panel** is created (the agent-panel pre-session composer,
before any session exists), present a stacked, labeled surface directly above
the composer text input that consolidates the five thread-start parameters.
Typing a prompt and sending starts the thread with whatever those controls are
set to — there is no separate Start/confirm action.

## Users & Value

- **User:** an Acepe developer spinning up a new agent thread in a chat panel.
- **Value:** all thread-start parameters are visible and settable in one place
  before the first message, instead of being scattered across the footer row,
  trailing controls, and attach menu.

## The Surface

A stacked vertical list of labeled rows above the composer input:

```
Project    [ acepe   ▾ ]
Agent      [ claude  ▾ ]
Model      [ opus    ▾ ]
Worktree   [ off  ●  ]
Autonomous [ off  ●  ]
┌─────────────────────┐
│ Type a prompt…    →  │
└─────────────────────┘
```

### Rows

| Row | Control | Notes |
|-----|---------|-------|
| Project | dropdown | Reuse `ProjectSelector` behavior. |
| Agent | dropdown | Reuse `AgentSelector` behavior. |
| Model | dropdown | Newly surfaced in pre-session context (see Risk below). |
| Worktree | on/off toggle | `on` = create a new worktree; `off` = work locally. Collapses today's "Work locally / New worktree" choice. Branch/base selection out of scope. |
| Autonomous | on/off toggle | Newly surfaced in pre-session context (relocated/mirrored from the attach-menu toggle). |

### Behavior

- **No Start button.** Sending the first message (normal composer send) starts
  the thread with the current control values.
- **Pre-session only.** Once the first send creates the session, the stacked
  surface disappears and the composer reverts to the **normal active-session
  composer** — model selector in the footer trailing controls, autonomous in the
  attach menu, worktree status button — exactly as today. The stacked surface is
  not shown during an active session.
- Replaces today's inline footer context-picker row for new chat panels.

## Scope Boundaries

### In scope
- Stacked five-option surface in the agent-panel **pre-session** composer.
- Surfacing Model and Autonomous in that pre-session context.
- Removing/replacing the inline footer context-picker row for new chat panels.

### Out of scope / unchanged
- **Empty-state composer** (`packages/desktop/src/lib/components/main-app-view/components/content/empty-states.svelte`)
  — unchanged. The empty-state new-thread flow keeps its current layout.
- **Active-session composer** — unchanged.
- **Worktree picker "icon-only" idea** — explicitly cancelled / superseded by
  this surface. No icon-only work.
- Branch/base selection for worktrees; autonomous "levels" (on/off only).

## Success Criteria

1. Creating a new chat panel shows the stacked five-option surface above the
   composer input, with Project, Agent, Model, Worktree, and Autonomous rows.
2. No Start button exists; sending the first message starts the thread with the
   currently selected values for all five options.
3. After the first send, the stacked surface is gone and the composer matches
   the existing active-session composer exactly.
4. The empty-state composer is visually and behaviorally unchanged.
5. Worktree and Autonomous render as on/off toggles; `worktree on` creates a new
   worktree for the thread.

## Risks / Assumptions

- **Model pre-session availability (primary risk).** The model list depends on
  the selected agent's capabilities, which may not be loaded until the agent
  connects. Planning must resolve how the Model row behaves before connection
  (e.g. show the agent's default, populate/refresh on agent selection, disabled
  state until capabilities resolve). This is the main technical unknown.
- **Reuse vs. new.** Project, Agent, Worktree, and Autonomous controls already
  exist and are being relocated/restyled into rows; Model and Autonomous are
  newly surfaced in the pre-session footer context specifically.
- **Architecture gate.** This touches session-start parameters and the
  pre-session composer projection. The `god-architecture-check` gate applies —
  thread-start parameters should resolve through canonical session-creation
  inputs, not be patched downstream in the view.
- **UI package boundary.** Per repo MVC rules, presentational rows belong in
  `@acepe/ui`; desktop keeps the Controller adapters. New shared UI must follow
  `extract-to-ui-package`.

## Open Questions for Planning

- Exact placement/anchoring of the stacked surface relative to the composer body
  and any existing pre-composer cards (worktree setup card, error cards, etc.).
- How worktree on/off maps onto the existing `PreSessionWorktreeCard` /
  `worktreePending` state and the `onWorktreeCreating`/`onWorktreeCreated` flow.
- Default values when a new panel opens (last-used vs. context-derived).
