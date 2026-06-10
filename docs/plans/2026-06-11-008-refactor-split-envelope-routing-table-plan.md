---
status: active
type: refactor
created: 2026-06-11
god_gate: required
origin: architecture-review (improve-codebase-architecture, candidate 8)
---

# refactor: Separate the live-envelope routing table from its builders

## Summary

`runtime_registry.rs` is a 5,199-LOC struct owning five orthogonal responsibilities; the defect-prone surface is `build_live_session_state_envelope` — a ~180-line `if`-chain routing ~7 `SessionUpdate` kinds to 7 private builders, where the frontier-transition decision is duplicated across three viewport builders. Extract the routing as a named `EnvelopeRouter` module and lift the 200-line streaming buffer producer into a peer module, leaving the registry a thin coordination spine. The sibling `projections/mod.rs` (5,439 LOC) has the same shape and is handled as Phase 2 of this plan.

---

## Problem Frame

`SessionGraphRuntimeRegistry` owns: session lifecycle/checkpoint, the live-envelope routing if-chain, transcript-viewport materialization, the streaming buffer producer, and the assistant-text chunker. The routing chain — not the builders — is where defects concentrate: each of the three viewport builders (`build_turn_state_delta_envelope`, `build_interaction_delta_envelope`, `with_materialized_viewport`) independently calls `decide_frontier_transition`, then falls through the same `RequireSnapshot | AcceptDelta` repair arms. The buffer producer (`build_or_advance_viewport_buffer_envelope`) is a 200-line body acquiring two mutexes, holding the delta-vs-push classifier, identity guard, height-correction override, scroll-authority contract, and emission-record update all at once. To test "which builder should this update route to," you must construct the whole registry. The routing decision and the buffer-emission decision are deep behaviors trapped behind a shallow, sprawling interface with no internal seam.

---

## Requirements

- R1. Envelope routing (`SessionUpdate` kind → builder selection + frontier-transition decision) lives in a named module testable without constructing the full registry.
- R2. The frontier-transition decision is computed once per envelope build, not duplicated across three builders.
- R3. The streaming buffer producer is a peer module with its own interface (inputs: prior emission record + new window; output: push/delta/no-op emission), unit-testable in isolation.
- R4. `runtime_registry.rs` becomes a thin coordination spine that composes the router, builders, and buffer producer.
- R5. GOD invariants preserved: canonical lifecycle/activity/turnState/capabilities flow Rust → envelope → projection unchanged; no transcript-order repair, provider branching, or raw-id-as-identity introduced; the documented lock-order protocol across the two mutexes is preserved exactly.
- R6. No behavior change — fenced by characterization tests over the routing table and buffer producer across all update kinds.

---

## Scope Boundaries

- Not changing the envelope wire shape or the `SessionStatePayload`/`SessionStateDelta` contract (candidates 1 and 8's seam-narrowing are separate).
- Not changing lock ordering or concurrency semantics — only where the code lives.
- Not splitting the lifecycle/checkpoint or `SessionGraphRuntimeSnapshot` concerns in Phase 1 (those are additional peers; address only if the spine still reads as a god object afterward).

### Deferred to Follow-Up Work

- `SessionGraphRuntimeSnapshot` (checkpoint view with its own `apply_update`/`from_checkpoint`/`into_checkpoint` lifecycle) → extract to its own module in a later pass if warranted.

---

## Context & Research

### Relevant Code and Patterns

- `session_state_engine/runtime_registry.rs` (5,199) — `SessionGraphRuntimeRegistry` (22 pub methods); `build_live_session_state_envelope` (~180-line if-chain); `build_turn_state_delta_envelope`, `build_interaction_delta_envelope`, `with_materialized_viewport` (each calls `decide_frontier_transition`); `delta_or_snapshot_repair`, `build_snapshot_envelope`; `build_or_advance_viewport_buffer_envelope` (200-line buffer producer); `classify_buffer_transition`, `compute_buffer_delta`, `BufferEmission`.
- Lock-order protocol: `transcript_viewports` mutex then `buffer_emissions` mutex (documented in-file) — must be preserved.
- Sibling (Phase 2): `projections/mod.rs` (5,439) — `apply_session_update` (100-line match mixing turn-state, operation upsert, interaction registration); three entry points `apply_session_update` / `apply_session_update_at_event_seq` / `apply_canonical_event` with differing idempotency.
- Reducer relatives: `session_state_engine/reducer.rs`, `bridge.rs`.

### Institutional Learnings

- ADR-0002 shape (Rust analogue): extract cohesive sub-domains behind narrow interfaces; leave a thin composition spine. The TS sub-store work proves the pattern; this applies it to the Rust registry.
- GOD gate: this is canonical envelope-emission — re-gate required; the registry is the envelope-router authority ADR-0002 references.
- Related: `2026-05-28-003-refactor-split-large-modules-plan.md` (prior large-module split precedent).

---

## Key Technical Decisions

- **Router as a pure-as-possible decision module.** `EnvelopeRouter` maps `(SessionUpdate kind, frontier/previous_revision state) → BuildPlan` (which builder + the single frontier-transition decision). Builders consume the plan; they no longer each recompute frontier state.
- **Buffer producer as a peer with an explicit record interface.** Inputs are the prior `BufferEmission` record and the new window; output is the push/delta/no-op decision. The two-mutex acquisition stays at the spine (lock-order preserved); the *classification logic* moves into the testable peer.
- **Spine composes, doesn't decide.** `build_live_session_state_envelope` becomes: get plan from router → invoke selected builder → (for buffer updates) call the buffer producer under the documented lock order.
- **Characterization-first.** High-risk canonical emission path; full characterization across update kinds before moving logic.

---

## Open Questions

### Resolved During Planning

- Fold `projections/mod.rs` into this plan or split to a 9th? Fold as **Phase 2** — same shape, same approach; one plan documents the pattern both follow, but they land as separate PRs. Resolved (per scoping decision).

### Deferred to Implementation

- Whether the router output is a fully-pure `BuildPlan` value or a trait-dispatched builder selection — settle once the first two kinds are routed.
- Exact boundary of what stays under the mutexes vs. moves into the buffer peer — preserve lock order; determine the minimal critical section during extraction.

---

## High-Level Technical Design

> *Directional guidance for review, not implementation specification.*

```
BEFORE:  build_live_session_state_envelope
           └─ 180-line if-chain
                ├─ builder A ─ decide_frontier_transition ─ delta_or_snapshot_repair
                ├─ builder B ─ decide_frontier_transition ─ delta_or_snapshot_repair  (dup)
                └─ builder C ─ decide_frontier_transition ─ delta_or_snapshot_repair  (dup)
           └─ build_or_advance_viewport_buffer_envelope (200-line, 2 mutexes, all logic)

AFTER:   spine
           ├─ EnvelopeRouter(kind, frontier) → BuildPlan  (frontier decided ONCE)
           ├─ builder(plan)                                (A/B/C, no frontier recompute)
           └─ BufferProducer(prior_emission, window) → Emission   (under preserved lock order)
```

---

## Implementation Units

### Phase 1 — runtime_registry.rs

### U1. Characterize routing and buffer-emission behavior

**Goal:** Pin the envelope produced for each `SessionUpdate` kind and the push/delta/no-op decision for representative buffer windows.

**Requirements:** R6

**Dependencies:** None

**Files:**
- Test: `session_state_engine/` tests (extend) — one case per update kind; buffer-producer cases for push, delta, no-op, identity-guard, height-correction override.

**Approach:**
- Golden envelopes per kind; golden emission decisions per buffer scenario, including the frontier `RequireSnapshot`/`AcceptDelta` arms.

**Execution note:** Characterization-first — this fences a canonical emission path.

**Test scenarios:**
- Happy path: each update kind → expected envelope (snapshot vs delta).
- Edge case: frontier `RequireSnapshot` forces a snapshot envelope.
- Edge case: buffer identity guard → no-op; height-correction override → push.

**Verification:** Green on current code; every kind + buffer branch covered.

---

### U2. Extract `EnvelopeRouter` with a single frontier decision

**Goal:** Move kind→builder selection and the frontier-transition decision into a named module computed once.

**Requirements:** R1, R2

**Dependencies:** U1

**Files:**
- Create: `session_state_engine/envelope_router.rs`
- Modify: `runtime_registry.rs` (call router; builders take the decided plan)
- Test: `session_state_engine/envelope_router` tests

**Approach:**
- Router returns a `BuildPlan { builder, frontier_transition }`. The three viewport builders accept the frontier decision instead of each calling `decide_frontier_transition`.

**Test scenarios:**
- Happy path: each kind → correct `BuildPlan`, asserted without the registry.
- Edge case: previous_revision state drives `RequireSnapshot` vs `AcceptDelta` exactly once.

**Verification:** Routing unit-tested standalone; `decide_frontier_transition` called once per build; U1 goldens reproduced.

---

### U3. Extract the buffer producer as a peer module

**Goal:** Lift the streaming buffer classification into a testable peer; keep the two-mutex acquisition (lock order) at the spine.

**Requirements:** R3, R5

**Dependencies:** U1

**Files:**
- Create: `session_state_engine/viewport_buffer_producer.rs` (classifier + delta/push/no-op decision over prior record + window)
- Modify: `runtime_registry.rs` (`build_or_advance_viewport_buffer_envelope` acquires locks in documented order, delegates classification to the peer)
- Test: `viewport_buffer_producer` tests

**Approach:**
- Move `classify_buffer_transition`/`compute_buffer_delta`/identity-guard/height-correction logic into the peer as pure-over-inputs functions. The spine reads the record under lock, calls the peer, writes the emission under lock.

**Test scenarios:**
- Happy path: window grows → delta emission; window jump → push.
- Edge case: identical window → no-op (identity guard).
- Edge case: height-correction (B4) override → push despite delta-eligible.

**Verification:** Buffer producer unit-tested without mutexes; lock order in the spine unchanged; U1 buffer goldens reproduced.

---

### U4. Reduce `build_live_session_state_envelope` to a spine

**Goal:** The method becomes get-plan → invoke-builder → (buffer) produce-under-lock.

**Requirements:** R4, R6

**Dependencies:** U2, U3

**Files:**
- Modify: `runtime_registry.rs`

**Approach:**
- Collapse the if-chain to a router dispatch + builder call; buffer path delegates to the peer.

**Test scenarios:**
- Integration: full envelope-build for each kind matches U1 goldens.

**Verification:** Method body small; all U1 characterization green; GOD re-gate documented; `cargo clippy` clean.

---

### Phase 2 — projections/mod.rs (separate PR)

### U5. Characterize and split the projection apply path

**Goal:** Apply the same router/peer pattern to `apply_session_update`'s 100-line match, separating turn-state, operation, and interaction projection, and naming the three idempotency entry points' contract.

**Requirements:** R1 (analogue), R6

**Dependencies:** U4 (pattern established)

**Files:**
- Test: `projections/` characterization (per `SessionUpdate` variant + per entry point idempotency)
- Create: focused projection modules (operation projection, interaction projection) behind the registry spine
- Modify: `projections/mod.rs`

**Approach:**
- Characterize `apply_session_update` / `apply_session_update_at_event_seq` / `apply_canonical_event` idempotency differences first; name the "live vs canonical-idempotent application" distinction explicitly; then extract operation and interaction projection into peers. (Note: `relink_tool_call_to_transcript_event_seq` and `ensure_transcript_tool_operations` are transcript-order repairs living in projection — coordinate with candidate 3 before relocating them.)

**Test scenarios:**
- Happy path: each variant updates the right projection slice.
- Edge case: the three entry points' idempotency semantics characterized and preserved.

**Verification:** Projection split behind a thin spine; characterization green; GOD re-gate documented.

---

## System-Wide Impact

- **Interaction graph:** The router and buffer peer are consumed only by the registry spine; envelope output to the bridge/TS is unchanged.
- **State lifecycle risks:** The two-mutex lock order is the highest concurrency risk — it stays at the spine, unchanged; only pure classification moves out.
- **API surface parity:** Envelope/payload wire shape unchanged.
- **Unchanged invariants:** Canonical lifecycle/activity/turnState/capabilities flow and emission semantics preserved; envelope-router authority retained.

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Moving buffer logic alters the critical section / lock order | Med | High | Lock acquisition stays in the spine; peer is pure-over-inputs; characterization (U1) fences emission decisions |
| Frontier decision computed once changes an edge case where a builder relied on recomputing | Low | High | U1 covers frontier arms per kind; router decision asserted standalone (U2) |
| Phase 2 relocates a transcript-order repair that candidate 3 is also changing | Med | Med | Sequence Phase 2 after candidate 3 or coordinate; flagged in U5 |
| Registry still reads as a god object after extraction | Med | Low | Lifecycle/checkpoint + `SessionGraphRuntimeSnapshot` extraction deferred; revisit if spine remains large |

---

## Sources & References

- Architecture review candidate 8 (verified LOC + routing/builder/buffer structure).
- Related plan: `2026-05-28-003-refactor-split-large-modules-plan.md`.
- ADR-0002 (composition-spine shape); CONTEXT.md GOD gate; candidate 3 plan (`2026-06-11-007`) for the transcript-repair coordination.
