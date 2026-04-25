---
title: "feat: Move project spawn and agent switching controls"
type: feat
status: active
date: 2026-04-17
---

# feat: Move project spawn and agent switching controls

## Overview

Make the project-sidebar `+` button a direct "new session" action that always spawns the effective default agent, move browser/terminal launch buttons into the project header as hover-only actions, turn the agent icon in the agent panel header into the place where users change the panel's active agent, and remove the dedicated in-panel "pick agent" view so agent choice lives in one place.

## Problem Frame

The current sidebar project header overloads the `+` affordance. Left-click sometimes creates a session, while right-click and some fallback paths replace the entire project header with `ProjectHeaderAgentStrip`, which mixes agent spawning with browser and terminal actions. That makes the `+` button feel modal instead of direct.

At the same time, the agent panel header already shows the current agent icon, but it is not interactive even though the panel controller already owns `selectedAgentId` and `onAgentChange`. Users are being sent to the sidebar to choose a specific agent for a new thread, and the panel still has a dedicated project-selection surface that embeds agent choices into project cards. That splits one behavior across two different views.

This plan keeps the existing global default-agent behavior introduced by the recent default-agent work, but relocates the interaction surfaces so:

- project headers use direct actions for spawning and utility panels
- agent selection lives in the panel where the user is working
- the agent panel no longer has a separate "pick agent" content state
- browser and terminal actions remain project-scoped, not mixed into the agent picker flow

## Requirements Trace

- R1. Clicking the project-header `+` button always triggers session creation directly instead of opening the project header quick-action strip.
- R2. The `+` button uses the effective spawn agent: saved default when valid, otherwise the first available spawnable agent, and only falls back to agent-less creation when no spawnable agent exists.
- R3. Browser and terminal entry points are visible from the project header on hover/focus and continue opening the existing project-scoped panels.
- R4. Clicking the agent icon in the agent panel header opens an agent dropdown so the user can change the panel's active agent from there.
- R5. The panel header picker remains available during pre-session/project-selection states so users do not need a separate in-panel agent-picking view.
- R6. The panel header picker uses the same panel-level selection flow that already powers `onAgentChange`, so the chosen agent is reflected consistently across panel affordances that depend on agent identity.
- R7. The agent panel's `project_selection` state is simplified to project selection only; embedded agent buttons/cards and agent-selection gating are removed.
- R8. Obsolete right-click/strip affordances, tooltip copy, and tests tied to `ProjectHeaderAgentStrip` or the old in-panel agent-picking view are removed or rewritten to match the new interaction model.

## Scope Boundaries

- No changes to the persisted `default_agent_id` setting model, Settings page controls, or empty-state / kanban default-agent resolution beyond reusing their existing semantics.
- No per-project default-agent behavior.
- No changes to terminal or browser panel implementations beyond how their launch buttons are surfaced in the sidebar header.
- No change to project overflow-menu behavior, project context menu behavior, or git-panel entry points.
- No change to the existing project-card metadata loading (branch, git status, ahead/behind) beyond removing agent-picking responsibilities from that surface.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src/lib/acp/components/session-list/session-list-ui.svelte` currently owns the overloaded `+` behavior, `projectPathShowingAgentStrip`, and the duplicated project-header action markup for loading and loaded states.
- `packages/desktop/src/lib/acp/components/project-header-agent-strip.svelte` is the temporary affordance that bundles terminal, browser, agent icons, and cancel into a full-width header replacement.
- `packages/desktop/src/lib/acp/components/session-list/session-list-logic.ts` already contains the sidebar's default-agent helper seam (`resolveDefaultAgentIdForCreate`) and is the right place to evolve the spawn-resolution contract.
- `packages/desktop/src/lib/acp/components/agent-selector.svelte` already implements the agent dropdown behavior on top of the shared `Selector` primitive and is the best reuse point for a compact panel-header picker.
- `packages/ui/src/components/selector/selector.svelte` already supports trigger styling via `variant` and `buttonClass`, which makes a compact header trigger feasible without inventing a new dropdown stack.
- `packages/ui/src/components/agent-panel/agent-panel-header.svelte` is the shared presentational shell for the header; it currently supports a static `agentIconSrc` cell but not an interactive leading control.
- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-header.svelte` is the desktop wrapper that translates runtime data into the shared header shell and is the right place to inject a compact picker snippet.
- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte` already receives `selectedAgentId`, `availableAgents`, and `onAgentChange`, but several agent-dependent call sites still prefer `sessionAgentId` first, which would hide or ignore a header-driven override.
- `packages/desktop/src/lib/acp/components/project-selection-panel.svelte` currently renders agent buttons directly (single-project grid and per-project card actions), which is the in-panel picker surface that now needs to disappear.
- `packages/desktop/src/lib/acp/logic/panel-visibility.ts` currently treats `project_selection` as "needs project selection OR agent selection", so the state machine itself encodes the old split behavior.
- `packages/desktop/src/lib/components/main-app-view/logic/main-app-view-state.svelte.ts` already persists panel-level agent changes through `handlePanelAgentChange`, including auto-selecting newly chosen spawnable agents in preferences when needed.

### Institutional Learnings

- `docs/plans/2026-04-13-003-feat-default-agent-selection-plan.md` established the global default-agent semantics: valid saved default wins, invalid default degrades gracefully.
- `docs/plans/2026-04-10-004-refactor-agent-panel-ui-extraction-reset-plan.md` established the shared-panel rule that `packages/ui` stays dumb/presentational while desktop owns runtime adapters and interactive state wiring.

### External References

- None. The repo already has strong local patterns for the sidebar interaction model, default-agent resolution, and shared-vs-desktop panel seams.

## Key Technical Decisions

- **Sidebar `+` resolves an effective spawn agent instead of opening a strip:** the sidebar should always treat `+` as a direct create action. Its resolver should return the saved default when it is still spawnable, otherwise the first available spawnable agent, otherwise `undefined` so the existing agent-less creation path can continue when no agents are available.
- **Browser and terminal become first-class header quick actions:** they should live next to the project overflow / create controls and be revealed on project-header hover or focus-within rather than hidden behind a modal strip.
- **The panel header reuses `AgentSelector` instead of creating a second picker implementation:** the existing selector already owns dropdown behavior, theming, and default-agent marking. The only new work is making its trigger compact enough for header chrome.
- **The shared header gets a presentational trigger seam, not desktop logic:** `packages/ui` should gain a snippet/slot-like leading-control seam so desktop can inject an interactive trigger while website/demo consumers can continue using a static icon path.
- **`project_selection` becomes project-only:** the agent panel should use its content area to choose a project, while the header owns agent choice even before a session exists.
- **Panel-selected agent becomes the single effective agent for panel-local affordances:** once the header picker changes the panel agent, the header icon/label, composer-adjacent surfaces, and agent-sensitive actions such as PR generation should read from one derived effective agent instead of mixing `sessionAgentId`-first and `selectedAgentId`-first precedence.

## Open Questions

### Resolved During Planning

- **Should the recent default-agent requirements document be treated as the origin doc?** No. It is related context, but this request introduces new sidebar and panel-header surfaces that were not part of that scope.
- **Is external research needed?** No. The relevant decisions are all local UI/architecture seams with strong existing patterns in the repo.
- **Should the panel header picker introduce a new dropdown primitive?** No. Reuse `AgentSelector` and adapt its trigger styling for compact header chrome.
- **Where should browser/terminal actions live after removing the strip?** In the project header action row, revealed on hover and focus-within so keyboard access and discoverability both remain intact.
- **What happens to the agent panel's current pick-agent view?** Remove it. `ProjectSelectionPanel` remains responsible only for project selection, and any pre-session agent change happens in the header.

### Deferred to Implementation

- The exact compact trigger styling for the header picker (for example whether the chevron stays visible at all times or only on hover) can be finalized during implementation once it is rendered against the existing header chrome.

## Implementation Units

- [ ] **Unit 1: Replace sidebar strip behavior with direct spawn resolution**

**Goal:** Make the project-header `+` button a pure create action that always attempts direct session creation and no longer toggles `ProjectHeaderAgentStrip`.

**Requirements:** R1, R2

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/session-list/session-list-ui.svelte`
- Modify: `packages/desktop/src/lib/acp/components/session-list/session-list-logic.ts`
- Test: `packages/desktop/src/lib/acp/components/session-list/__tests__/resolve-default-agent-id.test.ts`
- Test: `packages/desktop/src/lib/acp/components/session-list/__tests__/session-list-project-actions.svelte.vitest.ts` (create)

**Approach:**
- Remove `projectPathShowingAgentStrip`, `handleProjectCreateButtonContextMenu`, and the header-swap rendering path from `session-list-ui.svelte`.
- Replace `resolveDefaultAgentIdForCreate` with an "effective spawn agent" helper that returns:
  1. the persisted default agent when it is still present in `availableAgents`
  2. otherwise the first available spawnable agent in `availableAgents`
  3. otherwise `undefined`, allowing the existing agent-less creation path to continue if the caller still supports it
- Update the `+` click handler to always call `handleCreateClick` directly with that resolved agent ID instead of entering a special sidebar UI state.
- Keep the change localized to sidebar creation flows so empty-state, kanban, and settings default-agent behavior remain untouched.

**Patterns to follow:**
- Default-agent fallback semantics from `docs/plans/2026-04-13-003-feat-default-agent-selection-plan.md`
- Existing pure helper pattern in `session-list-logic.ts`

**Test scenarios:**
- Happy path: clicking `+` with a valid saved default calls `onCreateSessionForProject(projectPath, defaultAgentId)`
- Edge case: saved default is missing from `availableAgents` and the first available agent is used instead
- Edge case: `availableAgents` is empty and creation falls back to `onCreateSessionForProject(projectPath)` without an agent ID
- Error path: right-clicking the `+` button no longer opens a special agent strip or alternate creation UI

**Verification:**
- Project-header creation always routes through a single direct-create path
- Sidebar creation still works when the saved default disappears

---

- [ ] **Unit 2: Move browser and terminal actions into project-header hover controls**

**Goal:** Surface browser and terminal launch actions directly in the project header so they no longer depend on the removed strip.

**Requirements:** R3, R6

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/session-list/session-list-ui.svelte`
- Modify: `packages/desktop/src/lib/messages.ts`
- Test: `packages/desktop/src/lib/acp/components/session-list/__tests__/session-list-project-actions.svelte.vitest.ts`

**Approach:**
- Render browser and terminal action buttons in the existing project-header action row for both loading and loaded project states.
- Hide these buttons by default and reveal them via the project header's existing `group` container on hover and focus-within so mouse and keyboard interaction stay aligned.
- Preserve the current `stopPropagation` boundaries so clicking terminal/browser actions does not toggle the project accordion or trigger session creation.
- Remove tooltip copy that advertises right-click strip behavior; replace it with direct-action wording that matches the new model.

**Patterns to follow:**
- Existing project-header action cell structure in `session-list-ui.svelte`
- Existing tooltip/button treatment for terminal and browser actions from `project-header-agent-strip.svelte`

**Test scenarios:**
- Happy path: clicking the hover-revealed terminal button calls `onOpenTerminal(projectPath)`
- Happy path: clicking the hover-revealed browser button calls `onOpenBrowser(projectPath)`
- Integration: clicking terminal/browser actions does not trigger project-header expand/collapse or session creation
- Edge case: if only one of terminal/browser callbacks is provided, only that action renders while spacing and hover behavior remain stable

**Verification:**
- Browser and terminal can be launched directly from the project header without entering a secondary strip state
- The project header remains keyboard-accessible and visually uncluttered at rest

---

- [ ] **Unit 3: Add an interactive agent picker seam to the shared panel header**

**Goal:** Allow the shared agent panel header to host an interactive agent trigger while preserving its presentational-only boundary, including during pre-session project-selection states.

**Requirements:** R4, R5

**Dependencies:** None

**Files:**
- Modify: `packages/ui/src/components/agent-panel/agent-panel-header.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-selector.svelte`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/agent-panel-header.project-style.svelte.vitest.ts`
- Test: `packages/desktop/src/lib/acp/components/__tests__/agent-selector.svelte.vitest.ts` (create)

**Approach:**
- Add an optional leading-control snippet/seam to the shared `AgentPanelHeader` so consumers can render an interactive trigger in the agent-icon position.
- Keep the existing static `agentIconSrc` fallback for contexts that do not need interaction (including website/demo fixtures and any desktop states without available agents).
- Extend `AgentSelector` with a compact trigger mode that uses the existing `Selector` styling hooks to fit header chrome without re-implementing dropdown behavior.
- Update the pending-project header layout so the agent trigger can still render alongside the "Select a project" state instead of disappearing behind the current pending-only shell.
- Preserve current accessibility semantics by keeping the trigger a real button with a meaningful label and visible focus behavior.

**Patterns to follow:**
- Slot/snippet-based runtime seams from the shared-panel extraction work
- `Selector` trigger styling contract in `packages/ui/src/components/selector/selector.svelte`

**Test scenarios:**
- Happy path: the compact selector trigger renders in the header and opening it reveals the available agents
- Happy path: when the panel is in `pendingProjectSelection`, the compact selector trigger is still available so the user can change agent before starting the session
- Edge case: fullscreen and close controls remain present and clickable when the compact picker is rendered
- Integration: selecting an item from the compact picker calls the provided `onAgentChange` callback

**Verification:**
- The panel header can host an interactive agent trigger without moving desktop store logic into `packages/ui`
- Existing static-icon consumers still render correctly

---

- [ ] **Unit 4: Remove the in-panel pick-agent view and make project selection project-only**

**Goal:** Remove embedded agent-picking from the panel content state so pre-session agent choice happens only in the header.

**Requirements:** R5, R7, R8

**Dependencies:** Units 1, 3

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/project-selection-panel.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-content.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/types/agent-panel-content-props.ts`
- Modify: `packages/desktop/src/lib/acp/logic/panel-visibility.ts`
- Test: `packages/desktop/src/lib/acp/logic/__tests__/panel-visibility.test.ts`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/agent-panel-content.svelte.vitest.ts`

**Approach:**
- Change `ProjectSelectionPanel` from a project-and-agent picker into a project-only selector.
- Remove the single-project agent grid and per-project card agent actions so project cards only choose/open projects.
- Rename or simplify the callback contract from `onProjectAgentSelected` to a project-only selection callback at the desktop boundary where helpful, so the content API matches the new responsibility.
- Update `panel-visibility.ts` so `project_selection` is entered only when project selection is needed, not because no agent is currently selected.
- Keep the current project metadata loading behavior intact; only the agent-selection branch of the view is removed.

**Patterns to follow:**
- Existing project-card and project-selection rendering patterns in `project-selection-panel.svelte`
- Existing view-kind tests in `panel-visibility.test.ts`

**Test scenarios:**
- Happy path: when a panel needs project selection, the content shows project cards without embedded agent actions
- Edge case: a panel with no selected agent but an already-chosen project no longer falls into `project_selection` just to force agent picking
- Integration: selecting a project from the simplified view still routes through the panel's project/session creation flow
- Edge case: single-preselected-project mode no longer renders an agent grid

**Verification:**
- The panel content no longer contains a dedicated agent-picking surface
- Project selection remains functional for pre-session panels

---

- [ ] **Unit 5: Wire the panel header picker through desktop agent state and clean up obsolete surfaces**

**Goal:** Make the panel header picker drive the panel's effective agent everywhere that matters, then remove obsolete sidebar strip and in-panel picker artifacts.

**Requirements:** R4, R6, R8

**Dependencies:** Units 1, 3, 4

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-header.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/types/agent-panel-header-props.ts`
- Modify: `packages/desktop/src/lib/components/main-app-view/logic/main-app-view-state.svelte.ts`
- Modify: `packages/desktop/src/lib/components/main-app-view/tests/main-app-view-state.vitest.ts`
- Delete: `packages/desktop/src/lib/acp/components/project-header-agent-strip.svelte`
- Delete: `packages/desktop/src/lib/acp/components/__tests__/project-header-agent-strip.test-harness.svelte`
- Delete: `packages/desktop/src/lib/acp/components/__tests__/project-header-agent-strip.svelte.vitest.ts`

**Approach:**
- Derive a single `effectivePanelAgentId` in `agent-panel.svelte`, preferring the current panel selection when present and falling back to the session agent only when no override exists.
- Use that effective agent for header icon/label state and the other panel-local call sites that currently mix `sessionAgentId`-first and `selectedAgentId`-first precedence (for example modified-files / PR flows and any other agent-sensitive actions in the panel).
- Pass `availableAgents`, `currentAgentId`, and `onAgentChange` through the desktop header wrapper so the new compact picker uses the existing `handlePanelAgentChange` path.
- Preserve the existing preference-persistence behavior in `handlePanelAgentChange`, including auto-selecting newly chosen spawnable agents so the header picker cannot put the panel into an invisible-agent state.
- Remove the no-longer-used strip component and its test harness once no callers remain.

**Patterns to follow:**
- Existing panel agent persistence flow in `main-app-view-state.svelte.ts`
- Existing header wrapper pattern in `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-header.svelte`

**Test scenarios:**
- Happy path: changing the header picker updates the panel's selected agent and the next agent-sensitive panel action uses that new effective agent
- Integration: choosing an agent that is not currently selected still routes through `handlePanelAgentChange` and persists it into `selectedAgentIds`
- Edge case: when no panel override exists, the header still reflects the session agent
- Edge case: when the selected override disappears from `availableAgents`, the header falls back gracefully instead of showing a broken trigger state

**Verification:**
- The agent shown in the panel header matches the agent the panel will use for its next agent-sensitive action
- No code path still references the removed project-header strip

## System-Wide Impact

- **Interaction graph:** project-header `+` → sidebar spawn resolver → `onCreateSessionForProject`; project-header hover actions → existing terminal/browser panel callbacks; panel-header picker → `onAgentChange` → `handlePanelAgentChange` → `panelStore.selectedAgentId`; project-selection content → project-only selection flow.
- **Error propagation:** invalid persisted default agent continues to degrade silently to a fallback spawnable agent; header agent changes keep using the existing persistence path and should not introduce new toasts or silent failures.
- **State lifecycle risks:** `sessionAgentId` and `selectedAgentId` can diverge after the header picker is added. The implementation should consolidate panel-local consumers on one derived effective agent to avoid mismatched UI and behavior.
- **API surface parity:** empty state, kanban, settings, and the agent selector's default-agent affordance remain unchanged; only the project-sidebar and panel-header entry points move, and the agent panel content loses its dedicated pick-agent affordance.
- **Integration coverage:** verify that browser/terminal launch buttons, panel header picker, project selection, modified-files actions, and session creation all continue to call the same underlying stores and managers as before.
- **Unchanged invariants:** `default_agent_id` remains a single global preference, project overflow/context menus stay intact, and browser/terminal panels still open through the existing panel-store APIs.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Panel-local surfaces keep using different agent precedence rules after the header picker lands | Introduce one derived effective panel agent in `agent-panel.svelte` and route all agent-sensitive call sites through it |
| Sidebar loading and loaded project-header branches drift because both currently duplicate action markup | Update both branches in the same unit and use a shared snippet/component if the duplication remains hard to reason about |
| Compact picker chrome crowds the header action row | Reuse the existing selector primitive and validate against the existing header test seam instead of inventing new layout rules ad hoc |
| Removing agent-gated `project_selection` changes panel-entry assumptions in multiple files | Update `panel-visibility`, `ProjectSelectionPanel`, and `AgentPanelContent` together and cover the transition with targeted tests |

## Documentation / Operational Notes

- No user-facing documentation update is required beyond tooltip/copy changes in the desktop UI.

## Sources & References

- Related brainstorm: `docs/brainstorms/2026-04-13-default-agent-selection-requirements.md`
- Related plan: `docs/plans/2026-04-13-003-feat-default-agent-selection-plan.md`
- Related plan: `docs/plans/2026-04-10-004-refactor-agent-panel-ui-extraction-reset-plan.md`
- Related code: `packages/desktop/src/lib/acp/components/session-list/session-list-ui.svelte`
- Related code: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte`
- Related code: `packages/desktop/src/lib/acp/components/agent-selector.svelte`
- Related code: `packages/desktop/src/lib/acp/components/project-selection-panel.svelte`
- Related code: `packages/desktop/src/lib/acp/logic/panel-visibility.ts`
