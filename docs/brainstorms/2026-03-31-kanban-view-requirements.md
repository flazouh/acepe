---
date: 2026-03-31
topic: kanban-view
---

# Kanban View for the Attention Queue

## Problem Frame

Acepe currently has two different presentations of agent work: the normal layouts render real agent panels, while the attention surfaces render queue-derived summaries. That split makes view changes feel lossy. A user can see live tool calls and activity in kanban, but switching views or opening the thread can still feel like moving between two different systems.

The desired model is that kanban, single, project, and multi are all different presentations of the same live thread state. A live session should quietly join the normal panel system in the background, kanban should show that same live thread, and opening a thread from kanban should show the full normal thread UI without changing layouts.

## Requirements

**Shared Panel State**

- R1. Every live session must have a real backing agent panel in the normal panel system, even when that panel is added without taking focus.
- R2. When a session becomes live, Acepe must add its panel quietly in the background without stealing focus, forcing fullscreen, or changing the current layout.
- R3. In non-kanban layouts, these live panels may be hidden because another project is selected or another session is fullscreen, but they still exist in the normal panel layout.
- R4. Switching between kanban and the normal layouts must not change thread state. The same live tool calls, drafts, pending input, review state, sidebars, optimistic first-send state, and thread metadata must remain available across both presentations.
- R5. Kanban, normal panels, and the attention queue must read from the same panel-backed live thread model rather than maintaining separate runtime models.

**View Mode Integration**

- R6. Kanban must remain a value in the existing `ViewMode` union, selectable from the same layout menu that offers single, project, and multi.
- R7. When kanban is active, the attention queue sidebar/overlay must hide — the board replaces it as the primary attention surface.
- R8. Switching away from kanban to another view mode must preserve the user's panel and focus state exactly as it was before entering kanban.
- R9. Kanban must be persisted and restored via the same workspace state mechanism used by the other view modes.

**Board Layout**

- R10. The board must render as horizontal columns in this order: Answer Needed → Planning → Working → Finished → Idle → Error.
- R11. Each column must show its section label, color accent, and a count of items in that column.
- R12. Empty columns must remain visible with an empty-state indicator so the spatial layout stays stable.
- R13. Columns must scroll vertically when their items exceed the visible height.
- R14. The board must be horizontally scrollable or responsive so it works when the window is narrow enough that not all columns fit.

**Planning And Idle Status**

- R15. The classifier must split the current "working" section so that sessions in plan mode with active streaming or thinking activity are classified as Planning instead of Working.
- R16. Planning must keep the existing purple visual language already associated with plan-mode work.
- R17. Idle must be a first-class visible status and column.
- R18. Finished must mean a thread has newly completed work that the user has not yet seen.
- R19. Idle must mean the thread exists and is resting with no special attention required.
- R20. A thread must move from Finished to Idle once its completion has been seen.
- R21. Threads in Idle must remain part of the normal panel layout until the user closes them.

**Card Design**

- R22. Cards must replicate the existing kanban/subagent visual language: compact bordered surfaces, left accent strip, and the violet Robot treatment already used for subagent work.
- R23. The card body must show session title (or fallback), agent badge, project name with color badge, time-ago label, and current mode.
- R24. Cards in Planning and Working must show the current activity indicator, including live tool-call or thinking state.
- R25. Cards in Finished must show completion-oriented information such as diff stats when available.
- R26. Cards in Error must show the connection error text.
- R27. Cards must show todo progress when the session has active todos.
- R28. Idle cards must remain visibly connected to the same thread system, but should read as resting rather than actively running.

**Embedded Queue And Full Thread Interaction**

- R29. When a card has pending input (permission or question), the card must embed the compact approval or answer controls already used for attention actions.
- R30. Inline permission approval and question answering must work directly on the card without requiring a layout switch.
- R31. Clicking a card outside those inline controls must open the full normal thread UI in a dialog without leaving kanban.
- R32. The kanban dialog must use the same shared thread surface as the normal panel, not a kanban-specific quick view.
- R33. Interacting with a thread from kanban must immediately affect the same underlying panel state that appears in the normal layouts.
- R34. Users must be able to return to single, project, or multi and see the same thread state there with no rehydration gap or divergent UI behavior.

**Data Source**

- R35. The board must no longer be limited to the existing attention queue grouping alone.
- R36. Any compact card summary used in kanban must be derived from the shared live panel/thread model rather than from a separate queue-only model.
- R37. The attention queue and kanban may still present filtered or grouped views, but neither may own a distinct runtime truth about a thread.
- R38. The normal panel layout remains the canonical place where live sessions are materially displayed, even when some are currently hidden by project filtering or fullscreen focus.

**UI Component Location**

- R39. The reusable live thread surface shared by kanban and the normal layouts must be implemented once and reused across both shells.
- R40. Desktop-specific wiring for store access, panel lifecycle, navigation, and layout visibility must remain in `packages/desktop`.
- R41. Pure board and card presentation components may continue to live in `packages/ui`.

## Success Criteria

- A live session quietly becomes part of the normal panel system without changing the user's current focus or layout.
- Switching between kanban and the normal layouts does not change the thread's live information or interactivity.
- Opening a card from kanban shows the full normal thread UI in a dialog.
- Finished threads clearly represent unseen completed work, and seen completed threads settle into Idle.
- Idle threads remain visible on the board and in the normal panel system until the user closes them.
- The attention queue, kanban, and normal layouts behave like different presentations of the same underlying live thread state.

## Scope Boundaries

- No separate kanban-only thread runtime or quick-view implementation.
- No drag-and-drop between columns; thread state remains runtime-derived.
- No manual status assignment by the user.
- No automatic removal of a panel from the normal layout just because a live thread becomes idle.
- No custom column ordering, hiding, or filtering in this version.

## Key Decisions

- **View mode, not a separate thread system**: Kanban remains a layout mode, but it presents the same live thread state as the normal panel layouts.
- **Panel-backed live sessions**: Every live session gets a real agent panel in the background, even before the user focuses it.
- **Hidden does not mean absent**: A normal-layout panel may exist but be hidden by project focus or fullscreen selection.
- **Full thread dialog from kanban**: Card click opens the real thread UI, not a lighter quick view.
- **Idle is first-class**: Kanban shows Idle as its own visible column.
- **Finished then Idle**: Completed work first appears as Finished, then becomes Idle after the user has seen it.
- **Panels persist until user close**: Auto-created live panels stay in the normal layout until explicitly closed.

## Dependencies / Assumptions

- Panel lifecycle can be separated from layout visibility and focus.
- The normal agent thread UI can be split into a reusable shared surface that both normal layouts and kanban can host.
- Existing attention and unseen-completion signals can be reattached to the shared panel-backed live thread model.

## Outstanding Questions

### Deferred to Planning

- [Affects R1-R5][Technical] Where the shared panel-backed live thread projection should live so SessionStore and PanelStore keep clear responsibilities.
- [Affects R1-R3][Technical] Whether the system needs a separate registry for background live panels versus visibly laid-out panels, or whether the existing panel model can represent both cleanly.
- [Affects R31-R33][Technical] How to extract the shared live thread surface from the current AgentPanel shell without regressing fullscreen and normal layout behavior.
- [Affects R35-R38][Technical] How the existing attention queue should migrate from QueueItem-first derivation to the shared panel/thread model without breaking current notification and pending-input flows.
- [Affects R10-R14][Technical] How the added Idle column changes responsive board width and narrow-window behavior.

## Next Steps

→ Create a structured implementation plan in docs/plans/