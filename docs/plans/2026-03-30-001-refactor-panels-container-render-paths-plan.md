---
title: "refactor: Reduce panels-container render-path duplication without breaking mount stability"
type: refactor
status: active
date: 2026-03-30
deepened: 2026-03-30
---

# PanelsContainer Render Path Refactor Plan

**Goal:** Remove duplicated panel prop derivation, event wiring, and project-group iteration in `panels-container.svelte` while preserving component identity across multi, project, single, explicit fullscreen, and aux-only fullscreen transitions.

**Architecture:** Treat layout and visibility as explicit render-state, not as raw template branching. Deduplicate panel renderers first, then unify only the wrapper logic that is genuinely shared. Keep the Git modal external and keep the aux-only terminal fullscreen carve-out unless mount-safety tests prove a safer alternative.

**Tech Stack:** Svelte 5, TypeScript, Bun tests, `@testing-library/svelte` for component-level mount verification

---

## Why the earlier CSS-only plan is too optimistic

- The two branches do not render identical props today. `AgentPanel` alone changes `hideProjectBadge`, `isFullscreen`, and the surrounding `ProjectCard` behavior between fullscreen and grouped modes.
- Fullscreen does not render “all the same panels with different CSS.” It renders one fullscreen agent plus at most one selected aux panel, while grouped mode renders all top-level file, review, browser, and terminal panels for each project.
- `ProjectCard` is not just decoration. In focused card mode it renders the project switcher badge column and click handlers, so wrapper choice carries behavior as well as styling.
- The current automated safety net is mostly source-level. It does not yet prove that `AgentPanel` or `TerminalTabs` stay mounted across mode changes.

## Scope and guardrails

- Preserve current semantics in `packages/desktop/src/lib/components/main-app-view/components/content/panels-container.svelte` for:
  - single mode
  - project mode
  - multi-project mode
  - explicit agent fullscreen
  - aux-only terminal fullscreen
- Preserve the current out-of-band Git rendering via `EmbeddedModalShell`
- Preserve keyed identity for `AgentPanel` and `TerminalTabs`; no refactor is acceptable if it causes remounts during mode switches
- Do not change `getViewModeState()` semantics unless a new helper exposes equivalent decisions more clearly
- Do not introduce new component boundaries around stateful panels unless tests prove they do not affect mounting
- Prefer local snippets or pure TypeScript helpers over new wrapper components in the first pass

## Success criteria

- `panels-container.svelte` has one authoritative path for agent-panel prop derivation and handler wiring
- Fullscreen aux rendering is centralized instead of duplicated inline
- Group visibility and wrapper decisions are computed from a tested render-state helper rather than being spread across template branches
- Terminal PTY-backed panels remain mounted across multi, project, single, and fullscreen transitions
- The project switcher, badge visibility rules, browser fill behavior, and aux-only fullscreen behavior remain unchanged
- `bun run check` passes in `packages/desktop`
- Targeted tests cover behavior, not just source snapshots

## Non-goals

- Reworking `view-mode-state.ts` into a broader layout engine
- Moving the Git panel into the normal panel flow
- Introducing new layout modes in the same change
- Forcing a single DOM tree if a smaller refactor removes most duplication without risking remounts

## Directional design

This matrix illustrates the intended approach and is directional guidance for review, not implementation specification.

| State | Visible groups | Wrapper shape | Agent treatment | Aux treatment |
|---|---|---|---|---|
| Multi | All groups | Project cards | Render all grouped agents | Render grouped top-level aux panels |
| Project | All groups mounted, one visible | Project cards with switcher | Render grouped agents for each group | Render grouped top-level aux panels |
| Single | One group | Bare fullscreen shell or project card when current semantics require it | Focused agent is fullscreen | Selected aux panel may appear beside the agent |
| Explicit agent fullscreen | One group | Fullscreen-focused shell | Chosen agent is fullscreen | Selected aux panel may appear beside the agent |
| Aux-only terminal fullscreen | All groups mounted, one visible | Existing grouped shell | Do not move agent panels into a new shell | Keep terminal on the grouped path unless tests prove a safe alternative |

## Implementation units

## Task 1: Add characterization and mount-safety tests first

**Files:**
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/panels-container.fullscreen-session-safety.test.ts`
- Add: `packages/desktop/src/lib/components/main-app-view/components/content/panels-container.component.test.ts`
- Follow pattern: `packages/desktop/src/lib/acp/components/agent-panel/__tests__/agent-panel-component.test.ts`

**Goal:** Lock down the behavioral invariants that the refactor must preserve before changing the template shape.

**Requirements advanced:**
- No behavioral regressions
- Panels stay mounted across mode switches
- Terminal PTY connections are not lost

**Dependencies:** None

**Approach:**
- Keep the existing source-level safety assertions, but narrow them to the specific null-safe snapshot guarantees they are meant to protect.
- Add one real component test that mocks `AgentPanel` and `TerminalTabs` with mount and destroy counters.
- Drive the container through these transitions:
  - multi to project
  - project to single
  - single to explicit fullscreen
  - explicit fullscreen back to cards
  - aux-only terminal fullscreen on and off
- Assert instance continuity by stable keys or mount counters instead of relying on visual assumptions.

**Patterns to follow:**
- Dynamic component import and module mocking from `packages/desktop/src/lib/acp/components/agent-panel/__tests__/agent-panel-component.test.ts`

**Test scenarios:**
- Focused agent panel remains mounted when project mode hides sibling groups.
- Fullscreen agent transitions do not create a second mount for the same panel id.
- Terminal group used for aux-only fullscreen does not unmount when fullscreen toggles on and off.
- Project switcher remains available only in focused card mode.
- Single-project mode does not require the project switcher shell.

**Verification:**
- The new component test fails on a real remount regression and passes on a purely structural refactor.

## Task 2: Extract render-state into a pure helper

**Files:**
- Add: `packages/desktop/src/lib/components/main-app-view/components/content/panels-container-render-state.ts`
- Add: `packages/desktop/src/lib/components/main-app-view/components/content/panels-container-render-state.test.ts`
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/panels-container.svelte`

**Goal:** Move visibility, wrapper, and fullscreen selection decisions out of the template so the remaining duplication is easier to remove safely.

**Requirements advanced:**
- Single source of truth for layout and visibility decisions
- Easier verification of wrapper semantics

**Dependencies:** Task 1

**Approach:**
- Introduce a pure helper that accepts the existing derived inputs:
  - `viewModeState`
  - `allGroups`
  - `fullscreenPanel`
  - `selectedFullscreenAuxPanel`
  - `fullscreenAuxPanel`
  - `auxOnlyTerminalProjectPath`
- Have it compute explicit outputs such as:
  - visible project paths
  - fullscreen group path
  - whether the container is in aux-only fullscreen
  - whether a group should use a project card wrapper
  - whether focused-mode switcher badges should render
  - whether a group uses the fullscreen-focused shell or the grouped shell
- Keep `getViewModeState()` as the source of single/project/multi semantics and make the new helper a container-level projection of that state.

**Patterns to follow:**
- Pure derivation style from `packages/desktop/src/lib/acp/logic/view-mode-state.ts`
- Table-driven tests from `packages/desktop/src/lib/components/main-app-view/components/content/panel-grouping.test.ts`

**Test scenarios:**
- Multi mode exposes all groups and no focused-mode switcher.
- Project mode exposes one visible group but keeps the rest mounted.
- Single mode resolves one fullscreen group from the focused agent fallback behavior.
- Explicit fullscreen agent wins over project mode card layout.
- Aux-only terminal fullscreen keeps grouped rendering semantics and narrows visibility to the terminal project.

**Verification:**
- The container template reads from named render-state booleans and paths instead of recomputing visibility logic inline.

## Task 3: Deduplicate panel renderers without changing wrapper topology

**Files:**
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/panels-container.svelte`

**Goal:** Remove the highest-risk duplication first while preserving the current wrapper structure.

**Requirements advanced:**
- Single authoritative `AgentPanel` wiring
- Shared aux-panel rendering logic

**Dependencies:** Task 2

**Approach:**
- Add local snippets or local helper functions inside `panels-container.svelte` for:
  - agent panel rendering
  - selected fullscreen aux rendering
  - grouped top-level file, review, browser, and terminal rendering
- Parameterize those snippets with explicit mode flags instead of trying to force identical props:
  - `isFullscreen`
  - `hideProjectBadge`
  - `isFullscreenEmbedded`
  - `isFillContainer`
  - wrapper-specific project metadata
- Keep the current top-level fullscreen and grouped wrapper branches intact in this task so the only change is deduplication, not layout topology.

**Patterns to follow:**
- Existing null-safe snapshot pattern in `panels-container.svelte`

**Test scenarios:**
- Fullscreen `AgentPanel` still uses snapshot-backed props.
- Grouped `AgentPanel` still hides the project badge and keeps focus and review handlers intact.
- File, review, and browser panels preserve their fullscreen-embedded flags only where they do today.
- Browser panels preserve fill-container behavior when a project has no agent panels.

**Verification:**
- The fullscreen branch and grouped branch call the same agent-rendering logic.
- Changes to shared handlers or prop derivation happen in one place.

## Task 4: Unify only the wrapper layer that is actually shared

**Files:**
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/panels-container.svelte`

**Goal:** Collapse the remaining duplicate group iteration and wrapper decisions only after Tasks 1 through 3 have made the risky pieces explicit and testable.

**Requirements advanced:**
- One authoritative group iteration path
- Reduced template duplication without hiding behavioral differences

**Dependencies:** Tasks 1 through 3

**Approach:**
- Replace the current fullscreen-or-grouped top-level split with one keyed group iteration only if the new mount-safety tests stay green.
- Let each group choose between explicit wrapper modes computed by the render-state helper:
  - hidden-mounted grouped shell
  - visible grouped project-card shell
  - fullscreen-focused shell
  - bare single-project shell when current semantics omit `ProjectCard`
- Keep special handling explicit where behavior is genuinely different:
  - aux-only terminal fullscreen
  - selected fullscreen aux panel semantics
  - Git modal outside the main group flow
- Do not attempt to render every aux panel in fullscreen mode. Preserve the current “one selected fullscreen aux panel” rule.

**Decision gate:**
- If wrapper unification causes mount churn, unstable tests, or complex template gymnastics, stop after Task 3 and land the deduplication work as the finished refactor.
- Full single-tree unification is optional. Reduced duplication with preserved invariants is the real success condition.

**Test scenarios:**
- Switching between cards and fullscreen does not change mount counts for the focused agent panel.
- Focused card mode still shows the project switcher badges and click handlers.
- Single-project mode still renders without an unnecessary `ProjectCard` wrapper.
- Aux-only terminal fullscreen still reuses the grouped terminal path.

**Verification:**
- There is one keyed group iteration in `panels-container.svelte` only if the component tests continue to prove stable mounting.

## Task 5: Cleanup, comments, and verification

**Files:**
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/panels-container.svelte`
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/panels-container.fullscreen-session-safety.test.ts`
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/panels-container.component.test.ts`
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/panels-container-render-state.test.ts`

**Goal:** Remove dead branches, document the new invariants, and prove the final behavior.

**Requirements advanced:**
- No dead code remains
- The refactor is understandable to the next maintainer

**Dependencies:** All prior tasks

**Approach:**
- Remove obsolete helper logic and comments that still describe the old dual-path structure.
- Add one short container comment that explains the architectural split between render-state and wrapper modes.
- Keep the verification set scoped to the changed area.

**Test scenarios:**
- `panels-container.fullscreen-session-safety.test.ts` covers snapshot-based null safety.
- `panels-container-render-state.test.ts` covers layout and visibility derivation.
- `panels-container.component.test.ts` covers mount continuity across mode changes.
- Existing `view-mode-state.test.ts` still passes unchanged unless the refactor explicitly changes the helper contract.

**Verification:**
- TypeScript check passes in `packages/desktop`.
- Scoped tests for the container and render-state helper pass.
- Manual validation confirms:
  - long-running terminal session survives mode changes
  - project switcher behavior is unchanged
  - fullscreen aux selection still behaves the same for file, review, terminal, browser, and git surfaces

## Risks and mitigations

- **Risk:** Wrapper changes remount `AgentPanel` or `TerminalTabs`.
  **Mitigation:** Add mount-counter tests before refactoring and use them as a hard gate.

- **Risk:** A “single loop” refactor obscures real behavior differences and makes the template harder to understand.
  **Mitigation:** Move decisions into named render-state and keep wrapper modes explicit.

- **Risk:** The refactor changes project switcher or badge visibility semantics while chasing deduplication.
  **Mitigation:** Treat wrapper behavior as a first-class invariant and test it directly.

- **Risk:** The team spends too much effort chasing a perfect one-tree solution for marginal benefit.
  **Mitigation:** Stop after Task 3 if that already removes the meaningful duplication safely.

## Completion criteria

- The container has one authoritative place for agent-panel wiring
- Render-state is testable without reading the Svelte template as a string
- Mount continuity is covered by at least one component-level test
- Wrapper behavior remains explicit where it carries real semantics
- The implementation can stop at the smallest change set that achieves these outcomes safely