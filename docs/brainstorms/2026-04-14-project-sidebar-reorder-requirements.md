---
date: 2026-04-14
topic: project-sidebar-reorder
---

# Project Sidebar Drag-to-Reorder

## Problem Frame

Users with many projects cannot control the order they appear in the sidebar. The project list grows over time and the default ordering (insertion order) stops matching how people actually prioritize their work. A community user explicitly requested drag-to-reorder in issue #97.

The backend already supports persisted project ordering (`ProjectRepository::reorder`, `updateProjectOrder`), but there is no UI affordance to trigger it.

## Requirements

**Drag affordance**

- R1. Hovering over a project's letter badge transforms it into a 6-dot grip icon, signaling that the project is draggable.
- R2. The grip icon appears on hover only — at rest the badge displays its normal letter/icon appearance.

**Drag behavior**

- R3. Pressing and dragging the grip icon initiates a reorder drag of that project group.
- R4. Grabbing the grip collapses the project group to its collapsed state (badge-only height). On drop or cancel (Escape key or releasing outside the sidebar), the group's prior expanded/collapsed state is restored.
- R5. A semi-transparent ghost of the collapsed badge follows the cursor during drag.
- R6. An insertion line appears between projects to indicate the drop target position.
- R9. Dragging near the top or bottom edge of the sidebar auto-scrolls the project list so users can move projects across long lists in one gesture.

**Drop and persistence**

- R7. Releasing the drag over a valid sidebar insertion target commits the new order immediately by computing the full ordered array of all sidebar project paths and passing it to the existing `updateProjectOrder` path (which requires every project in the list). Releasing outside the sidebar cancels the drag and restores the prior order.
- R8. The reordered position persists across app restarts (already supported by the backend).
- R10. The reorder is applied optimistically in the UI. If persistence fails, the sidebar silently rolls back to the previous order.

**Non-drag fallback**

- R11. Each project's context menu includes "Move Up" and "Move Down" actions as a lightweight alternative to drag, ensuring keyboard-only and assistive-technology users can reorder projects.

## Success Criteria

- A user can reorder sidebar projects by dragging the badge grip, and the new order survives restart.
- A user can reorder projects via context menu Move Up/Move Down actions, and the resulting order persists across restart.
- The interaction feels responsive with no visible layout jumps or flicker during drag (the intentional collapse on grab is expected; "no jumps" applies to the settled drag state).

## Scope Boundaries

- Sidebar project list only — other project surfaces (pickers, kanban) are not in scope.
- No edit mode or toggle — the hover-to-reveal grip pattern keeps reorder always available without extra UI.
- Discoverability hints (tooltips, onboarding) are deferred to planning — the context-menu fallback provides a secondary discovery path.

## Key Decisions

- **Always-on via hover**: the 6-dot grip replaces the badge on hover, so no separate edit/reorder mode is needed. This keeps the interaction discoverable without adding chrome.
- **Collapse on grab**: grabbing the grip collapses the group to badge height immediately, so drop gaps stay obvious and the sidebar doesn't jump around.

## Dependencies / Assumptions

- The existing `updateProjectOrder` → `ProjectRepository::reorder` backend path works correctly (confirmed by `project_repository_reorders_projects_and_persists_icon_path` test).
- The sidebar rendering must sort projects by persisted `sortOrder` rather than creation time for the reordered position to be visible after drop and on restart.
- The `project-letter-badge` component in `@acepe/ui` must be extended (or wrapped) to support a grip state — no `mode` or `isGrip` prop exists today.

## Outstanding Questions

### Deferred to Planning

- [Affects R4][Technical] What animation or transition should play when the group collapses at drag start and re-expands on drop/cancel?
- [Affects R5][Technical] Should the drag ghost be implemented via HTML5 drag API, pointer events with a portal overlay, or a Svelte action? Each has trade-offs around cross-platform feel in Tauri.
- [Affects R1][Needs research] Does the existing `project-letter-badge` component need structural changes to support the grip icon swap, or can it be handled with a CSS-only hover state?

## Next Steps

-> `/ce:plan` for structured implementation planning
