---
status: complete
priority: p3
issue_id: "014"
tags: [code-review, simplicity, checkpoint, ui]
dependencies: []
---

# Integrate or Remove Checkpoint UI Components

## Problem Statement

The checkpoint UI components (`CheckpointTimeline.svelte`, `RewindSessionDialog.svelte`) are exported but never imported or rendered anywhere in the application.

## Findings

**Location:** `/packages/desktop/src/lib/acp/components/checkpoint/`

**Unused components:**

- `checkpoint-timeline.svelte` - exported but never used
- `rewind-session-dialog.svelte` - exported but never used
- `index.ts` - exports components that are never imported

**Verification:** Grep search found no imports of these components.

## Proposed Solutions

### Solution A: Integrate into Agent Panel (Recommended if feature wanted)

**Effort:** Medium (1-2 hours)
**Risk:** Low

Add checkpoint timeline to the agent panel sidebar or as a collapsible section.

### Solution B: Delete Unused Components

**Effort:** Small (15 min)
**Risk:** None

Delete the entire `checkpoint/` component directory if the UI is not needed.

**Pros:** Remove dead code
**Cons:** Must reimplement if UI is wanted later

## Recommended Action

_To be filled during triage - clarify if checkpoint UI is intended for this release_

## Technical Details

**Affected Files:**

- `packages/desktop/src/lib/acp/components/checkpoint/` (entire directory)

**Database Changes:** None

## Acceptance Criteria

- [x] Decision made: integrate or delete
- [x] If integrate: components render correctly
- [x] If delete: no broken imports

## Work Log

| Date       | Action                   | Learnings                                                                                                                                                                                                         |
| ---------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-01-31 | Created from code review | Code-simplicity-reviewer identified unused UI components                                                                                                                                                          |
| 2026-01-31 | **INTEGRATED**           | Created checkpoint panel with: collapsible timeline (icon button), inline confirm buttons (pill style X/✓), expandable file lists, rewind session button. Integrated into agent-panel-content.svelte.             |
| 2026-01-31 | **REFACTORED**           | Moved toggle button below input, timeline now takes full panel view instead of dropdown. Removed unused CheckpointPanel wrapper. Toggle button in agent-panel.svelte, timeline replaces content area when active. |

## Resources

- Simplicity review findings
