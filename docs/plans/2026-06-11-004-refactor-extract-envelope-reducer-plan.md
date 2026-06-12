---
status: active
type: refactor
created: 2026-06-11
god_gate: required
origin: architecture-review (improve-codebase-architecture, candidate 4)
---

# refactor: Extract pure envelope patch computation from SessionStore

## Summary

Envelope **routing** already lives in `routeSessionStateEnvelope()` (`session-state-command-router.ts`); `applySessionStateEnvelope()` (`session-store.svelte.ts:2370–~2895`) is a command-dispatch loop that still reads/writes 7+ private `$state` fields inline per command kind. Extract **pure patch computation** — given an immutable snapshot + a `SessionStateCommand`, compute the typed patches and effect intents — into a testable module; the store stays the thin applier that delegates to sub-stores. Routing stays in the router; this plan extracts only the *decision* half of each command handler.

---

## Problem Frame

The architecture review framed this as a flat `if/continue` chain over envelope kinds. That routing step is **already extracted**: `applySessionStateEnvelope` calls `routeSessionStateEnvelope(sessionId, revision, envelope)` and iterates the returned `SessionStateCommand[]`. What remains in the store is the **apply** half: each `command.kind` branch reads several private fields (`sessionStateGraphs`, `canonicalProjections`, `canonicalCapabilitiesMaterialized`, `transientProjectionStore`, `connectionService`, `awaitingModelRefresh`, `creationCoordinator`) and mutates them directly. The `applyGraphPatches` branch alone computes `activeTurnFailure`/`nextActivity`/`nextTurnState`, calls three side-effect methods, and does multiple `SvelteMap.set`s. There is no seam between *deciding what changes* and *applying it*. The interface is the whole god object, so the test surface is the whole god object.

**Not in scope for this plan:** rebuilding envelope routing (already done). **In scope:** pure transforms from `(snapshot, command) → patches[]` for each command kind.

---

## Requirements

- R1. A pure module `reduceCommand(snapshot, command) → patches` exists, free of `$state` and `this`, that computes the result of each command kind.
- R2. `applySessionStateEnvelope` becomes a thinner spine: assemble snapshot → `routeSessionStateEnvelope` (unchanged) → for each command: `reduceCommand` → `applyPatch`.
- R3. Each command kind is unit-testable through the reducer's interface (input snapshot + command → expected patches) without constructing `SessionStore`.
- R4. GOD invariants preserved: canonical projection stays the single source of truth; no `canonical ?? hot` fallback; no dual-write; no transcript-order repair or provider branching introduced. Sub-stores still own their disjoint slices and apply patches to them.
- R5. No behavior change — guarded by the existing projection-state characterization suite kept green throughout.

---

## Scope Boundaries

- **Not changing** `routeSessionStateEnvelope` / `session-state-command-router.ts` routing logic (unless a gap is found during characterization).
- Not decomposing the rest of `SessionStore` (ongoing ADR-0002 effort, `2026-06-08-002`). This plan extracts only envelope **application** decision logic.
- Not changing the envelope wire shape (Rust-emitted `SessionStatePayload`/`SessionStateDelta`).
- Not changing which sub-store owns which slice — patches are applied to the existing owners.

### Branches with limited pure extraction

Some commands are inherently effectful or multi-target:
- `replaceGraph` — transcript revision gating + `creationCoordinator.liveSessionStateGraphConsumer` side effect.
- `applyAssistantTextDelta` — token stream mutation across transient + canonical projection.
- `applyLifecycle` — reads previous projection/graph for authority-preserving reconciliation.

For these, the reducer emits **effect intents** and **field patches** separately; the store executes effects. Do not force a single snapshot→patches model where branches need cross-store reads that cannot be snapshotted without stale-data bugs (e.g. multi-command envelopes where `pendingSendIntent` depends on post-apply state).

### Deferred to Follow-Up Work

- Fully relocating timer/connection-machine effects out of the store — only their *triggering decision* moves into reducer output in this pass.

---

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src/lib/acp/session-state/session-state-command-router.ts` — `routeSessionStateEnvelope`, `SessionStateCommand` union (routing **already extracted**).
- `packages/desktop/src/lib/acp/store/session-store.svelte.ts:2370–~2895` — `applySessionStateEnvelope` command apply loop.
- Sub-stores that own written slices: `SessionProjectionCore`, `AwaitingModelRefreshStore`, `PrLinkStateStore`, `SessionCreationCoordinator`, plus `sessionStateGraphs` / `transientProjectionStore` maps.
- Characterization net: `session-store-projection-state.vitest.ts`, `session-store-token-stream.vitest.ts`, `session-event-service-streaming.vitest.ts`.
- ADR-0002 — sub-store decomposition; "extract pure helpers first."

---

## Key Technical Decisions

- **Patches, not mutations.** The reducer returns typed `EnvelopePatch` values describing *what should change*. The store interprets patches by delegating to sub-store methods.
- **Effects become declared intents.** Side-effect calls (`applyCanonicalTerminalTurnSideEffects`, `reconcileConnectionMachineFromCanonicalState`, `syncAwaitingModelRefreshTimer`) become patch variants the store executes.
- **Snapshot in, patches out.** The reducer takes an immutable read-model assembled from sub-stores via accessor closures, never the store itself.
- **Router stays separate.** Do not merge routing back into the store; compose `route → reduce → apply`.

---

## High-Level Technical Design

```
Rust → SessionStateEnvelope
        │
        ▼
routeSessionStateEnvelope(sessionId, revision, envelope)   // EXISTING — session-state-command-router.ts
        │  → SessionStateCommand[]
        ▼
applySessionStateEnvelope(sessionId, envelope)             // THINNER store spine
        │  1. snapshot = assembleSnapshot(sessionId)
        │  2. for command in commands:
        │       patches = reduceCommand(snapshot, command)   // NEW — pure, testable
        └─ 3.     applyPatch(patches)                        // delegates to sub-stores + effects
```

---

## Implementation Units

### U1. Baseline the characterization net for envelope application

**Goal:** Prove current behavior of all command kinds before moving any logic.

**Requirements:** R5

**Dependencies:** None

**Files:**
- Test: `session-store-projection-state.vitest.ts` (audit coverage per command kind; add gaps)
- Test: `session-state-command-router.test.ts` (confirm routing coverage is separate from apply coverage)

**Approach:**
- Map each `SessionStateCommand.kind` to at least one store-level characterization test.
- Add explicit test for **multi-command envelopes** (ordering + `pendingSendIntent` clearing) before extracting logic.

**Verification:** Every command kind has at least one green characterization test on current code.

---

### U2. Define patch taxonomy and pure reducer for simplest commands

**Goal:** Introduce `EnvelopePatch` + `reduceCommand` for nearly-pure kinds; store delegates through the new path.

**Requirements:** R1, R2, R3

**Dependencies:** U1

**Files:**
- Create: `packages/desktop/src/lib/acp/store/envelope-reducer/reduce-command.ts`
- Create: `packages/desktop/src/lib/acp/store/envelope-reducer/envelope-patch.ts`
- Create: `packages/desktop/src/lib/acp/store/envelope-reducer/__tests__/reduce-command.vitest.ts`
- Modify: `session-store.svelte.ts` (route simplest kinds through reducer → applyPatch)

**Approach:**
- Start with `applyCapabilities`, `applyTelemetry`, `applyPlan`, `applyBufferPush`, `applyBufferDelta`.

**Verification:** Migrated kinds pass reducer unit tests and U1 characterization.

---

### U3. Migrate heavy branches (`applyGraphPatches`, `applyLifecycle`, `replaceGraph`)

**Goal:** Move decision logic into the reducer; emit patches + effect intents.

**Requirements:** R1, R3, R4

**Dependencies:** U2

**Approach:**
- `applyGraphPatches`: reducer computes turn/activity patches + terminal-turn / connection / awaiting-refresh intents.
- `applyLifecycle`: reducer uses snapshotted previous projection only (no transient authority inversion).
- `replaceGraph`: reducer emits transcript-replacement decision + graph patch; store handles `creationCoordinator` consumer.

**Test scenarios:**
- Multi-command envelope: patches applied in order; `pendingSendIntent` behavior unchanged.

**Verification:** Heavy branches green in reducer tests and characterization.

---

### U4. Migrate remaining branches and shrink the apply loop

**Goal:** All command kinds flow through `reduceCommand`; apply loop is snapshot → route (unchanged) → reduce → apply.

**Requirements:** R1, R2, R5

**Dependencies:** U3

**Files:**
- Modify: `reduce-command.ts`, `session-store.svelte.ts`

**Approach:**
- Move `applyAssistantTextDelta`, `applyTranscriptDelta`, `refreshSnapshot`, and any remaining inline logic.

**Verification:** Apply loop body small; all command kinds reducer-tested; `bun run check` + full suite green; GOD re-gate documented.

---

## System-Wide Impact

- **Interaction graph:** Reducer consumed only by the store apply loop. Router unchanged.
- **State lifecycle risks:** Patch ordering within a single envelope must be preserved; encode in patch list emit order.
- **Unchanged invariants:** Canonical projection single source of truth; wire shape unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Rebuilding routing that already exists | Explicit non-goal; router stays in `session-state-command-router.ts` |
| Stale snapshot in multi-command envelopes | U1 multi-command characterization before extraction |
| Snapshot assembly introduces `canonical ?? hot` fallback | GOD re-gate; snapshot reads canonical facts only |
| Overlap with `2026-06-08-002` SessionStore decomposition | Coordinate sequencing; this plan touches only envelope apply path |

---

## Sources & References

- Architecture review candidate 4 (re-baselined: routing at `session-state-command-router.ts`, apply at `session-store.svelte.ts:2370+`).
- ADR-0002 (`docs/adr/0002-composed-sub-stores-for-reactive-decomposition.md`).
- Related plan: `2026-06-08-002-refactor-session-store-class-decomposition-plan.md`.
