---
title: "fix: Unify single-mode agent fullscreen state"
type: fix
status: active
date: 2026-03-31
---

# Single Mode Agent Fullscreen State Plan

**Goal:** Collapse agent "single" mode and agent fullscreen onto one state machine so agent fullscreen is driven by `viewMode === "single"` plus `focusedPanelId`, while `fullscreenPanelId` remains reserved for auxiliary fullscreen surfaces such as terminals, browsers, files, and review panels.

**Problem frame:** The desktop app currently represents agent fullscreen in two places: `viewMode === "single"` and `fullscreenPanelId`. That split leaks into restore, focus transitions, and keyboard handling. The result is inconsistent behavior where agent fullscreen selection, single-mode layout, and persisted fullscreen state can drift apart.

**Invariants for this change:**
- `viewMode === "single"` is the only fullscreen state for agent panels.
- In single mode, the visible agent is resolved from the focused top-level agent panel; if focus is stale, fall back to the first remaining agent; if no agents remain, exit single mode.
- `fullscreenPanelId` is reserved for auxiliary fullscreen surfaces only.

**Scope boundaries:**
- Fix the agent single/fullscreen state model.
- Preserve aux-only fullscreen behavior for terminal, browser, file, review, and git surfaces.
- Do not redesign labels or move controls in this change.
- Do not remove `fullscreenPanelId` entirely in this change.

**Success criteria:**
- Agent fullscreen no longer requires `fullscreenPanelId`.
- Entering single mode on an agent focuses the agent and uses `viewMode === "single"` as the only fullscreen signal for agent layout.
- Restoring a workspace in single mode uses focused panel restore, not agent fullscreen index restore.
- Aux fullscreen behavior and tests remain intact.

## Implementation Units

- [ ] **Unit 1: Capture the broken contract with failing tests**
  - **Goal:** Lock in the desired separation between agent single mode and aux fullscreen before changing logic.
  - **Requirements:** Protect the new single-mode invariant and preserve aux fullscreen behavior.
  - **Dependencies:** None.
  - **Files:**
    - `packages/desktop/src/lib/components/main-app-view.svelte`
    - `packages/desktop/src/lib/components/main-app-view/tests/main-app-view-state.vitest.ts`
    - `packages/desktop/src/lib/acp/logic/__tests__/view-mode-state.test.ts`
    - `packages/desktop/src/lib/acp/store/__tests__/workspace-fullscreen-migration.test.ts`
  - **Approach:** Add characterization tests asserting that agent single mode is driven by focused panel selection, while aux fullscreen still uses `fullscreenPanelId`.
  - **Execution note:** Start with failing tests.
  - **Patterns to follow:** Existing focused/single-mode tests and workspace restore migration tests.
  - **Test scenarios:**
    - Toggling agent fullscreen enters `viewMode === "single"` without requiring `fullscreenPanelId`.
    - `getViewModeState()` resolves the fullscreen agent from `focusedPanelId` in single mode.
    - Keyboard-driven single-mode entry and panel switching continue to follow the single-mode invariant.
    - Workspace restore in single mode preserves the focused agent without restoring agent fullscreen through `fullscreenPanelId`.
    - Aux fullscreen restore still preserves a terminal fullscreen target.
  - **Verification:** New tests fail on current code and describe the intended invariant clearly.

- [ ] **Unit 2: Collapse the agent single-mode state machine**
  - **Goal:** Make agent single mode use one source of truth.
  - **Requirements:** Remove agent dependence on `fullscreenPanelId` while preserving current aux fullscreen semantics.
  - **Dependencies:** Unit 1.
  - **Files:**
    - `packages/desktop/src/lib/acp/store/panel-store.svelte.ts`
    - `packages/desktop/src/lib/components/main-app-view.svelte`
    - `packages/desktop/src/lib/components/main-app-view/logic/main-app-view-state.svelte.ts`
    - `packages/desktop/src/lib/acp/logic/view-mode-state.ts`
  - **Approach:** Route agent fullscreen entry/exit through `viewMode` and `focusedPanelId`; keep `fullscreenPanelId` for aux surfaces only. Remove agent-only fallback paths that rely on `fullscreenPanelId`.
  - **Patterns to follow:** Existing view-mode derivation helpers and panel-store top-level panel handling.
  - **Test scenarios:**
    - Opening or focusing an agent while in single mode keeps the single-mode agent aligned to `focusedPanelId`.
    - Closing the focused single-mode agent selects the next remaining agent; if none remain, the app exits single mode.
    - Entering aux fullscreen while not in single mode does not change `viewMode`.
    - Keyboard and urgency-jump entry points switch the focused single-mode agent without repopulating `fullscreenPanelId` for agents.
  - **Verification:** Single-mode agent rendering and transitions no longer depend on `fullscreenPanelId`.

- [ ] **Unit 3: Reconcile persistence and restore behavior**
  - **Goal:** Persist and restore the new invariant without regressing legacy fullscreen behavior.
  - **Requirements:** Agent single-mode restore uses focused panel state; aux fullscreen restore still works.
  - **Dependencies:** Units 1 and 2.
  - **Files:**
    - `packages/desktop/src/lib/acp/store/workspace-store.svelte.ts`
    - `packages/desktop/src/lib/acp/store/__tests__/workspace-fullscreen-migration.test.ts`
  - **Approach:** Persist aux fullscreen index only for aux targets; rely on focused panel plus `viewMode === "single"` for agent fullscreen restore.
    Legacy persisted state for this task means any previously saved workspace where `fullscreenPanelIndex` points at an agent top-level panel. Restore should interpret that as single-mode intent, migrate to focused-panel-driven single mode, and avoid reintroducing agent dependence on `fullscreenPanelId`.
  - **Patterns to follow:** Existing workspace restore compatibility paths and migration tests.
  - **Test scenarios:**
    - Agent single-mode restore does not repopulate `fullscreenPanelId`.
    - Legacy saved fullscreen agent state still restores into single mode correctly.
    - Aux fullscreen restore still sets `fullscreenPanelId` for terminals.
  - **Verification:** Restore paths enforce the new invariant across both legacy and current persistence formats.

## Risks and Mitigations

- **Risk:** Aux fullscreen regressions for terminals or browsers.
  **Mitigation:** Keep `fullscreenPanelId` behavior unchanged for non-agent surfaces and preserve terminal fullscreen tests.

- **Risk:** Single-mode close/focus transitions strand the app in single mode without an agent.
  **Mitigation:** Add targeted close-path coverage before refactoring those branches.

- **Risk:** Legacy workspace restore paths still assume agent fullscreen index persistence.
  **Mitigation:** Update migration tests alongside restore changes rather than treating persistence as follow-up work.