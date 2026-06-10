---
status: active
type: refactor
created: 2026-06-11
god_gate: required
origin: architecture-review (improve-codebase-architecture, candidate 4)
---

# refactor: Extract the envelope reducer from the SessionStore god class

## Summary

`applySessionStateEnvelope()` (`session-store.svelte.ts:2370–2768`, ~398 lines, 9+ envelope kinds) is the canonical write spine, but it reads and writes 7 private `$state` fields inline — so a single envelope kind can only be tested by instantiating the whole store plus its 13 sub-objects. Extract a **pure** `reduceEnvelope(snapshot, envelope) → EnvelopePatch[]` that does the routing and per-branch computation; the store stays the thin applier that hands patches to its sub-stores. Makes each of the 9 branches testable at the interface, with no behavior change.

---

## Problem Frame

The envelope dispatch is a flat `if/continue` chain over ~9–11 kinds (`replaceGraph`, `applyLifecycle`, `applyCapabilities`, `applyTelemetry`, `applyPlan`, `applyAssistantTextDelta`, `applyBufferPush`, `applyBufferDelta`, `applyGraphPatches`, `refreshSnapshot`, `applyTranscriptDelta`). Each branch reads several private fields (`sessionStateGraphs`, `canonicalProjections`, `canonicalCapabilitiesMaterialized`, `transientProjectionStore`, `connectionService`, `awaitingModelRefresh`, `creationCoordinator`) and mutates them directly. The `applyGraphPatches` branch alone is ~100 lines computing `activeTurnFailure`/`nextActivity`/`nextTurnState`, calling three side-effect methods, and doing three `SvelteMap.set`s. There is no seam between *deciding what changes* and *applying it*. The interface is the whole god object, so the test surface is the whole god object — the 5,516-line projection-state vitest file is the cost of that.

---

## Requirements

- R1. A pure module `reduceEnvelope(snapshot, envelope) → patches` exists, free of `$state` and `this`, that computes the result of each envelope kind.
- R2. `applySessionStateEnvelope` becomes a thin spine: resolve the current snapshot per session, call the reducer, apply returned patches to the owning sub-stores.
- R3. Each envelope kind is unit-testable through the reducer's interface (input snapshot + envelope → expected patches) without constructing `SessionStore`.
- R4. GOD invariants preserved: canonical projection stays the single source of truth; no `canonical ?? hot` fallback; no dual-write; no transcript-order repair or provider branching introduced. Sub-stores still own their disjoint slices and apply patches to them.
- R5. No behavior change — guarded by the existing projection-state characterization suite kept green throughout.

---

## Scope Boundaries

- Not decomposing the rest of `SessionStore` (that is the ongoing ADR-0002 effort, `2026-06-08-002`). This plan extracts only the envelope-reduction logic.
- Not changing the envelope wire shape (Rust-emitted `SessionStatePayload`/`SessionStateDelta`).
- Not changing which sub-store owns which slice — patches are applied to the existing owners.

### Deferred to Follow-Up Work

- Per-branch side-effect methods (`applyCanonicalTerminalTurnSideEffects`, `reconcileConnectionMachineFromCanonicalState`, `syncAwaitingModelRefreshTimer`) that are genuinely effectful (timers, connection machine) stay in the store; only their *triggering decision* moves into the reducer output. Fully relocating effects is a later pass.

---

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src/lib/acp/store/session-store.svelte.ts:2370–2768` — `applySessionStateEnvelope`.
- Sub-stores that own the written slices (patch targets): `SessionProjectionCore` (canonical projection), `AwaitingModelRefreshStore`, `PrLinkStateStore`, `SessionCreationCoordinator`, plus `sessionStateGraphs` / `transientProjectionStore` maps.
- Characterization net: `packages/desktop/src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts`, `session-store-token-stream.vitest.ts`, `session-event-service-streaming.vitest.ts`.
- ADR-0002 (`docs/adr/0002`) — the sub-store decomposition pattern this must respect; especially "extract pure helpers first."
- Prior art: `AgentPanelSessionController` reactive-cluster extraction (accessor-closure deps).

### Institutional Learnings

- ADR-0002: stateful methods do **not** move to free functions; but **pure** transforms do (step 1). A reducer that returns patches is the pure-transform case — the sub-stores keep `$state` and apply.
- GOD gate: this is a canonical write path → re-gate required.

---

## Key Technical Decisions

- **Patches, not mutations.** The reducer returns a typed `EnvelopePatch` describing *what should change* (e.g., `{ kind: "graph", sessionId, graph }`, `{ kind: "turnState", … }`, `{ kind: "scheduleAwaitingRefresh", … }`). The store interprets patches by delegating to sub-store methods. This keeps `$state` ownership with the sub-stores (ADR-0002) while making the decision logic pure (testable).
- **Effects become declared intents.** Where a branch currently calls a side-effect method inline, the reducer instead emits a patch the store turns into that call. The *decision* is tested in the reducer; the *effect* stays in the store.
- **Snapshot in, patches out.** The reducer takes an immutable read-model of the relevant current state (assembled by the store from its sub-stores via accessor closures), never the store itself.

---

## Open Questions

### Resolved During Planning

- Does this contradict ADR-0002's "no free functions for stateful methods"? No — the reducer is pure and returns patches; sub-stores retain `$state` ownership and apply them. This is the ADR's sanctioned pure-helper extraction. Resolved.

### Deferred to Implementation

- The exact patch taxonomy (one variant per envelope kind vs. finer-grained field patches) — settle once the first 2–3 branches are extracted and the shape is observable.
- Which inline effects are pure-enough to fold into patches vs. must stay as store-side effects — decided per branch during extraction.

---

## High-Level Technical Design

> *Directional guidance for review, not implementation specification.*

```
Rust → SessionStatePayload/Delta
        │
        ▼
applySessionStateEnvelope(sessionId, envelope)        // thin spine (store)
        │  1. snapshot = assembleSnapshot(sessionId)   // reads sub-stores via accessors
        │  2. patches  = reduceEnvelope(snapshot, env) // PURE — testable here
        └─ 3. for patch in patches: applyPatch(patch)  // delegates to sub-store methods + effects
```

---

## Implementation Units

### U1. Baseline the characterization net for envelope application

**Goal:** Prove current behavior of all envelope kinds before moving any logic.

**Requirements:** R5

**Dependencies:** None

**Files:**
- Test: `session-store-projection-state.vitest.ts` (audit coverage per envelope kind; add gaps)

**Approach:**
- Map each of the 9+ envelope kinds to at least one existing test; add characterization tests for any uncovered kind so the reducer extraction is fully fenced.

**Execution note:** Characterization-first — do not change production code in this unit.

**Test scenarios:**
- Happy path: one assertion per envelope kind that current `applySessionStateEnvelope` produces the expected projection/turn-state/activity result.

**Verification:** Every envelope kind has at least one green characterization test on current code.

---

### U2. Define the patch taxonomy and the pure reducer skeleton

**Goal:** Introduce `EnvelopePatch` types and a `reduceEnvelope` that handles the 2–3 simplest kinds, with the store delegating those through the new path.

**Requirements:** R1, R2, R3

**Dependencies:** U1

**Files:**
- Create: `packages/desktop/src/lib/acp/store/envelope-reducer/reduce-envelope.ts`
- Create: `packages/desktop/src/lib/acp/store/envelope-reducer/envelope-patch.ts` (patch union)
- Create: `packages/desktop/src/lib/acp/store/envelope-reducer/__tests__/reduce-envelope.vitest.ts`
- Modify: `session-store.svelte.ts` (route the simplest kinds through reducer → applyPatch)

**Approach:**
- Start with kinds that are nearly pure (`applyCapabilities`, `applyTelemetry`, `applyPlan`). Establish `assembleSnapshot` + `applyPatch` plumbing.

**Test scenarios:**
- Happy path: `reduceEnvelope(snapshot, applyCapabilities) → [{kind:"capabilities", …}]`, asserted with no store.
- Edge case: unknown/empty envelope → no patches.

**Verification:** The migrated kinds pass both reducer unit tests and the U1 characterization suite.

---

### U3. Migrate the heavy branches (`applyGraphPatches`, `applyLifecycle`)

**Goal:** Move the two largest branches' decision logic into the reducer, emitting patches for their effects.

**Requirements:** R1, R3, R4

**Dependencies:** U2

**Files:**
- Modify: `reduce-envelope.ts`, `envelope-patch.ts`, `session-store.svelte.ts`
- Test: `reduce-envelope.vitest.ts`

**Approach:**
- `applyGraphPatches`: reducer computes `activeTurnFailure`/`nextActivity`/`nextTurnState` and emits `graph` + effect-intent patches (terminal-turn side effect, connection reconcile, awaiting-refresh schedule). Store applies them.
- Preserve GOD invariants: canonical projection is the only truth; no hot fallback; no dual-write.

**Test scenarios:**
- Happy path: a graph-patch envelope that terminates a turn → reducer emits the terminal-turn effect-intent + correct turnState patch.
- Edge case: graph patch with no turn termination → no terminal effect-intent.
- Integration (store-level): applying those patches drives the same sub-store writes the U1 characterization asserts.

**Verification:** Heavy branches green in both reducer unit tests and characterization; no behavior delta.

---

### U4. Migrate remaining branches and shrink the spine

**Goal:** All envelope kinds flow through `reduceEnvelope`; `applySessionStateEnvelope` is a thin loop.

**Requirements:** R1, R2, R5

**Dependencies:** U3

**Files:**
- Modify: `reduce-envelope.ts`, `session-store.svelte.ts`

**Approach:**
- Move the rest (`replaceGraph`, `applyAssistantTextDelta`, buffer push/delta, `refreshSnapshot`, `applyTranscriptDelta`). The method collapses to `snapshot → reduce → applyPatch` loop.

**Test scenarios:**
- Happy path: each remaining kind covered by a reducer unit test.
- Integration: full envelope stream replay matches characterization output.

**Verification:** `applySessionStateEnvelope` body is small; all 9+ kinds reducer-tested; full suite + `bun run check` green; GOD re-gate documented in the PR.

---

## System-Wide Impact

- **Interaction graph:** The reducer is consumed only by the store's apply loop. Effects (timers, connection machine) remain store-side, now triggered by declared patches.
- **State lifecycle risks:** Patch application must preserve ordering within a single envelope (e.g., graph before turn-state side effects). Encode ordering in the patch list, applied in order.
- **Unchanged invariants:** Canonical projection remains single source of truth; sub-store slice ownership unchanged; wire shape unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Subtle reordering of inline effects changes behavior | Patches applied in emit order; characterization suite (U1) fences every kind |
| Snapshot assembly accidentally introduces a `canonical ?? hot` fallback | GOD re-gate review; snapshot reads canonical facts only |
| Reducer grows its own god-method | One handler fn per envelope kind, composed by a thin `reduceEnvelope` spine |
| Overlap with the in-flight ADR-0002 SessionStore decomposition | Coordinate sequencing with `2026-06-08-002`; this plan touches only the envelope path |

---

## Sources & References

- Architecture review candidate 4 (verified lines 2370–2768).
- ADR-0002 (`docs/adr/0002-composed-sub-stores-for-reactive-decomposition.md`).
- Related plan: `docs/plans/2026-06-08-002-refactor-session-store-class-decomposition-plan.md`.
