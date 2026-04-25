---
title: "refactor: Redesign review panel as full-width two-pane workspace"
type: refactor
status: active
date: 2026-04-15
origin: docs/brainstorms/2026-04-15-review-panel-redesign-requirements.md
---

# refactor: Redesign review panel as full-width two-pane workspace

## Overview

Replace the current embedded review pane (narrow side column alongside agent conversation) and fullscreen overlay with a single full-width two-pane review workspace that takes over the agent content panel. Remove the review button's chevron dropdown — it becomes a simple button that enters this unified review mode. The "single review mode" applies to the agent-panel review flow (embedded pane + fullscreen overlay + dropdown are collapsed); the standalone top-level `ReviewPanel` remains unchanged for this pass.

## Problem Frame

The review experience is fragmented across three surfaces: a narrow embedded pane, a fullscreen overlay, and a dropdown to choose between them. This splits attention and adds decision friction. The redesign collapses these into one first-class review mode that replaces the agent conversation with a purpose-built code review workspace. (see origin: `docs/brainstorms/2026-04-15-review-panel-redesign-requirements.md`)

## Requirements Trace

- R1. Remove chevron/dropdown from review button — simple button
- R2. Eliminate panel vs. fullscreen distinction — single review mode for the agent-panel flow
- R3. Review mode replaces agent content panel (conversation hidden, not destroyed)
- R4. Two-pane layout: file list left, file content right
- R5. Left pane shows modified files with git diff metadata and review status
- R6. Right pane renders full file content using Pierre diff
- R7. Clicking a file in left pane loads it in right pane
- R8. Hunk-level accept/reject actions remain
- R9. Left pane indicates which files still need review
- R10. Back/close control exits review mode, restores conversation
- R11. Auto-select first unreviewed file on entry; auto-advance to next unreviewed file after completing current file; empty state when no files

## Scope Boundaries

- The standalone `ReviewPanel` (separate top-level panel) is not changed in this pass
- Review keyboard shortcuts (Cmd+Y/N, Cmd+Right, Escape) carry over unchanged
- `modifiedFilesState` computation and review-progress persistence are unchanged
- Per-file review status model (`accepted`/`partial`/`denied`) is unchanged — the UI maps these to display labels

### Deferred to Separate Tasks

- Deprecation of standalone `ReviewPanel` — future iteration

## Context & Research

### Relevant Code and Patterns

- `packages/ui/src/components/agent-panel/agent-panel-modified-files-trailing-controls.svelte` — current split button with chevron dropdown
- `packages/ui/src/components/agent-panel/agent-panel-shell.svelte` — shell layout with `leadingPane → reviewPane → center → trailingPane` slot order
- `packages/ui/src/components/agent-panel/agent-panel-modified-file-row.svelte` — existing file row with status badge and diff pill
- `packages/desktop/src/lib/acp/components/modified-files/modified-files-header.svelte` — builds review button model, preference branching, review progress tracking
- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte` — embedded review pane (fixed 450px column, display toggle), review mode state threading
- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-review-content.svelte` — shared review content (hydration, persistence, keyboard, Pierre diff rendering)
- `packages/desktop/src/lib/acp/components/review-panel/review-panel-diff.svelte` — Pierre diff integration via `parseDiffFromFile` + `ReviewDiffViewState`
- `packages/desktop/src/lib/acp/store/panel-store.svelte.ts` — `enterReviewMode`, `exitReviewMode`, `clearReviewState`, `setReviewFileIndex`
- `packages/desktop/src/lib/acp/store/session-review-state-store.svelte.ts` — per-hunk accept/reject persistence keyed by revision key

### Institutional Learnings

- Panel state is source of truth; avoid layout-switch side effects (see `docs/solutions/logic-errors/kanban-live-session-panel-sync-2026-04-02.md`)
- Review panel should consume canonical store-layer state, not re-scan UI state (see `docs/solutions/logic-errors/operation-interaction-association-2026-04-07.md`)
- Snippet props must be defined unconditionally in Svelte 5; conditions go inside snippet bodies (see `docs/solutions/best-practices/svelte5-unconditional-snippet-props-2026-04-12.md`)
- New UI components must be dumb/presentational in `packages/ui` — no Tauri, store, or app-specific logic (AGENTS.md)

## Key Technical Decisions

- **Fixed-width file list pane**: The left pane uses a fixed width, narrower than the old 450px embedded review column since it now shows only the file list (not the diff). The exact width is deferred to implementation (starting point ~280px). Resizability adds complexity without clear value for a file list. (Resolves deferred question from origin doc)
- **CSS display toggle for conversation preservation**: When review mode activates, the conversation is hidden via `display: none`, preserving scroll position and DOM state. This matches the existing pattern in `agent-panel.svelte` line 1731. (Resolves deferred question from origin doc)
- **Reuse existing review content logic**: The accept/reject flow, persistence hydration, keyboard shortcuts, and Pierre diff rendering in `agent-panel-review-content.svelte` are preserved. The change is structural (where it renders), not behavioral (how it works).
- **Status label mapping stays in UI layer**: The persisted model uses `accepted`/`partial`/`denied`. The `agent-panel-modified-file-row.svelte` component already maps these to display labels. No schema change needed.
- **Presentational component in `@acepe/ui`**: The two-pane review workspace shell is a new presentational component receiving data + callbacks via props, following the agent panel MVC pattern.

## Open Questions

### Resolved During Planning

- **Left pane resizable or fixed?** Fixed-width — simpler, matches existing embedded review pattern.
- **How to preserve conversation state?** CSS display toggle — proven pattern already used for embedded review.
- **R5 status vocabulary vs. codebase model?** Keep existing `accepted`/`partial`/`denied` model; UI maps to display labels.

### Deferred to Implementation

- **File list pane width**: Use a width that doesn't look awkwardly positioned. Implementation decides exact value.
- **Empty state copy and design**: Placeholder text when no modified files exist. Implementation will follow existing empty-state patterns in the codebase.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
Agent Panel (review mode OFF):
┌──────────────────────────────────────────┐
│ [leadingPane] │ conversation (center)    │
│               │ [modified-files-header]  │
│               │ [Review ▸] ← no chevron  │
└──────────────────────────────────────────┘

Agent Panel (review mode ON):
┌──────────────────────────────────────────┐
│ [leadingPane] │ [← Back]  Review         │
│               ├──────────┬───────────────│
│               │ file.ts ✓│ (full file    │
│               │ bar.ts  ○│  with Pierre  │
│               │ baz.ts  ○│  diff + hunk  │
│               │          │  actions)     │
└──────────────────────────────────────────┘

Center column swaps between conversation and review workspace
via CSS display toggle. Conversation DOM preserved.
```

The `reviewPane` slot is removed from `AgentPanelShell`. The review workspace renders in the center column (the same area as the conversation), swapped via CSS display toggle. The conversation DOM is preserved while hidden.

## Implementation Units

- [ ] **Unit 1: Remove chevron and simplify review button**

**Goal:** Transform the review split-button into a simple button. Remove dropdown, review options, and preference-based routing.

**Requirements:** R1, R2

**Dependencies:** None

**Files:**
- Modify: `packages/ui/src/components/agent-panel/agent-panel-modified-files-trailing-controls.svelte`
- Modify: `packages/desktop/src/lib/acp/components/modified-files/modified-files-header.svelte`
- Modify: `packages/ui/src/components/agent-panel/types.ts` (remove `reviewOptions` from `AgentPanelModifiedFilesTrailingModel`)
- Modify: `packages/ui/src/components/agent-panel/index.ts` (remove `AgentPanelModifiedFilesReviewOption` re-export)
- Modify: `packages/ui/src/index.ts` (remove `AgentPanelModifiedFilesReviewOption` re-export)
- Modify: `packages/website/src/lib/components/agent-panel-demo.svelte` (update mock data to remove `reviewOptions`)
- Test: `packages/ui/src/components/agent-panel/agent-panel-modified-files-trailing-controls.test.ts` (if exists, otherwise test via Unit 3 integration)

**Approach:**
- In `agent-panel-modified-files-trailing-controls.svelte`: remove the `DropdownMenu.Trigger` with chevron SVG (lines 36-44), remove `DropdownMenu.Content` with panel/fullscreen options (lines 47-59), keep only the main `Button` that calls `model.onReview?.()`
- In `modified-files-header.svelte`: remove `reviewPreferenceStore` usage, remove `handleReviewButtonClick` preference branching (lines 291-299), simplify to always call `onEnterReviewMode(modifiedFilesState, fileIndex)`. Remove `reviewOptions` from the trailing controls model (lines 253-273). Remove the `onOpenFullscreenReview` prop and its usage
- The `model.reviewOptions` array becomes unnecessary — remove it from the trailing controls model type

**Patterns to follow:**
- Existing simple button patterns in the same component (e.g., the "Keep" button at lines 64-80)

**Test scenarios:**
- Happy path: Review button renders without chevron or dropdown
- Happy path: Clicking review button calls `onReview` callback
- Edge case: Review button disabled state when no files to review still works

**Verification:**
- Review button renders as a single button with no dropdown affordance
- Clicking it enters review mode (via existing `onEnterReviewMode` flow)
- No references to fullscreen preference in the review button path

---

- [ ] **Unit 2: Create presentational ReviewWorkspace component**

**Goal:** Build the two-pane review workspace shell as a presentational component in `@acepe/ui`.

**Requirements:** R4, R5, R7, R9, R10, R11

**Dependencies:** None (can parallel with Unit 1)

**Files:**
- Create: `packages/ui/src/components/agent-panel/review-workspace.svelte`
- Create: `packages/ui/src/components/agent-panel/review-workspace-file-list.svelte`
- Create: `packages/ui/src/components/agent-panel/review-workspace-header.svelte`
- Modify: `packages/ui/src/components/agent-panel/index.ts` (export new components)
- Test: `packages/ui/src/components/agent-panel/review-workspace.test.ts`

**Approach:**
- `ReviewWorkspace`: top-level two-pane container. Props: file list data, selected file index, content snippet (for right pane), onClose, onFileSelect. Renders header + horizontal split (fixed-width file list | content area)
- `ReviewWorkspaceHeader`: back/close button + title. Props: onClose, label text. Presentational only
- `ReviewWorkspaceFileList`: renders file rows using existing `AgentPanelModifiedFileRow`. Props: files array (with path, additions, deletions, reviewStatus), selectedIndex, onFileSelect. Auto-scrolls selected file into view. Shows empty state when files array is empty
- Right pane is a snippet/slot — desktop fills it with Pierre diff via snippet override
- All components are presentational: labels as props, no i18n imports, no Tauri/store dependencies

**Patterns to follow:**
- `packages/ui/src/components/agent-panel/agent-panel-shell.svelte` — slot/snippet-based composition
- `packages/ui/src/components/agent-panel/agent-panel-modified-file-row.svelte` — existing file row rendering
- Agent Panel MVC pattern from AGENTS.md: view components in `@acepe/ui` accept model data + callbacks via props

**Test scenarios:**
- Happy path: Two-pane layout renders with file list and content area
- Happy path: Clicking a file in the list calls onFileSelect with correct index
- Happy path: Selected file is visually highlighted in the list
- Happy path: Back button calls onClose
- Edge case: Empty files array renders empty state in both panes
- Edge case: Single file auto-selected on mount

**Verification:**
- Component renders in `packages/website` with mock data (no desktop dependencies)
- File list shows review status badges, diff counts, and file paths
- Right pane content area fills remaining width

---

- [ ] **Unit 3: Replace embedded review with full-width ReviewWorkspace**

**Goal:** When review mode activates, swap the agent panel's center content from conversation to the ReviewWorkspace, rendering Pierre diff in the right pane.

**Requirements:** R3, R6, R8, R10, R11

**Dependencies:** Unit 1, Unit 2

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte`
- Modify: `packages/ui/src/components/agent-panel/agent-panel-shell.svelte`
- Modify: `packages/ui/src/components/agent-panel/agent-panel.svelte` (remove reviewPane slot forwarding)
- Modify: `packages/ui/src/components/agent-panel-scene/agent-panel-scene.svelte` (remove reviewPaneBody slot)
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-review-content.svelte` (split or suppress built-in chrome)
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/panels-container.svelte`

**Approach:**
- **Agent panel shell**: Remove the `reviewPane` slot from the horizontal layout. The review workspace no longer lives in a side slot — it replaces the center content. Also update `packages/ui/src/components/agent-panel/agent-panel.svelte` and `packages/ui/src/components/agent-panel-scene/agent-panel-scene.svelte` which forward/define the `reviewPane` slot
- **Agent panel**: Instead of rendering review content in a fixed-width side column (lines 1726-1746), conditionally render the ReviewWorkspace in the center column area when `reviewMode` is true. Hide the entire center column surfaces — body, preComposer, composer, footer, bottomDrawer, and topBar — via `display: none` when `reviewMode` is active (not just the conversation body). The ReviewWorkspace takes over the full center area. Remove `REVIEW_COLUMN_WIDTH` accounting from width calculations (lines 767-783)
- **Review content refactoring**: The existing `agent-panel-review-content.svelte` owns its own header (ReviewTabStrip, close/fullscreen buttons) and footer (ReviewBottomWidget). For the new workspace, either split it into composable pieces (diff body vs. chrome) or add props to suppress built-in header/navigation so it can be embedded cleanly in the ReviewWorkspace's right pane without duplicating controls. The ReviewWorkspace header (Unit 2) provides close/back — the review content should not render its own
- **File list data**: Build the file list model from `reviewFilesState.files`, mapping each file's review status from `sessionReviewStateStore` (reusing existing logic from `modified-files-header.svelte` lines 201-220 and 406-411)
- **Initial selection**: On review mode entry (including re-entry), find the first file where review status is not `accepted` and set it as the initial `reviewFileIndex`. If all files are reviewed, select the first file. Re-entry always jumps to first unreviewed — no "restore last file" behavior
- **Auto-advance**: After all hunks in the current file are acted on, automatically advance to the next unreviewed file. If no unreviewed files remain, stay on current file
- **Panels container**: Remove `onOpenFullscreenReview` callback wiring (lines 306-308, 506-508). The fullscreen review entry point from within the embedded review is eliminated

**Execution note:** Start with a characterization test verifying the current review entry/exit flow preserves conversation state, then modify the rendering.

**Patterns to follow:**
- Existing CSS display toggle in `agent-panel.svelte` line 1731
- Snippet override pattern from `agent-panel-scene.svelte` for platform-specific content
- `agent-panel-review-content.svelte` existing composition of `ReviewTabStrip` + `ReviewPanelDiff` + `ReviewBottomWidget`

**Test scenarios:**
- Happy path: Clicking review button hides conversation and shows two-pane review workspace
- Happy path: File list shows all modified files with correct review status
- Happy path: Right pane renders Pierre diff for selected file with full file content
- Happy path: Accept/reject hunk actions work and update file review status in left pane
- Happy path: Clicking a different file in list loads its diff in right pane
- Integration: Exiting review mode restores conversation with scroll position preserved
- Integration: Review state (accepted/rejected hunks) persists across review mode toggle
- Edge case: Entering review with all files already reviewed selects first file
- Edge case: Auto-advance to next unreviewed file after completing current file's hunks
- Edge case: Re-entering review mode after exit jumps to first unreviewed file, not last selected

**Verification:**
- Review mode fills the full center column width (no narrow side pane)
- Conversation DOM is preserved (not remounted) when toggling review mode
- All existing keyboard shortcuts continue to work
- Review progress persists correctly via `sessionReviewStateStore`

---

- [ ] **Unit 4: Remove fullscreen review system**

**Goal:** Fully remove the fullscreen review overlay, its state, preference store, settings toggle, and all entry points. No dead code left behind.

**Requirements:** R2

**Dependencies:** Unit 3

**Files:**
- Delete: `packages/desktop/src/lib/acp/components/review-panel/review-fullscreen-page.svelte` (fullscreen overlay component)
- Delete: `packages/desktop/src/lib/acp/store/review-preference-store.svelte.ts` (panel vs. fullscreen preference)
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte` (remove maximize button)
- Modify: `packages/desktop/src/lib/components/main-app-view.svelte` (remove overlay render block, remove all `reviewFullscreenOpen` gates)
- Modify: `packages/desktop/src/lib/components/main-app-view/logic/main-app-view-state.svelte.ts` (remove `reviewFullscreenOpen` state, persistence, methods)
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/panels-container.svelte` (remove fullscreen callbacks)
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/kanban-thread-dialog.svelte` (remove fullscreen callback)
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/types/agent-panel-props.ts` (remove `onOpenFullscreenReview` prop)
- Modify: `packages/desktop/src/lib/acp/store/workspace-store.svelte.ts` (remove fullscreen persistence)
- Modify: `packages/desktop/src/lib/acp/components/chat-section/chat-section.svelte` (remove settings UI toggle for review preference)

**Approach:**
- Remove the maximize/expand button from the review content header (agent-panel.svelte lines 1741-1743)
- Delete the fullscreen overlay render block in main-app-view.svelte (lines 1280-1302) and remove ALL `reviewFullscreenOpen` gates — modal state (line 985), tab bar suppression (line 1085), main content hiding (line 1156)
- Remove `reviewFullscreenOpen` field, persistence, and methods from `main-app-view-state.svelte.ts`
- Remove `onOpenFullscreenReview` from `AgentPanelProps` type and all call sites in panels-container and kanban-thread-dialog
- Delete `review-preference-store.svelte.ts` and remove its import from settings/chat-section
- Remove fullscreen workspace persistence from workspace-store
- Delete the `ReviewFullscreenPage` component file

**Patterns to follow:**
- Existing prop removal patterns — remove from type, then from all call sites
- Clean removal — no commented-out code, no dead imports

**Test scenarios:**
- Happy path: No maximize/expand button visible in review header
- Happy path: No fullscreen overlay appears regardless of stored preference
- Edge case: Existing workspace state with stale `reviewFullscreenOpen: true` loads without errors (field simply ignored)

**Verification:**
- No user-facing path reaches any fullscreen review surface
- TypeScript check passes with all fullscreen-related code removed
- App loads cleanly even with stale workspace state referencing fullscreen (graceful ignore)

## System-Wide Impact

- **Interaction graph:** The review button in `modified-files-header.svelte` → `panelStore.enterReviewMode()` → `agent-panel.svelte` renders ReviewWorkspace. Exit via `panelStore.exitReviewMode()`. The `agent-panel-review-content.svelte` continues to own Pierre diff rendering, persistence, and keyboard shortcuts
- **Error propagation:** If Pierre diff fails to render a file, the existing error handling in `review-panel-diff.svelte` applies. The file list remains navigable
- **State lifecycle risks:** Workspace restore persists `reviewMode` and `reviewFileIndex`. The restore path in `panel-store.svelte.ts` (pending review restores) must still work with the new center-column rendering. The existing `exitReviewMode` only flips `reviewMode: false` — the file state is preserved for re-entry
- **API surface parity:** The standalone `ReviewPanel` component is unchanged and still works via its own path. It will diverge from the new workspace UX but is scoped out
- **Unchanged invariants:** `modifiedFilesState` computation, `sessionReviewStateStore` persistence, `ReviewDiffViewState` behavior, and all keyboard shortcuts are unchanged

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Width calculation regressions in agent panel when removing REVIEW_COLUMN_WIDTH | Test with various panel sizes; the center column should simply fill available space |
| Workspace restore with stale fullscreen state | Guard against missing fullscreen overlay gracefully; do not crash on stale persisted state |
| File list pane too narrow or too wide at different window sizes | Start with ~280px fixed width; adjust during implementation based on visual testing |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-15-review-panel-redesign-requirements.md](docs/brainstorms/2026-04-15-review-panel-redesign-requirements.md)
- Related code: `packages/ui/src/components/agent-panel/` (presentational review components)
- Related code: `packages/desktop/src/lib/acp/components/agent-panel/` (desktop review integration)
- Related code: `packages/desktop/src/lib/acp/store/panel-store.svelte.ts` (review mode state)
- Learning: `docs/solutions/logic-errors/kanban-live-session-panel-sync-2026-04-02.md` (panel state as source of truth)
- Learning: `docs/solutions/best-practices/svelte5-unconditional-snippet-props-2026-04-12.md` (unconditional snippet props)
