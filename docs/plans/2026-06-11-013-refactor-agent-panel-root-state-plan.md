---
status: active
type: refactor
created: 2026-06-11
document_reviewed: 2026-06-11
god_gate: not-required
origin: architecture-review (improve-codebase-architecture 2026-06-11 run 2, candidate 5)
---

# refactor: AgentPanelRootState — a testable composition root for the agent-panel Controller

## Summary

`agent-panel.svelte` (1,998 LOC) instantiates **15 controllers** across ~650 lines of script before any markup, wiring them with accessor-closure dependencies and thin reactive aliases. The controllers themselves are well-factored (13 have dedicated vitest suites); their *composition* is not — it lives inline in the component, untestable without rendering, and every controller-dependency change edits the component. Extract the instantiation and cross-controller wiring into an `AgentPanelRootState` class (`.svelte.ts`), making the component a markup-and-handlers shell. This is the declared end-state of the controller extractions already landed on `refactor/retire-agent-panel-display-model`.

**Precondition:** this plan targets the tree *after* that branch lands. Do not start it mid-branch.

---

## Problem Frame

Verified controller instantiations in `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte`:

| Line | Controller |
|---|---|
| 176 | `AgentPanelSessionController` |
| 188 | `ConnectionController` |
| 249 | `AgentPanelState` (local UI: drag, dialog) |
| 250 | `createPanelBranchLookupController()` |
| 261 | `AgentPanelLayoutController` |
| 278 | `ContentScrollRevealController` |
| 284 | `CheckpointTimelineController` |
| 337–339 | `WorktreeSetupController`, `WorktreeCloseConfirmationController`, `AgentPanelWorktreeController` |
| 416 | `AgentPanelViewStateController` |
| 624 | `AgentPanelScenePipelineController` |
| 697, 792 | `PrCardController`, `ReviewDialogController` |

Plus 66 destructured props, ~22 accessor-closure wirings, mutual references resolved lazily (e.g. `sessionController ↔ connection` via `getStillFailed`), and hoisted "thin reactive alias" derivations with deferred-inlining comments. The component-level test (`agent-panel-component.test.ts`) must mock 18 modules to exercise any of this wiring.

The repo already has the template: the deterministic transcript viewport controller (`docs/solutions/architectural/deterministic-transcript-viewport-controller-2026-05-13.md`) made one pure-TS policy owner where "the Svelte component only builds compact row summaries, sends typed events, and schedules returned effects." This plan applies the same shape one level up.

---

## Requirements

- R1. All controller instantiation and cross-controller accessor wiring moves into one `AgentPanelRootState` class constructed from the component's props/stores.
- R2. The component's script shrinks to: prop destructuring, one root-state construction, event handlers, and template-local UI state; target ≤ ~500 LOC total.
- R3. The root state is unit-testable without rendering: construct with stub deps, assert composed derivations and cross-controller flows.
- R4. Existing per-controller vitest suites pass unchanged — controllers' own interfaces do not change.
- R5. No behavior change: every snippet, prop passed to children, and handler outcome is preserved.
- R6. Svelte 5 discipline holds: no `$effect` introduced; snippet definitions remain unconditional; async handlers snapshot live values.

---

## Scope Boundaries

**Not changing:**
- Any controller's own interface or file (they were just extracted; churn would fight the branch).
- Child components' prop contracts (`agent-panel-content.svelte`, `agent-panel-header.svelte`, …) — granular-props-vs-scene-model is a separate design question.
- The scene pipeline itself (materializer/reveal/token-reveal — plans 005/014 territory).
- `@acepe/ui` package contents.

### Deferred to Follow-Up Work
- Passing the composed scene model to children instead of granular props (re-evaluate after this plan makes the composition visible in one place).
- Inlining the "thin reactive alias" layer (the deferred-inlining comments) — fold into this work only where aliases become root-state fields naturally.

---

## Context & Research

### Relevant Code and Patterns
- `agent-panel/components/agent-panel.svelte` — lines 135–650: props, controllers, accessor wiring, aliases, hooks.
- `agent-panel/state/*.svelte.ts` — 15 controllers; `agent-panel-session-controller.svelte.ts` (11.7K) and `agent-panel-worktree-controller.svelte.ts` (12.3K) are the big ones.
- `agent-panel/state/__tests__/` — 13 per-controller vitest suites; the accessor-stub construction pattern to reuse for the root state.
- Branch prior art (`refactor/retire-agent-panel-display-model`): `84d0784` view-state, `e7f010d` worktree, `48cee5c` layout, `dd42d4b` scene-pipeline extractions — each moved a cluster out; this plan moves the *wiring*.
- Template: `docs/solutions/architectural/deterministic-transcript-viewport-controller-2026-05-13.md` — pure-TS owner, component as shell.

### Institutional Learnings
- `docs/solutions/best-practices/reactive-state-async-callbacks-svelte-2026-04-15.md` — accessor closures are deliberately live; async work must snapshot at await boundaries (P1 data-corruption precedent).
- `docs/solutions/best-practices/svelte5-unconditional-snippet-props-2026-04-12.md` — never wrap `{#snippet}` in `{#if}` while restructuring the render tree (five components went invisible once).
- `docs/solutions/best-practices/agent-panel-content-viewport-reactivity-renderer-2026-05-01.md` — `bun run check` misses Svelte component type errors; use `check:svelte` with before/after baselines. Derive streaming identity from the current scene snapshot; never cache it in store state.
- `docs/solutions/ui-bugs/agent-panel-composer-split-brain-canonical-actionability-2026-04-30.md` — the root state must not add a second actionability derivation; `deriveCanonicalAgentPanelSessionState` remains the only authority.
- `docs/solutions/test-failures/bun-module-mock-cache-leakage-2026-04-25.md` — root-state tests use constructor stubs, not `mock.module`.

---

## Key Technical Decisions

- **`AgentPanelRootState` is a `.svelte.ts` class** (runes-capable for `$derived` composition), constructed once in the component with a deps object of accessor closures over props/stores — the same pattern every controller already uses, applied at the next level.
- **Controllers become `readonly` fields; wiring is constructor work.** Mutual references keep the lazy-accessor resolution, now private to the root state.
- **The "thin reactive alias" layer migrates into root-state deriveds** where aliases exist only to feed the template; aliases that exist for the deferred-inlining plan get resolved per that plan's comments rather than copied.
- **Event handlers stay in the component** when they are DOM-shaped (drag, dialog open); they call root-state methods for anything stateful. The component is View-adjacent Controller shell; the root state is the Controller's brain.
- **One construction site, no singleton.** The root state is per-panel-instance, owned by the component, like every controller today.

---

## Implementation Units

### U1. Baseline: component behavior pins and type-check baselines

**Goal:** Safety net before moving ~500 lines of wiring.
**Requirements:** R5
**Dependencies:** branch `refactor/retire-agent-panel-display-model` fully landed
**Files:**
- Test: `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/agent-panel-component.test.ts` (audit/extend)

**Approach:** Verify the component test covers the cross-controller flows about to move (session-controller ↔ connection mutual wiring, scene-pipeline feed, worktree trio interplay). Capture `bun run check:svelte` baseline. Pin any wiring-order-sensitive behavior found in the 22 accessor wirings.
**Execution note:** Characterization-first.
**Test scenarios:**
- Connection-failure → `stillFailed` → session-controller derivation flow observable through rendered output.
- Scene pipeline receives viewport/view-state inputs in the current order (pin via rendered scene snapshot for a fixture session).
- Worktree setup → close-confirmation interplay produces today's dialog sequencing.

**Verification:** Pins green; baselines recorded.

### U2. Create `AgentPanelRootState` and move instantiation + wiring

**Goal:** The composition becomes a class; the component constructs one object.
**Requirements:** R1, R3, R6
**Dependencies:** U1
**Files:**
- Create: `packages/desktop/src/lib/acp/components/agent-panel/state/agent-panel-root-state.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/state/__tests__/agent-panel-root-state.vitest.ts`

**Approach:** Move the 15 instantiations and their deps objects verbatim into the class constructor; component props feed a single root deps object of accessors. Controllers exposed as `readonly` fields so the template's existing `sessionController.x` reads become `root.sessionController.x` (mechanical rename). No alias migration yet — smallest possible behavior-preserving move.
**Test scenarios:**
- Root state constructs with stub deps; every controller field is initialized; no construction-order throw.
- Mutual wiring works without render: stub connection failure → `root.sessionController.stillFailed` propagates.
- Component test from U1 green with the root state in place.

**Verification:** Zero controller `new` expressions remain in the component; `check:svelte` baseline unchanged.

### U3. Migrate composed derivations and reactive aliases into the root state

**Goal:** The template reads named root-state deriveds instead of hoisted aliases.
**Requirements:** R2, R3, R6
**Dependencies:** U2
**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/state/agent-panel-root-state.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte`

**Approach:** Move the ~20 reactive aliases and composed `$derived` blocks into root-state fields, honoring the deferred-inlining comments (inline where they said to inline; otherwise carry over as named deriveds). The actionability derivation remains a pass-through of `deriveCanonicalAgentPanelSessionState` — no re-derivation.
**Test scenarios:**
- Root-state unit: composed scene-model derived recomputes when a stubbed controller input changes.
- Grep-level check as test guard: no `canonical ?? hot` patterns introduced (mirror the composer split-brain clearance).

**Verification:** Component script contains no `$derived` chains over multiple controllers; suite + component test green.

### U4. Slim the component to shell; final clearance

**Goal:** Markup, handlers, template-local UI state only.
**Requirements:** R2, R5, R6
**Dependencies:** U3
**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte`

**Approach:** Sweep remaining script: DOM-shaped handlers stay, stateful logic moves to root-state methods. Verify all snippet definitions remain unconditional during the restructure. Compare `check:svelte` against the U1 baseline.
**Test scenarios:**
- Full component test green; `panel-click-interference.test.ts` green.
- Manual QA via `acepe-dev-app-qa` skill: open a session panel, stream a response, run the worktree setup flow, open PR card — visually unchanged.

**Verification:** Component ≤ ~500 LOC; `check:svelte` not worse than baseline; per-controller suites untouched and green (R4).

---

## System-Wide Impact

- **Per-controller tests and controllers** — untouched (R4).
- **Plan 011 (panel-store sub-stores)** — both touch panel-store *consumption*; soft coordination only (don't land U5 there and U2 here simultaneously without rebase).
- **Plan 014 (conversation builder)** — scene pipeline internals; the root state consumes `AgentPanelScenePipelineController`'s existing interface, so no hard ordering constraint. Rebase if 014 U3 relocates scene-pipeline import paths while 013 U2–U4 are in flight.
- **Future child-component scene-model adoption** — unblocked by having the composition named in one place.

---

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| In-flight branch makes line anchors stale | Precondition: start only after the branch lands; U1 re-verifies the instantiation inventory |
| Construction-order sensitivity among 15 controllers | U2 moves wiring verbatim, preserving order; root-state unit test pins construction |
| Silent snippet-prop loss during render-tree restructure | U4 explicitly audits unconditional snippet definitions; manual QA pass |
| Svelte-only type errors invisible to `bun run check` | `check:svelte` baseline from U1 compared at every unit |
| Live accessor values read after await in moved handlers | Snapshot-before-await rule applied during U4 handler sweep |

---

## Sources & References

- Architecture review 2026-06-11 run 2, candidate 5
- `docs/solutions/architectural/deterministic-transcript-viewport-controller-2026-05-13.md` (the template)
- Branch `refactor/retire-agent-panel-display-model` extraction commits
- Related plans: `2026-06-11-011` (soft coordination), `2026-06-11-005`/`-014` (scene pipeline, no ordering constraint)
