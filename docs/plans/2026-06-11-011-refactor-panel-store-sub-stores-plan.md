---
status: completed
type: refactor
created: 2026-06-11
document_reviewed: 2026-06-11
god_gate: not-required
origin: architecture-review (improve-codebase-architecture 2026-06-11 run 2, candidate 3)
---

# refactor: Decompose PanelStore into composed sub-stores

## Summary

`panel-store.svelte.ts` (2,898 LOC, ~165 methods) is the next god reactive store after `SessionStore`: nine state clusters (workspace chrome, agent panels, hot-state/suppression, worktree cards, file panels, review, git, browser, terminal) share one class with no seams between them. Apply ADR-0002 verbatim — pure helpers are already partially extracted; decompose the reactive state into sub-stores owning disjoint slices, with `PanelStore` as the composition root delegating one-line and passing cross-slice reads as accessor-closure dependencies. The external contract (50 importing files) does not change.

---

## Problem Frame

The interface is nearly as wide as the implementation: a caller adding a panel-lifecycle behavior must understand open/close/focus/index-sync paths spread across 2,898 lines. State clusters and approximate method counts (verified):

| Cluster | Fields | ~Methods |
|---|---|---|
| Workspace/view chrome | `workspacePanels`, `focusedPanelId`, `fullscreenPanelId`, `viewMode`, … | ~20 |
| Agent panels | `topLevelAgentPanelList` + 4 indexes (`byId`, `bySessionId`, `byProject`, refs) | ~30 |
| Hot-state & suppression | `hotState: SvelteMap<string, PanelHotState>`, suppression/live-session signals, drafts | ~15 |
| Worktree cards | pending/prepared worktree state on agent panels | ~5 |
| File panels | 9 indexes (`filePanelByCacheKey`, `byId`, owner-attachment, active-id maps, …) | ~22 |
| Review panels | `reviewPanelByIdIndex`, `byProjectPath`, `pendingReviewRestores` | ~15 |
| Git | `gitPanelById`, `byProjectPathIndex`, `gitDialog` | ~4 |
| Browser | `browserPanelsByProject`, `byId` | ~5 |
| Terminal | `terminalPanelGroupById`, `groupsByProject`, `terminalTabs` (largest cluster, lines ~2220–2731) | ~28 |

Test reality: 5 dedicated `panel-store-*.vitest.ts` files plus adjacent persistence suites each import the whole store to exercise one cluster. Adding a new panel type means editing the one file to wire ~10 accessors and ~5 indexes.

ADR-0002 exists precisely for this shape, and the `SessionStore` decomposition (plan `2026-06-08-002`, completed) proved the pattern: sub-store classes owning disjoint `$state`/`SvelteMap` slices, parent as composition root, accessor-closure dependencies, behavioral test net first.

---

## Requirements

- R1. Each state cluster lives in exactly one sub-store class owning its `$state`/`SvelteMap` fields and the methods over them; no field owned by two stores (ADR-0002 disjointness).
- R2. `PanelStore`'s public interface is preserved as one-line delegations; zero churn across the 50 importing files.
- R3. Cross-slice reads flow through accessor-closure dependencies, never dual-ownership.
- R4. Sub-stores are independently unit-testable with stub deps; cluster tests stop importing the full store.
- R5. No sub-store re-derives session actionability or lifecycle locally — session-state reads go through canonical accessors (`session-summary.ts` helpers, `deriveCanonicalAgentPanelSessionState`).
- R6. Behavioral test net green between every extraction; persistence round-trips (`getPersistable*` / restore) unchanged.

---

## Scope Boundaries

**Not changing:**
- The `PanelStore` external contract or any consumer file.
- `SessionTransientProjection`'s closed seven-field allowlist (must not widen — see learnings).
- Panel persistence schema or `restoreWorkspacePanels` semantics.
- Already-extracted pure helpers (`panel-store-array-patches.ts`, `panel-store-equality.ts`) — they stay free functions.

### Deferred to Follow-Up Work
- Splitting `PanelHotState` itself by concern (drafts vs. sidebar expansion vs. terminal drawer) — only if the hot-state sub-store still feels monolithic after extraction.
- A `ContextPanel`-style new panel type as the pattern's first consumer — separate feature work.

---

## Context & Research

### Relevant Code and Patterns
- `packages/desktop/src/lib/acp/store/panel-store.svelte.ts` — clusters per the table; key methods: `openSession:1163`, `getHotState:1001`, `openFilePanel:1915`, `enterReviewMode:1634`, `openReviewPanel:2129`, `openGitDialog:2742`, terminal cluster `:2220–2731`.
- **Template:** `store/session-list-state.svelte.ts`, `store/session-projection-core.svelte.ts`, `session-creation-coordinator.svelte.ts`, `pr-link-state-store.svelte.ts` — sub-store doc-header style (names the slice, cites ADR-0002, carries a GOD note).
- Completed plan `docs/plans/2026-06-08-002-refactor-session-store-class-decomposition-plan.md` — sequencing precedent.
- Key consumers by cluster: `main-app-view/logic/managers/{panel-handler,session-handler,keybinding-manager,initialization-manager}.ts`, `agent-panel/state/agent-panel-{worktree,layout}-controller.svelte.ts`, `agent-input/state/agent-input-state.svelte.ts`, command-palette hooks.
- Tests: `store/__tests__/panel-store-{background-open,file-panel-activation,terminal-fullscreen,terminal-groups,workspace-panels}.vitest.ts` + `workspace-*-persistence` suites.

### Institutional Learnings
- ADR-0002 — the binding decomposition shape, including the documented failure mode: free-function-style extraction broke 7 invariant tests coupled to internal field paths. **Rewrite path-coupled tests behaviorally before extracting.**
- `docs/solutions/architectural/canonical-projection-widening-2026-04-28.md` — parity-test pattern as decomposition safety net; grep clearance scans as exit criteria; closed transient-projection allowlist.
- `docs/solutions/ui-bugs/agent-panel-composer-split-brain-canonical-actionability-2026-04-30.md` — one actionability derivation; no `canonical ?? hotState` fallbacks in any sub-store.
- `docs/solutions/best-practices/canonical-session-projection-ui-derivation-2026-05-01.md` — sub-stores consuming session state go through `session-summary.ts` accessors.
- `docs/solutions/test-failures/bun-module-mock-cache-leakage-2026-04-25.md` — module moves shift mock interception; prefer DI over `mock.module`.
- `docs/solutions/best-practices/agent-panel-content-viewport-reactivity-renderer-2026-05-01.md` — run `bun run check:svelte`, not just `bun run check`, and compare error baselines.

---

## Key Technical Decisions

- **Extraction order: lowest-coupling, highest-mass first.** Terminal → file → review/git/browser (one unit, three small sub-stores) → agent panels (+ worktree cards) → hot-state/suppression. Workspace chrome (focus, fullscreen, view mode) stays on the composition root — it is the cross-cutting policy that earns the spine.
- **Worktree-card methods ride with the agent-panel sub-store** — they mutate fields on agent panel objects; separating them would split one slice's writers.
- **Hot-state is one sub-store including suppression signals and drafts** — they share the per-panel-keyed lifecycle. Internal split deferred (see Scope).
- **Derived cross-cluster reads** (`panelBySessionId`, `focusedPanel`, counts) stay on the root, computed via sub-store accessors — they are reads over multiple slices, which is exactly the composition root's job.
- **Behavioral-net-first per ADR-0002 rule 5.** U1 baselines before any motion; every subsequent unit keeps it green.

---

## Implementation Units

### U1. Baseline a behavioral test net and de-couple path-coupled tests

**Goal:** Make the existing suites safe to refactor under.
**Requirements:** R6
**Dependencies:** none
**Files:**
- Test: `packages/desktop/src/lib/acp/store/__tests__/panel-store-*.vitest.ts` (audit/rewrite)
- Test: `packages/desktop/src/lib/acp/store/__tests__/workspace-panels-persistence.test.ts` and siblings (audit)

**Approach:** Audit all panel-store-touching tests for assertions on internal field paths (the ADR-0002 failure mode). Rewrite those behaviorally (assert via public accessors and observable effects). Add a persistence parity pin: build a representative workspace (agent + file + review + terminal panels, hot-state, fullscreen), round-trip `getPersistable*` → restore, compare all public accessors.
**Execution note:** Characterization-first; no production code changes in this unit.
**Test scenarios:**
- Persistence round-trip parity across all clusters (the decomposition safety net, mirroring the canonical-projection parity pattern).
- Open-session → panel focus → close → index consistency observed via public accessors only.
- Capture current `bun run check:svelte` error baseline for later comparison.

**Verification:** No test asserts on private field paths; parity pin green.

### U2. Extract the terminal panel sub-store

**Goal:** Largest, most self-contained cluster first (~28 methods, ~500 lines).
**Requirements:** R1, R2, R3, R4
**Dependencies:** U1
**Files:**
- Create: `packages/desktop/src/lib/acp/store/panel-terminal-state.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/panel-store.svelte.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/panel-store-terminal-groups.vitest.ts`, `panel-store-terminal-fullscreen.vitest.ts` (re-point at sub-store where cluster-local)

**Approach:** Move `terminalPanelGroupById`, `terminalPanelGroupsByProject`, `terminalPanelGroups`, `terminalTabs` plus their methods. Cross-slice needs (focused panel, project paths) come in as accessor closures. Root delegates one-line. Doc header names the slice and cites ADR-0002.
**Test scenarios:**
- Existing terminal-group and terminal-fullscreen suites pass unchanged through the root (delegation pin).
- New sub-store unit test: group create/attach/close with stub accessors — no `PanelStore` import.

**Verification:** Terminal fields exist only on the sub-store; suites green; `bun run check` + `check:svelte` baseline unchanged.

### U3. Extract the file panel sub-store

**Goal:** The 9-index file cluster (~22 methods) behind one slice.
**Requirements:** R1, R2, R3, R4
**Dependencies:** U2
**Files:**
- Create: `packages/desktop/src/lib/acp/store/panel-file-state.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/panel-store.svelte.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/panel-store-file-panel-activation.vitest.ts` (re-point cluster-local cases)

**Approach:** Move all `filePanel*` / `attachedFilePanelsByOwnerPanelId` / `activeFilePanelIdByOwnerPanelId` / `pendingOwnerPanelWidthEnsures` state and methods (`openFilePanel` … `setActiveFilePanelMap`). Owner-panel reads (agent panel existence, widths) via accessor closures.
**Test scenarios:**
- File-panel activation suite green through the root.
- Sub-store unit: open by cache key twice → single panel, activation switches; owner close → attached file panels resolve per current behavior (pin whatever U1 captured).

**Verification:** File-panel fields only on the sub-store; index-sync invariants hold via existing suites.

### U4. Extract review, git, and browser sub-stores

**Goal:** Three small workspace-surface slices in one pass.
**Requirements:** R1, R2, R3, R4
**Dependencies:** U3
**Files:**
- Create: `packages/desktop/src/lib/acp/store/panel-review-state.svelte.ts`
- Create: `packages/desktop/src/lib/acp/store/panel-git-state.svelte.ts`
- Create: `packages/desktop/src/lib/acp/store/panel-browser-state.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/panel-store.svelte.ts`

**Approach:** Mechanical application of the now-proven pattern. `enterReviewMode` (which crosses review + workspace chrome) stays on the root, composed from sub-store calls.
**Test scenarios:**
- Review restore pending/consume cycle unchanged.
- Git dialog open/close and legacy-panel close unchanged.
- Browser panel per-project open/focus unchanged.
- One sub-store unit test each with stub deps.

**Verification:** Three slices disjoint; suites green.

### U5. Extract the agent panel sub-store (with worktree cards)

**Goal:** The highest-risk slice — agent panel list, 4 indexes, lifecycle, worktree card state.
**Requirements:** R1, R2, R3, R4, R5
**Dependencies:** U4
**Files:**
- Create: `packages/desktop/src/lib/acp/store/panel-agent-state.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/panel-store.svelte.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/panel-store-background-open.vitest.ts`, `panel-store-workspace-panels.vitest.ts` (the 35K suite — must stay green through the root)

**Approach:** Move list + `byId`/`bySessionId`/`byProject`/refs indexes, `openSession`/`materializeSessionPanel`/`spawnPanel`/`closePanel`/`updatePanelSession`/index-sync privates, and the worktree-card setters. Focus/fullscreen ordering decisions remain root policy invoked around sub-store mutations. GOD note in the doc header: this slice holds panel-shaped UI state; session truth stays in canonical projections — no `canonical ?? hotState` fallback, no local actionability derivation (R5).
**Test scenarios:**
- Background-open suite and the 35K workspace-panels suite green through the root (primary gate).
- Sub-store unit: open session → indexes consistent; close → all four indexes drop the panel; session-id remap (`updatePanelSession`) keeps `bySessionId` coherent.
- Worktree pending/prepared set/clear cycles unchanged.

**Verification:** Agent-panel fields only on the sub-store; `rg 'canonical \?\? hot' packages/desktop/src/lib/acp/store/` clean.

### U6. Extract the hot-state & suppression sub-store; final root slim-down

**Goal:** Last slice out; root becomes composition root + workspace chrome + cross-slice deriveds.
**Requirements:** R1, R2, R3, R4, R6
**Dependencies:** U5
**Files:**
- Create: `packages/desktop/src/lib/acp/store/panel-hot-state.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/panel-store.svelte.ts`

**Approach:** Move `hotState`, suppression/live-session signals, drafts, pending entries/restores, sidebar/drawer expansion. Then sweep the root: every remaining method is either a one-line delegation, workspace-chrome policy, or a cross-slice derived. Grep clearance pass.
**Test scenarios:**
- Draft set/get and pending-composer-restore consume-once semantics unchanged.
- Auto-session suppression sync/clear cycle unchanged.
- Full persistence parity pin from U1 still green (end-to-end gate).

**Verification:** `panel-store.svelte.ts` reads as a composition root (~400–600 LOC); zero consumer files changed (`git diff --stat` outside `store/` is empty except tests); `bun run check:svelte` error baseline not worse than U1's capture.

---

## System-Wide Impact

- **50 importing files** — untouched by construction (R2).
- **Plan 013 (AgentPanelRootState)** — reads `panelStore` through the same public interface; no ordering constraint, but avoid landing U5 here and 013's wiring unit in the same week without a rebase plan.
- **Persistence** — round-trip pinned in U1; schema untouched.

---

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| Tests coupled to internal field paths produce false regressions (ADR-0002's documented failure) | U1 rewrites them behaviorally before any motion |
| Hidden cross-cluster writes (e.g., close-panel touching file + agent + focus) | Root keeps multi-slice orchestration; extractions move state + single-slice methods only |
| Svelte component type errors invisible to `bun run check` | `check:svelte` baseline captured in U1, compared every unit |
| Bun `mock.module` cache leakage as modules move | Prefer DI/stub accessors in new sub-store tests; complete-interface mocks where unavoidable |
| The 35K workspace-panels suite is slow to debug on failure | It is the gate, not the debugging tool — sub-store units localize failures first |

---

## Sources & References

- Architecture review 2026-06-11 run 2, candidate 3
- ADR-0002; completed plan `2026-06-08-002` (SessionStore decomposition — the template)
- `docs/solutions/architectural/canonical-projection-widening-2026-04-28.md` (parity-test pattern)
- `docs/solutions/ui-bugs/agent-panel-composer-split-brain-canonical-actionability-2026-04-30.md`
- Related plans: `2026-06-11-013` (AgentPanelRootState — soft coordination)
