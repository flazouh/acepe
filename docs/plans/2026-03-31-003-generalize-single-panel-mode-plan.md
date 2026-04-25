---
title: "refactor: Generalize single mode into single-panel mode"
type: refactor
status: active
date: 2026-03-31
---

# Single Panel Mode Plan

**Goal:** Replace the agent-only "single" concept with a generic single-panel mode where any top-level project-attached panel can be the sole visible panel.

**Problem frame:** The current desktop layout still treats agent panels as the canonical panel model and routes every other fullscreen case through exceptions: `fullscreenPanelId`, aux-only terminal/browser/file/review behavior, and an out-of-band Git modal. That split makes the layout state machine harder to reason about and violates the intended product model that panels are peers attached to projects.

**User requirement trace:**
- The app should not have a concept of "single agent mode".
- It should have a concept of "single panel mode".
- All current top-level project-attached panel kinds in scope for this change — agent, top-level file, terminal, browser, review, and git — share the same single-panel selection model.

**Invariants for this change:**
- `viewMode === "single"` means one top-level panel is visible, regardless of panel kind.
- The selected single panel is resolved from the shared top-level panel focus model, not from agent-only helpers.
- Top-level file, terminal, browser, review, and git panels participate in the same fullscreen path as agent panels.
- Git is rendered as a project-attached panel, not as a separate modal-only exception.

**In-scope top-level panels:**
- Agent panels
- Top-level file panels (`ownerPanelId === null`)
- Terminal groups
- Browser panels
- Project-attached review panels
- Project-attached git panels

**Out-of-scope surfaces:**
- Attached file panes inside agent panels
- The session-level review overlay in `main-app-view.svelte`

**State contract:**

| State | Role in this change |
|---|---|
| `viewMode === "single"` | Generic single-panel layout |
| `focusedPanelId` | Steady-state selector for the visible top-level panel |
| `fullscreenPanelId` | Legacy compatibility input during restore/migration only; not a steady-state selector |
| `focusedViewProjectPath` | Project-card filtering only when not in single mode |
| `reviewFullscreen*` | Separate global overlay state; unchanged |

**Scope boundaries:**
- Generalize the single-mode state machine to all top-level panels.
- Normalize panel rendering so git/review are part of the panel model instead of fullscreen exceptions.
- Move review and git into the canonical top-level panel and persisted workspace model for this change.
- Keep attached file panes inside agent-panel composition for this change; they do not need to become independent top-level panels.
- Do not redesign the session-level review overlay in `main-app-view.svelte` in this change.
- Do not refactor grouped or project-mode rendering beyond the minimum changes required to host git and review panels and preserve current behavior.
- Do not introduce new keyboard shortcuts, commands, or panel-opening affordances in this change; only existing fullscreen and focus entry points are retargeted.

**Success criteria:**
- For each in-scope top-level panel kind, the existing fullscreen entry point sets single mode and selects that panel through the shared focused panel id.
- Closing the selected single-mode panel reuses the existing top-level ordering policy to select the next panel or exit single mode.
- Legacy agent fullscreen and legacy non-agent fullscreen workspace state restore to the same panel kind in single-panel mode.
- Git renders in the main panel container in single mode, while grouped and project mode receive regression coverage only, not broader renderer redesign.

## Architecture Direction

- Canonicalize the top-level panel model so review and git participate alongside agent/file/terminal/browser panels in both runtime state and persisted workspace state.
- Introduce one shared top-level panel accessor and focus model; `focusedPanelId` becomes the steady-state selector for single-panel mode across all in-scope kinds.
- Remove the single-agent-plus-aux layout from `panels-container.svelte`; single mode should render one selected panel, not a primary agent panel plus an auxiliary sibling.
- Separate three concerns explicitly during implementation: panel data model, single-panel selection model, and render host. The plan intentionally changes all three, but in that order.
- Keep grouped card mode by project, but only make the minimum grouped-mode host changes required to render git and review panels through the same container.

## Implementation Units

- [ ] **Unit 1: Capture the generic single-panel contract with failing tests**
  - **Goal:** Lock in the panel-wide fullscreen behavior before rewriting the store and container.
  - **Requirements:** Single mode must no longer be agent-specific; non-agent panels must participate in the same single-panel path.
  - **Dependencies:** None.
  - **Files:**
    - `packages/desktop/src/lib/acp/logic/__tests__/view-mode-state.test.ts`
    - `packages/desktop/src/lib/acp/store/__tests__/panel-store-terminal-fullscreen.vitest.ts`
    - `packages/desktop/src/lib/acp/store/__tests__/workspace-panel-types.test.ts`
    - `packages/desktop/src/lib/acp/store/__tests__/workspace-panels-persistence.test.ts`
    - `packages/desktop/src/lib/acp/store/__tests__/tab-bar-store-non-agent.vitest.ts`
    - `packages/desktop/src/lib/acp/store/__tests__/workspace-fullscreen-migration.test.ts`
    - `packages/desktop/src/lib/components/main-app-view/tests/main-app-view-state.vitest.ts`
    - `packages/desktop/src/lib/components/main-app-view/components/content/panel-grouping.test.ts`
    - `packages/desktop/src/lib/components/main-app-view/components/content/panels-container.fullscreen-session-safety.test.ts`
  - **Approach:** Add characterization tests that describe single mode as generic top-level panel selection, including non-agent panel kinds and the removal of the git modal exception.
  - **Execution note:** Start with failing tests.
  - **Patterns to follow:** Existing view-mode and workspace restore migration tests; existing panels-container safety tests.
  - **Test scenarios:**
    - Single mode resolves a top-level file or terminal panel, not just an agent panel.
    - Closing the active single-mode non-agent panel selects the next top-level panel or exits single mode cleanly.
    - Restoring a saved single-mode panel preserves the selected top-level panel across kinds.
    - Review and git panel kinds are covered by the canonical top-level panel and persistence tests before implementation begins.
    - Git is not treated as an external modal-only surface in the container render contract.
  - **Verification:** New tests fail on current agent-only behavior.

- [ ] **Unit 2: Canonicalize top-level panels and persistence**
  - **Goal:** Make all in-scope full-screenable top-level panels participate in one canonical runtime and persisted panel model.
  - **Requirements:** Review and git join the canonical top-level panel union and persisted workspace state rather than remaining side collections.
  - **Dependencies:** Unit 1.
  - **Files:**
    - `packages/desktop/src/lib/acp/store/types.ts`
    - `packages/desktop/src/lib/acp/store/panel-store.svelte.ts`
    - `packages/desktop/src/lib/acp/store/workspace-store.svelte.ts`
    - `packages/desktop/src/lib/acp/store/tab-bar-store.svelte.ts`
    - `packages/desktop/src/lib/acp/store/tab-bar-utils.ts`
    - `packages/desktop/src/lib/acp/store/review-panel-type.ts`
    - `packages/desktop/src/lib/acp/store/git-panel-type.ts`
    - `packages/desktop/src/lib/components/main-app-view/components/content/panel-grouping.ts`
  - **Approach:** Extend the workspace/top-level panel union to cover review and git, persist those panel kinds through the workspace state, route open/close/focus helpers through shared top-level panel helpers, and add a generic focused-top-level-panel accessor for downstream consumers.
  - **Patterns to follow:** Existing `WorkspacePanel` unions, terminal/browser top-level panel handling, and workspace restore compatibility paths.
  - **Test scenarios:**
    - Review and git panels report projectPath and participate in top-level panel lookup.
    - Focusing and closing top-level panels works the same across agent, file, terminal, browser, review, and git.
    - Opening git/review panels creates project-attached top-level panels instead of modal-only state.
    - Workspace save/restore and tab-bar derivation include review and git panel kinds correctly.
  - **Verification:** Panel-store helpers and persisted workspace types operate on generic top-level panels rather than agent-only panels.

- [ ] **Unit 3: Generalize the single-panel selection state machine**
  - **Goal:** Make single mode resolve one selected top-level panel across all in-scope panel kinds.
  - **Requirements:** Replace the agent-only and aux-only fullscreen split with one steady-state selection model.
  - **Dependencies:** Units 1 and 2.
  - **Files:**
    - `packages/desktop/src/lib/acp/logic/view-mode-state.ts`
    - `packages/desktop/src/lib/components/main-app-view/logic/main-app-view-state.svelte.ts`
    - `packages/desktop/src/lib/components/main-app-view.svelte`
    - `packages/desktop/src/lib/components/main-app-view/logic/managers/panel-handler.ts`
  - **Approach:** Reframe `viewMode === "single"` as generic single-panel selection, retire `fullscreenPanelId` from steady-state behavior, retarget existing fullscreen entry points to the shared top-level selector, and migrate app-shell helpers away from agent-only panel accessors.
  - **Patterns to follow:** Existing focused panel restore behavior and current fullscreen entry points.
  - **Test scenarios:**
    - Single mode renders each supported top-level panel kind through one selection path.
    - Switching single-mode focus across panel kinds does not require separate fullscreen state.
    - Legacy fullscreen entry points for agent, file, terminal, browser, review, and git converge on the same selection contract.
    - App-shell helpers such as file-explorer context and “new thread for focused project” use the generic focused top-level panel instead of an agent-only accessor.
  - **Verification:** No current fullscreen path depends on a separate aux-only fullscreen selector in steady state.

- [ ] **Unit 4: Replace the fullscreen render host with generic single-panel rendering**
  - **Goal:** Render the selected top-level panel inline in the main container for both single mode and grouped card mode.
  - **Requirements:** Eliminate the git modal host and the single-agent-plus-aux render branch while preserving grouped-mode behavior.
  - **Dependencies:** Units 1 through 3.
  - **Files:**
    - `packages/desktop/src/lib/components/main-app-view/components/content/panels-container.svelte`
    - `packages/desktop/src/lib/components/main-app-view/components/content/panel-grouping.ts`
    - `packages/desktop/src/lib/components/main-app-view/components/content/fullscreen-layout.ts`
    - `packages/desktop/src/lib/components/main-app-view/components/content/fullscreen-layout.vitest.ts`
    - `packages/desktop/src/lib/components/main-app-view/components/content/panel-grouping.test.ts`
    - `packages/desktop/src/lib/components/main-app-view/components/content/panels-container.fullscreen-session-safety.test.ts`
  - **Approach:** Replace the container’s agent fullscreen and aux fullscreen branching with one per-kind single-panel renderer, move git out of `EmbeddedModalShell` and into the main grouped/single render host, and limit grouped-mode changes to the minimum needed for git/review parity.
  - **Patterns to follow:** Existing grouped panel renderers and project grouping in `panels-container.svelte`.
  - **Test scenarios:**
    - Single mode renders each supported top-level panel kind through one branch.
    - Project and multi mode continue to render grouped panels by project with git now hosted inline.
    - Terminal, browser, file, review, and git panel chrome still works when rendered inline in single mode and grouped mode.
    - The session-level review overlay remains separate and does not replace project-attached review panels.
  - **Verification:** The main container has one generic single-panel host instead of an agent fullscreen branch plus aux handling and a separate git modal.

## Risks and Mitigations

- **Risk:** Git panel integration changes mount behavior or interaction assumptions because it was previously modal-only.
  **Mitigation:** Add focused container characterization before removing `EmbeddedModalShell`, and keep the Git panel’s component API unchanged while moving only its host path.

- **Risk:** Top-level focus transitions become stale for review/git because their IDs were not previously in the shared focus model.
  **Mitigation:** Normalize top-level panel lookup first, then migrate single-mode selection and close-path logic on top of that shared lookup.

- **Risk:** Workspace restore drops older fullscreen intent because prior state was split between `viewMode`, `focusedPanelIndex`, and `fullscreenPanelIndex`.
  **Mitigation:** Keep explicit compatibility branches in restore tests for both legacy agent fullscreen and legacy non-agent fullscreen selections.

- **Risk:** The separate session-level review overlay gets conflated with project-attached review panels during the migration.
  **Mitigation:** Keep the overlay explicitly out of scope in the state contract and preserve a regression test that workspace `reviewFullscreen` state remains separate from top-level review panel state.