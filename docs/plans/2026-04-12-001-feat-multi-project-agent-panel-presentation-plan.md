---
title: "feat: Simplify multi-project agent panel presentation"
type: feat
status: active
date: 2026-04-12
---

# feat: Simplify multi-project agent panel presentation

## Overview

Multi-project view currently wraps each project's panel cluster in a `ProjectCard` shell and hides the embedded project badge inside agent panel headers whenever more than one project group is present. That makes multi-project mode feel doubly grouped: a project wrapper outside the panel and no project identity inside the panel header. This change removes the extra wrapper in true multi-project mode, restores project identity directly in each agent panel header, adds a lightweight non-card project label for groups that have no agent panels, and makes multi-project ordering explicit so the visible agent-panel layout is grouped predictably by project instead of by first panel appearance.

## Problem Frame

The requested behavior is specific to the desktop multi-project layout: when multiple projects are visible at once, the wrapper card around each project group should disappear, the project badge should move back into the agent panel header, and agent panels should be ordered by project. Today that layout is driven from `panels-container.svelte` through `groupAllPanelsByProject(...)`, then rendered inside `ProjectCard` in card layout. The current grouping contract preserves first appearance order, and the embedded agent panel badge is hidden whenever more than one project group exists. The result is that multi-project view looks like a project-card gallery rather than a set of real agent panels grouped by project.

This plan keeps project mode and single/fullscreen mode semantics intact. Only true multi-project presentation changes, and any new ordering logic is scoped to the multi-project render path rather than the shared `allGroups` data that powers project-mode switching.

## Requirements Trace

- R1. In true multi-project view, do not wrap each project group in a `ProjectCard` shell.
- R2. In true multi-project view, show the project badge in each agent panel header instead of relying on an outer wrapper for project identity.
- R3. Multi-project agent panels must be ordered by project explicitly rather than by incidental first panel appearance.
- R4. In true multi-project view, any visible project cluster without an agent panel must still expose project identity through a lightweight non-card label row.
- R5. Existing project-mode behavior must remain intact, including focused-project switching, focused-project fallback selection, and hiding inactive groups.
- R6. Existing single/fullscreen behavior, project selection state, non-agent panel behavior, and panel-local controls must remain unchanged except for the explicit multi-project identity row introduced by R4.
- R7. Wrapper removal may only include minimal spacing or ordering adjustments required to keep multi-project clusters legible; broader chrome redesign remains out of scope.

## Scope Boundaries

- This work changes the desktop multi-project panel layout only; it does not redesign the sidebar, kanban board, or project selection picker.
- This work does not redesign file, review, terminal, or browser panel header chrome beyond whatever adjacency changes naturally result from removing the outer multi-project wrapper and adding the multi-project-only lightweight project label row for non-agent groups.
- This work does not change project metadata ownership, session restore semantics, or provider/runtime behavior.

### Deferred to Separate Tasks

- Any follow-up visual spacing polish beyond minimal gap/order adjustments needed to keep wrapperless groups readable.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src/lib/components/main-app-view/components/content/panels-container.svelte` is the multi/project/single layout owner. It builds `allGroups`, resolves `viewModeState`, and decides whether to wrap grouped content in `ProjectCard`.
- `packages/desktop/src/lib/components/main-app-view/components/content/panel-grouping.ts` owns project-group construction today. It currently preserves first panel appearance order.
- `packages/desktop/src/lib/acp/logic/view-mode-state.ts` defines the semantic difference between `multi`, `project`, `single`, and `kanban`. In particular, `multi` means card layout with all projects visible; `project` means card layout with one active project and project-switcher metadata.
- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte` and `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-header.svelte` already carry `projectName`, `projectColor`, `sequenceId`, and `hideProjectBadge` into the shared `@acepe/ui` header.
- `packages/ui/src/components/agent-panel/agent-panel-header.svelte` already knows how to render the project badge when the desktop wrapper passes project metadata through.
- `packages/ui/src/components/project-card/project-card.svelte` is the current outer wrapper being used in multi/project card layouts.

### Institutional Learnings

- `docs/solutions/logic-errors/kanban-live-session-panel-sync-2026-04-02.md` reinforces that alternate views should project from real panel state rather than inventing parallel UI-specific models.
- `docs/solutions/logic-errors/operation-interaction-association-2026-04-07.md` reinforces that grouping and projection logic should stay below the UI boundary instead of being repaired ad hoc in view code.
- `docs/solutions/best-practices/svelte5-unconditional-snippet-props-2026-04-12.md` is relevant if any snippet-driven header or wrapper composition changes are needed while simplifying the multi-project layout.

### External References

- None. The codebase already has strong local patterns for grouped panel layout, project metadata projection, and embedded project badges.

## Key Technical Decisions

- **Limit wrapper removal to true multi-project mode:** `project` mode still needs its focused-project switcher behavior, so the wrapper should remain there unless and until that mode gets its own redesign.
- **Make project order explicit only in the multi-project render path:** Multi-project presentation should not depend on incidental panel creation order, but `project` mode should keep its current `allGroups`-driven fallback and switcher semantics.
- **Surface project identity without reintroducing a card shell:** In multi mode, agent panels carry project identity in their headers; groups without agent panels get a lightweight project label row instead of a `ProjectCard`.
- **Keep project identity near the top of wrapperless clusters:** In multi mode, agent panels should render before auxiliary non-agent panels inside the same project cluster so the project badge appears before lower supporting surfaces.
- **Reuse existing agent panel header project badge path:** The header already accepts project metadata; this change should flip the visibility decision for multi-project mode rather than introducing a second project-label surface.

## Open Questions

### Resolved During Planning

- **How should projects be sorted?** Use resolved project display name as the primary sort key, with project path as a stable tiebreaker. Empty/unresolved project keys should sort after named projects.
- **Should project-mode switching change too?** No. The requested behavior is scoped to true multi-project mode. Project mode should keep the existing focused-project wrapper and project switcher behavior.
- **How do non-agent-only groups retain project identity?** Use a lightweight multi-project-only project label row instead of preserving the full `ProjectCard` shell.
- **Should sorting happen inside raw grouping or after grouping?** Keep raw grouping focused on association, then apply explicit project ordering in a multi-only layout projection so the ordering policy is visible and testable without changing `project` mode semantics.

### Deferred to Implementation

- The exact token choices for the lightweight non-card project label row, as long as it stays visually minimal and does not become a replacement card shell.

## Implementation Units

- [ ] **Unit 1: Add explicit project ordering for multi-project layout only**

**Goal:** Define and test a stable project sort order for the data that feeds the true multi-project render path without changing project-mode fallback behavior.

**Requirements:** R3, R5, R6

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/panel-grouping.ts`
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/panel-grouping.test.ts`
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/panels-container.svelte`

**Approach:**
- Introduce a multi-project-only layout projection that sorts groups by resolved project display name plus project path as a stable key.
- Keep `allGroups` unchanged so `view-mode-state` retains current focused-project fallback and project switcher semantics.
- Keep existing per-project panel arrays in insertion order at this stage; only the multi-project group order changes in Unit 1.

**Patterns to follow:**
- `packages/desktop/src/lib/components/main-app-view/components/content/panel-grouping.ts`
- `packages/desktop/src/lib/acp/logic/view-mode-state.ts`

**Test scenarios:**
- Happy path — given groups for multiple named projects, the multi-project layout projection orders them alphabetically by resolved project name.
- Edge case — when one group has an empty or unresolved project key, named projects sort first and the unresolved group sorts last.
- Edge case — when two groups have equal display names, project path acts as a stable tiebreaker rather than producing nondeterministic order.
- Integration — `allGroups` remains unchanged for `view-mode-state`, so project-mode fallback `activeProjectPath` and `focusedModeAllProjects` ordering do not regress.

**Verification:**
- The multi-project render path exposes a deterministic project order independent of panel creation order, while `project` mode keeps its current ordering behavior.

- [ ] **Unit 2: Remove the outer project wrapper only in multi-project mode**

**Goal:** Simplify true multi-project presentation by rendering grouped panels directly instead of wrapping each visible project cluster in `ProjectCard`.

**Requirements:** R1, R4, R5, R6, R7

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/panels-container.svelte`
- Add: `packages/desktop/src/lib/components/main-app-view/components/content/multi-project-group-label.svelte`
- Test: `packages/desktop/src/lib/components/main-app-view/components/content/__tests__/panels-container.multi-project-layout.svelte.vitest.ts`

**Approach:**
- Feed `panels-container` from the explicitly sorted multi-project projection from Unit 1.
- In `multi` mode, render grouped panel content directly without the `ProjectCard` wrapper.
- For groups with agent panels, render agent panels before auxiliary non-agent panels so project identity appears at the top of the wrapperless cluster.
- For groups with no agent panels, render a lightweight non-card project label row before the existing panel content so project identity remains visible without restoring `ProjectCard`.
- In `project` mode, keep the current wrapper path so `focusedModeAllProjects`, active-project hiding, and project switching remain unchanged.
- Preserve hidden-but-mounted behavior for inactive groups outside multi mode.
- Limit visual adjustments to minimal spacing/token changes required to keep wrapperless clusters readable.

**Execution note:** Start with a failing component test for multi-mode rendering so the wrapper-removal behavior is captured before layout changes.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/logic/view-mode-state.ts`
- `packages/desktop/src/lib/components/main-app-view/components/content/__tests__/agent-attached-file-pane.svelte.vitest.ts`
- `packages/desktop/src/lib/acp/components/project-header.svelte`

**Test scenarios:**
- Happy path — in `multi` mode with two project groups, the layout renders both groups without `ProjectCard` chrome while preserving grouped panel content.
- Happy path — in `project` mode with multiple groups, the active project still renders through the existing wrapper path and the project switcher metadata remains available.
- Edge case — a group with non-agent top-level panels but no agent panels renders the lightweight project label row and its existing panel content in multi mode.
- Edge case — a mixed project group with agent and non-agent top-level panels renders the agent panel section first so project identity appears before auxiliary surfaces.
- Integration — moving between `multi` and `project` modes does not break hidden-group behavior, focused-project selection, or wrapper usage outside true multi mode.

**Verification:**
- Multi-project view shows wrapperless project clusters with a clear top-of-cluster identity surface, while project mode still behaves like the current focused-project experience.

- [ ] **Unit 3: Restore project identity in multi-project agent panel headers**

**Goal:** Show the project badge inside each agent panel header when multi-project view is active, while preserving current single/project/fullscreen behavior.

**Requirements:** R2, R5, R6

**Dependencies:** Unit 2

**Files:**
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/panels-container.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/agent-panel-header.project-style.svelte.vitest.ts`
- Test: `packages/desktop/src/lib/components/main-app-view/components/content/__tests__/panels-container.multi-project-layout.svelte.vitest.ts`

**Approach:**
- Replace the current `hideEmbeddedProjectBadge = allGroups.length > 1` coupling with a view-mode-aware decision: show the badge in true multi-project mode, keep current suppression behavior for project-mode wrapper rendering and fullscreen/single mode.
- Reuse the existing `AgentPanelHeader` project badge path rather than adding a new header label or desktop-only badge element.
- Preserve the existing pending-project-selection behavior, which should still suppress normal session header identity until a project is chosen.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-header.svelte`
- `packages/ui/src/components/agent-panel/agent-panel-header.svelte`
- `packages/desktop/src/lib/acp/components/terminal-panel/terminal-panel-header.svelte`

**Test scenarios:**
- Happy path — when a multi-project agent panel has resolved project metadata, its header renders the project badge and sequence as part of the existing header chrome.
- Edge case — a pending-project-selection panel still shows the selection header state rather than a normal project badge.
- Edge case — single/fullscreen and project-mode agent panel rendering keep the current badge suppression behavior where the outer project wrapper already provides project identity.
- Integration — the same multi-project render pass that removed `ProjectCard` wrappers still passes project metadata into the agent panel header correctly and does not conflict with the lightweight label row used by non-agent-only groups.

**Verification:**
- In multi-project view, each agent panel header carries its own project identity without introducing a duplicate outer wrapper or changing header controls.

## System-Wide Impact

- **Interaction graph:** `panel-grouping.ts` and `panels-container.svelte` jointly define multi-project ordering and grouping; `view-mode-state.ts` keeps consuming unsorted `allGroups` for active-project and switcher semantics; agent panel header rendering remains prop-driven through the existing desktop-to-UI boundary.
- **Error propagation:** This is a layout and projection change only. Failures should remain limited to rendering/test regressions rather than runtime state mutation.
- **State lifecycle risks:** Multi-only sorting must not disturb panel identity, focused panel selection, or hidden-but-mounted group behavior when switching between `multi`, `project`, and `single`.
- **API surface parity:** `AgentPanelHeader` already supports project badge props; the main interface risk is changing when those props are suppressed, not introducing a new API.
- **Integration coverage:** The highest-risk path is the combination of multi-only sorted groups, multi/project mode transitions, lightweight non-agent group labeling, and header badge visibility decisions in `panels-container`.
- **Unchanged invariants:** Project selection flow, session restore metadata ownership, pending-project-selection behavior, project-mode ordering/fallback behavior, and non-agent panel runtime behavior remain unchanged apart from the explicit multi-mode project label row.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Removing the wrapper in the wrong card-layout mode breaks focused-project switching | Scope wrapper removal to true `multi` mode and keep `project` mode on the existing wrapper path |
| Sorting by project changes project-mode fallback behavior | Keep sorting in a multi-only layout projection and add tests that `view-mode-state` still sees unsorted `allGroups` |
| Non-agent groups lose project identity after wrapper removal | Render a lightweight non-card project label row for non-agent-only groups in multi mode and cover it with component tests |
| Multi-project header badge visibility regresses fullscreen or project-mode headers | Drive badge visibility from view mode instead of raw group count and cover both multi and non-multi cases in tests |
| Mixed project groups become visually unclear once the wrapper is removed | Render agent panels before auxiliary surfaces in wrapperless groups and limit follow-up changes to minimal spacing/order adjustments already defined in scope |

## Documentation / Operational Notes

- No user-facing documentation update is required. This is a desktop layout refinement.
- The implementation should validate the final layout in the live desktop app after the component tests pass, especially for mixed groups and non-agent-only groups in true multi-project mode.

## Sources & References

- Related code: `packages/desktop/src/lib/components/main-app-view/components/content/panels-container.svelte`
- Related code: `packages/desktop/src/lib/components/main-app-view/components/content/panel-grouping.ts`
- Related code: `packages/desktop/src/lib/acp/logic/view-mode-state.ts`
- Related code: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-header.svelte`
- Related test: `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/agent-panel-header.project-style.svelte.vitest.ts`
- Related learning: `docs/solutions/logic-errors/kanban-live-session-panel-sync-2026-04-02.md`
- Related learning: `docs/solutions/logic-errors/operation-interaction-association-2026-04-07.md`
- Related learning: `docs/solutions/best-practices/svelte5-unconditional-snippet-props-2026-04-12.md`
