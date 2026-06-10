---
status: active
type: refactor
created: 2026-06-11
god_gate: not-required
origin: architecture-review (improve-codebase-architecture, candidate 5)
---

# refactor: Seal the SessionCreationCoordinator seam

## Summary

`SessionCreationCoordinator` (56 LOC) was extracted as a composed sub-store per ADR-0002, but it does not encapsulate its slice: `SessionStore` reaches through the public `pendingCreationSessions` `SvelteMap` at ~20 sites (`.get/.set/.delete/.has`) and assigns `sessionOpenHydrator` / `liveSessionStateGraphConsumer` from outside. Its two methods are bypassed. By the ADR's own bar — a sub-store *owns* a disjoint slice — the slice is owned in name but written from the parent. **Recommended path (Option A): deepen the seam** — make the map private and expose creation-lifecycle verbs. Option B (collapse back into `SessionStore`) is documented as the alternative.

---

## Problem Frame

ADR-0002 defines a sub-store as a class that owns a disjoint slice of `$state` plus the methods over it, with the parent delegating through a narrow interface. The coordinator owns the creation-lifecycle slice (`pendingCreationSessions`, the hydrator, the live-graph consumer), which is a *coherent* slice — so the extraction was directionally right. But the slice is not sealed: the parent mutates the map directly at ~20 sites and sets the two reference fields externally, and `hasPendingCreationSession` duplicates an inline `.has()` the parent also calls. The interface is as wide as the implementation; the deletion test reports "pass-through" only because nothing is hidden behind it. The fix is to make the seam real, not to abandon it.

---

## Requirements

- R1. `pendingCreationSessions` is private to the coordinator; no external code reads or mutates the map directly.
- R2. The creation lifecycle is expressed as verbs on the coordinator: begin/register a pending creation, query (`has`), complete/resolve, and fail. The ~20 parent pokes route through these.
- R3. `sessionOpenHydrator` and `liveSessionStateGraphConsumer` are supplied at construction or via a single explicit setter, not mutated as public fields ad hoc.
- R4. The coordinator becomes unit-testable in isolation: construct with stub deps, drive the lifecycle, assert slice behavior — no `SessionStore`.
- R5. No behavior change to session creation/loading — fenced by the existing rename/creation invariant tests.
- R6. ADR-0002 conformance: the slice stays disjoint (still solely owned here), no dual-ownership introduced, cross-slice reads (if any) flow via accessor-closure deps.

---

## Scope Boundaries

- Not merging the coordinator into another sub-store.
- Not changing the session-creation *protocol* (connection-manager handshake, hydration semantics) — only the encapsulation of its state.
- Not re-opening ADR-0002 — this strengthens conformance to it. (If the team instead chooses Option B/collapse, that *would* warrant an ADR note; see Alternatives.)

---

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src/lib/acp/store/session-creation-coordinator.svelte.ts` (56 LOC): owns `pendingCreationSessions: SvelteMap<string, CreatedPendingSessionResult>`, `sessionOpenHydrator`, `liveSessionStateGraphConsumer`; methods `hasPendingCreationSession`, `failPendingCreationSession`; deps `{ messagingSvc, onTurnError }`.
- Parent poke sites (~20): `session-store.svelte.ts` lines 1008, 1013, 1017, 1035, 1925, 1927, 1933–1934, 1953, 1955, 2152, 2156–2157, 2171, 2175, 2261, 2265, 2438, 2676.
- Verb model to mirror: `PrLinkStateStore` / `AwaitingModelRefreshStore` (ADR-0002 sub-stores with method-based interfaces and accessor-closure deps).
- Invariant tests: `session-store-rename.vitest.ts` (the suite ADR-0002 notes is sensitive to internal field-path coupling — rewrite behaviorally if needed).

### Institutional Learnings

- ADR-0002 Consequences: "Tests coupled to internal field paths are a hazard… must be rewritten behaviorally before extraction." Applies directly if any test asserts on `pendingCreationSessions` internals.
- ADR-0002 Decision 3: cross-slice reads via accessor-closure deps, never dual-ownership.

---

## Key Technical Decisions

- **Option A (recommended): deepen.** Private the map; expose `beginPendingCreation`, `hasPendingCreation`, `completePendingCreation`, `failPendingCreation` (names TBD at implementation). Supply hydrator + live-graph consumer via constructor deps or one explicit `attach(...)` setter. The ~20 pokes become verb calls.
  - *Why over collapse:* the creation lifecycle is a genuine, cohesive slice (pending set + hydration + live-graph handoff). ADR-0002 chose sub-stores precisely for slices like this; the file is new on this branch and just needs sealing, not deleting. Two prospective adapters already exist conceptually (the production messaging service + a test stub), satisfying "two adapters = real seam."
- **Effectful methods stay here.** `failPendingCreationSession` already composes `messagingSvc.handleCanonicalTurnFailure` + `onTurnError`; keep effects inside the verb.

---

## Open Questions

### Resolved During Planning

- Deepen or collapse? Deepen (Option A). The slice is cohesive and ADR-0002 prescribes sub-stores for it; collapsing would fight the just-accepted ADR and re-grow `SessionStore`. Resolved — but see Alternatives if the team disagrees.

### Deferred to Implementation

- Exact verb names and whether "complete" and "begin" are distinct or a single transition — settle by reading the 20 call sites' intent during extraction.
- Whether any of the 20 sites needs a *read* of map contents (not just membership) — if so, expose a typed accessor rather than the raw map.

---

## Implementation Units

### U1. Behavioral characterization of the creation lifecycle

**Goal:** Capture current creation/loading behavior so sealing the map is provably non-breaking.

**Requirements:** R5

**Dependencies:** None

**Files:**
- Test: `session-creation-coordinator.svelte.ts` companion test (create: `store/__tests__/session-creation-coordinator.vitest.ts`)
- Test: audit `session-store-rename.vitest.ts` for internal-field coupling; rewrite behaviorally if present.

**Approach:**
- Tests over the *observable* lifecycle: a pending creation begins, is queryable, resolves on hydration, and fails correctly (messaging + onTurnError fire, pending entry cleared).

**Execution note:** Characterization-first; behavioral assertions only (no internal field-path asserts), per ADR-0002.

**Test scenarios:**
- Happy path: begin → hydrate/complete → no longer pending.
- Error path: begin → fail → `handleCanonicalTurnFailure` + `onTurnError` fire, entry removed.
- Edge case: fail on a non-pending session → no-op (matches current guard).

**Verification:** Green on current code via the public surface.

---

### U2. Add the verb interface; keep the map public temporarily

**Goal:** Introduce `begin/has/complete/fail` verbs covering every parent poke pattern.

**Requirements:** R2, R3, R4

**Dependencies:** U1

**Files:**
- Modify: `session-creation-coordinator.svelte.ts`

**Approach:**
- Implement verbs over the existing map; add a constructor/`attach` path for `sessionOpenHydrator` + `liveSessionStateGraphConsumer`.

**Test scenarios:**
- Happy path: each verb reproduces the corresponding U1 lifecycle outcome, tested with stub deps and no store.

**Verification:** Coordinator unit-testable in isolation; verbs cover all 20 poke patterns.

---

### U3. Route the 20 parent sites through verbs; private the slice

**Goal:** Replace direct `.get/.set/.delete/.has` and field assignments with verb calls; make `pendingCreationSessions` private and the references constructor-supplied.

**Requirements:** R1, R3, R6

**Dependencies:** U2

**Files:**
- Modify: `session-store.svelte.ts` (the ~20 sites + the two field assignments at construction)
- Modify: `session-creation-coordinator.svelte.ts` (`#pendingCreationSessions`, drop public mutability)

**Approach:**
- Mechanical site-by-site replacement; remove the duplicated inline `.has()` in favor of `hasPendingCreation`. Supply hydrator/consumer via deps. Confirm slice stays solely owned (no dual-ownership).

**Test scenarios:**
- Integration: full session creation + load flow (store-level) matches U1/characterization.
- Edge case: a creation that fails mid-flight clears correctly through the verb.

**Verification:** `rg pendingCreationSessions` shows access only inside the coordinator; rename/creation suites + `bun run check` green.

---

## Alternative Approaches Considered

- **Option B — collapse into `SessionStore`.** Fold the three fields + two methods back into the god class. *Rejected as default:* it contradicts the just-accepted ADR-0002 (which prescribes composed sub-stores for cohesive slices) and re-grows the 2,995-LOC class. Choose this only if the team decides the creation slice is not cohesive enough to own — in which case record a short ADR amendment noting the exception, since a future architecture review will otherwise re-suggest the extraction.

---

## System-Wide Impact

- **Interaction graph:** Session creation/loading methods on `SessionStore` now delegate to coordinator verbs instead of poking its map.
- **State lifecycle risks:** Pending-creation cleanup on success and failure must remain exact — covered by U1 error-path characterization.
- **Unchanged invariants:** Creation protocol, hydration semantics, and external `SessionStore` interface are unchanged; only the coordinator's encapsulation tightens.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| A poke site reads map *contents*, not just membership | Expose a typed read accessor in U2 rather than re-exposing the map |
| `session-store-rename.vitest.ts` asserts internal field paths | Rewrite behaviorally in U1 before sealing (ADR-0002 hazard) |
| Team prefers collapse | Option B documented; gate the choice at U2 review |

---

## Sources & References

- Architecture review candidate 5 (verified file + 20 poke sites).
- ADR-0002 (`docs/adr/0002-composed-sub-stores-for-reactive-decomposition.md`) — the conformance bar this plan restores.
