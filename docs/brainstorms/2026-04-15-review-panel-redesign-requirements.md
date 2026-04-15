---
date: 2026-04-15
topic: review-panel-redesign
---

# Review Panel Redesign

## Problem Frame

The current review experience splits attention: it either appears alongside the agent conversation in a narrow embedded pane or in a separate fullscreen overlay. The review button also has a chevron dropdown to choose between these two modes, adding decision friction. The result is a review flow that feels bolted on rather than first-class.

The redesign makes review a primary workspace mode: clicking the review button replaces the agent content panel entirely with a purpose-built two-pane code review view.

## Requirements

**Review Button**
- R1. Remove the chevron and dropdown from the review button — it becomes a simple button that enters review mode.
- R2. The panel vs. fullscreen mode distinction is eliminated; there is now a single review mode.

**Review Layout**
- R3. Entering review mode replaces the agent content panel (the agent conversation is hidden, not destroyed).
- R4. The review view is a two-pane layout: file list on the left, file content on the right.
- R5. The left pane shows modified files with git diff metadata (file path, additions/deletions, review status — not reviewed, partial, reviewed, undone).
- R6. The right pane renders the full file content using Pierre diff (`@pierre/diffs`), not just isolated diff hunks.
- R7. Clicking a file in the left pane loads it in the right pane.

**Review Actions**
- R8. Hunk-level accept/reject actions remain available in the right pane (same as today's `ReviewDiffViewState` behavior).
- R9. The left pane indicates which files still need review (not yet fully accepted/rejected).

**Navigation**
- R10. A back/close control in the review header exits review mode and restores the agent conversation.

**Initial State**
- R11. Entering review mode auto-selects the first modified file that still needs review. If no modified files exist, the right pane shows an empty state.

## Success Criteria

- Clicking the review button immediately shows a two-pane review view in place of the agent conversation — no mode choice, no overlay.
- A user can work through all modified files, accepting/rejecting hunks, without switching windows or panels.
- Exiting review mode restores the agent conversation exactly where it was.

## Scope Boundaries

- The standalone `ReviewPanel` (separate top-level panel) is not changed in this pass; it can be deprecated later.
- The fullscreen review overlay (`ReviewFullscreenPage`) will be removed or disabled once this ships, but cleanup of dead code can follow in a separate pass.
- Review keyboard shortcuts (Cmd+Y accept, Cmd+N reject) carry over unchanged.
- No changes to how `modifiedFilesState` is computed from session entries. Review-progress persistence (accept/reject state per hunk) continues to use the existing mechanism.

## Key Decisions

- **Single review mode**: The panel vs. fullscreen choice added cognitive overhead with little benefit. One mode, built into the agent panel, is simpler.
- **Full file content**: Showing only diff hunks loses context. Pierre diff already supports full-file rendering with inline diff highlights — use that.
- **Replace, don't overlay**: The review view takes over the agent panel space rather than appearing alongside it, giving review the full width it needs.

## Dependencies / Assumptions

- Pierre diff (`@pierre/diffs`) already supports rendering full file content with diff annotations — no new library work needed.
- `modifiedFilesState` already provides `originalContent` and `finalContent` per file, which is what Pierre diff needs.

## Outstanding Questions

### Deferred to Planning

- [Affects R4][Technical] Determine whether the left file-list pane should be resizable or fixed-width.
- [Affects R3][Technical] Determine how to preserve agent panel scroll position while review mode is active (likely just hide/show via CSS display, as today's embedded review does).
- [Affects R2][Needs research] Audit all call sites that reference the panel vs. fullscreen review preference and the fullscreen overlay to plan their removal.

## Next Steps

-> /ce:plan for structured implementation planning
