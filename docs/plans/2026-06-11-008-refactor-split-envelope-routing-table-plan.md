---
status: active
type: refactor
created: 2026-06-11
god_gate: required
origin: architecture-review (improve-codebase-architecture, candidate 8)
---

# refactor: Separate the live-envelope routing table from its builders

## Summary

`runtime_registry.rs` is a 5,199-LOC struct owning five orthogonal responsibilities; the defect-prone surface is `build_live_session_state_envelope` (`:329–511`, ~183 LOC) — kind guards plus **four** `decide_frontier_transition` call sites — and `build_or_advance_viewport_buffer_envelope` (`:1221–1413`, ~192 LOC). Extract routing as a named `EnvelopeRouter` module and lift buffer classification into a peer module, leaving the registry a coordination spine. Phase 2 applies the same pattern to the projection apply spine in `projections/session_lifecycle.rs` (the `projections/` tree is already split; `mod.rs` is a 95-line barrel, not a 5.4k monolith).

---

## Problem Frame

`SessionGraphRuntimeRegistry` owns: session lifecycle/checkpoint, live-envelope routing, transcript-viewport materialization, the streaming buffer producer, and the assistant-text chunker. The routing surface — not the builders — is where defects concentrate:

- **Four frontier decision sites** (not three): inline in `build_live_session_state_envelope` at `:408` (tool-call patch) and `:477` (transcript-delta fallback), plus `build_turn_state_delta_envelope` (`:595`) and `build_interaction_delta_envelope` (`:660`). `with_materialized_viewport` (`:939–1077`) does **not** call `decide_frontier_transition` — it materializes rows under the `transcript_viewports` lock.
- **Per-kind `is_transcript_bearing` rules differ:** interaction builder hardcodes `false` at `:660`; other paths compute from `transcript_operations`. A router must preserve these rules, not collapse to one flag.
- **Buffer producer:** `classify_buffer_transition` (`:1621`) and `compute_buffer_delta` (`:1465`) are already module-level pure helpers with unit tests; remaining logic in `build_or_advance_viewport_buffer_envelope` includes override layers (identity guard, B4 height FreshPush) that must move with the peer.

To test "which builder should this update route to," you must construct the whole registry today. The routing decision and buffer-emission decision are deep behaviors trapped behind a shallow, sprawling interface.

---

## Requirements

- R1. Envelope routing (`SessionUpdate` kind → builder selection + frontier-transition decision) lives in a named module testable without constructing the full registry.
- R2. The frontier-transition decision is computed once per envelope build **per routed arm**, with kind-specific `is_transcript_bearing` rules preserved — not one global flag that erases interaction's `false` semantics.
- R3. The streaming buffer producer is a peer module with its own interface (inputs: prior emission record + materialized window snapshot; output: push/delta/no-op emission), unit-testable in isolation.
- R4. `runtime_registry.rs` production routing/buffer-classification logic extracted; acceptance: `build_live_session_state_envelope` body ≤ ~40 LOC (dispatch only), frontier/buffer classification 0 LOC in registry body excluding lock acquisition. File may remain large due to `#[cfg(test)]` (~3k test lines) and deferred lifecycle/checkpoint mass — track production LOC separately.
- R5. GOD invariants preserved: canonical lifecycle/activity/turnState/capabilities flow Rust → envelope → projection unchanged; no transcript-order repair, provider branching, or raw-id-as-identity introduced; lock-order protocol preserved exactly.
- R6. No behavior change — fenced by characterization tests over routing, buffer producer, multi-envelope paths (`build_additional_session_state_envelopes`), and `delta_or_snapshot_repair` fallbacks.

---

## Scope Boundaries

- Not changing the envelope wire shape or the `SessionStatePayload`/`SessionStateDelta` contract (plans 001 and 002 are separate).
- Not changing lock ordering or concurrency semantics — only where pure classification logic lives.
- Not splitting lifecycle/checkpoint or `SessionGraphRuntimeSnapshot` in Phase 1.

### Deferred to Follow-Up Work

- `SessionGraphRuntimeSnapshot` extraction → later pass if spine still reads as a god object.
- Test-module extraction from `runtime_registry.rs` `#[cfg(test)]` block.

---

## Context & Research

### Relevant Code and Patterns

- `session_state_engine/runtime_registry.rs` (5,199 LOC total; ~2,183+ is `#[cfg(test)]`) — `build_live_session_state_envelope` (`:329–511`); `build_turn_state_delta_envelope`, `build_interaction_delta_envelope`; `build_or_advance_viewport_buffer_envelope` (`:1221–1413`); existing pure helpers `classify_buffer_transition`, `compute_buffer_delta`.
- `session_state_engine/frontier.rs` — `decide_frontier_transition`.
- **Lock-order protocol:** `buffer_emissions` mutex **first**, then `transcript_viewports` (documented at `:106–108`, `:1219–1220`). Never invert.
- Phase 2 sibling: `projections/` directory (~5.5k LOC total) — `mod.rs` (95, re-exports); `session_lifecycle.rs` (308, `apply_session_update` + idempotency entry points); `operations.rs` (657), `interactions.rs` (254), `helpers.rs` (675).
- Prior Rust module-split precedent: `2026-05-28-003-refactor-split-large-modules-plan.md`.

### Institutional Learnings

- ADR-0002 is a **TypeScript sub-store** pattern — cite only as analogical shape (thin composition root + narrow interfaces). Rust precedent is pure-helper extraction per `2026-05-28-003`.
- GOD gate: canonical envelope-emission — re-gate required.

---

## Key Technical Decisions

- **Router input is richer than `(kind, frontier)`.** Mirror `LiveSessionStateEnvelopeRequest` slices: update kind predicates, `previous_revision`, optional `transcript_delta`, derived interaction/tool ids, and per-kind `is_transcript_bearing` rule. Lifecycle/capabilities routes may need snapshotted session state from the spine.
- **`BuildPlan` carries kind-specific frontier inputs.** `{ builder, frontier_transition, is_transcript_bearing }` — interaction arm keeps `false`; transcript-bearing arms compute from operations.
- **Spike before full router module (U2).** Implement shared `frontier_plan_for_request(arm, request)` behind U1 goldens first; promote to `EnvelopeRouter` only if dispatch still sprawls.
- **Buffer peer: pure-over-inputs with lock-held snapshot contract.** Spine acquires `buffer_emissions`, materializes under nested `transcript_viewports`, captures `(prev_record, slice, rows, flags)` in one critical section, calls peer, writes emission under `buffer_emissions`. Peer does not acquire mutexes.
- **Characterization-first.** Inventory existing `runtime_registry` tests (~39 envelope/buffer scenarios from `:2183+`) before adding goldens; extend gaps for `build_additional_session_state_envelopes`, oversized-delta repair, non-transcript `AcceptDelta → None`.

---

## Open Questions

### Resolved During Planning

- Fold `projections/mod.rs` into this plan? **Phase 2** — same pattern, separate PR; retargeted to `session_lifecycle.rs` spine after discovering `mod.rs` is already a barrel.

### Deferred to Implementation

- Router output as pure `BuildPlan` value vs trait-dispatched builder — settle after first two kinds routed.
- Exact mutex boundary for buffer peer — resolved by lock-held snapshot contract above, not deferred.

---

## High-Level Technical Design

```
BEFORE:  build_live_session_state_envelope (:329-511)
           ├─ kind guards → delegated builders
           ├─ inline frontier match (tool-call patch)     ─ decide_frontier_transition
           ├─ inline frontier match (transcript delta)    ─ decide_frontier_transition
           ├─ build_turn_state_delta_envelope             ─ decide_frontier_transition
           └─ build_interaction_delta_envelope            ─ decide_frontier_transition (is_transcript_bearing: false)
           build_or_advance_viewport_buffer_envelope      ─ classify + overrides under locks

AFTER:   spine
           ├─ EnvelopeRouter(request) → BuildPlan         (per-arm frontier + is_transcript_bearing)
           ├─ builder(plan)                               (no frontier recompute)
           └─ under buffer_emissions → transcript_viewports:
                snapshot inputs → BufferProducer → Emission → write record
```

---

## Implementation Units

### Phase 1 — runtime_registry.rs

### U1. Characterize routing and buffer-emission behavior

**Goal:** Pin envelope output per update kind and buffer push/delta/no-op decisions; fence secondary paths.

**Requirements:** R6

**Dependencies:** None

**Files:**
- Test: extend `runtime_registry.rs` `#[cfg(test)]` module (`:2183+`) — inventory existing cases first
- Add gaps: `build_additional_session_state_envelopes` ordering (`:537–563`), `delta_or_snapshot_repair` oversized fallback (`:724+`, test at `:3554`), non-transcript `AcceptDelta → None` (`:509`)

**Approach:**
- Contract assertions per kind (existing style) or opt-in insta/json goldens — document baseline either way.
- Buffer: push, delta, no-op, identity guard, B4 height FreshPush (`:4253+`).

**Verification:** Green on current code; every kind + buffer branch + secondary paths covered.

---

### U2. Extract `EnvelopeRouter` with per-arm frontier decisions

**Goal:** Move kind→builder selection and frontier-transition into a named module; preserve per-kind `is_transcript_bearing`.

**Requirements:** R1, R2

**Dependencies:** U1

**Files:**
- Create: `session_state_engine/envelope_router.rs`
- Modify: `runtime_registry.rs` (call router; builders accept `BuildPlan`)
- Test: `session_state_engine/envelope_router` tests

**Approach:**
- Router returns `BuildPlan { builder, frontier_transition, is_transcript_bearing }`.
- Cover all four frontier sites including inline tool-call (`:408–470`) and transcript-delta (`:477–510`) arms.
- Optional spike: `frontier_plan_for_request` helper first, then promote to module.

**Test scenarios:**
- Interaction + non-empty `transcript_delta` → `is_transcript_bearing: false` preserved.
- Each kind → correct `BuildPlan` without registry.

**Verification:** U1 goldens reproduced; frontier asserted per arm.

---

### U3. Extract the buffer producer as a peer module

**Goal:** Lift classification + override layer into testable peer; spine keeps lock acquisition.

**Requirements:** R3, R5

**Dependencies:** U1

**Files:**
- Create: `session_state_engine/viewport_buffer_producer.rs` (wrap existing `classify_buffer_transition`/`compute_buffer_delta` + override block `:1271–1313`)
- Modify: `runtime_registry.rs` (`build_or_advance_viewport_buffer_envelope` — locks in documented order, snapshot inputs, delegate, write)
- Test: `viewport_buffer_producer` tests

**Approach:**
- Pure `decide_buffer_emission(prev, slice, full_rows, flags) -> BufferEmission` covering classifier + identity guard + B4 height override.
- U3 acceptance: grep confirms `buffer_emissions` before `transcript_viewports` unchanged.

**Verification:** Buffer producer unit-tested without mutexes; U1 buffer goldens reproduced.

---

### U4. Reduce `build_live_session_state_envelope` to a spine

**Goal:** Method becomes router dispatch + builder invoke; buffer path delegates to peer.

**Requirements:** R4, R6

**Dependencies:** U2, U3

**Files:**
- Modify: `runtime_registry.rs`

**Approach:**
- Collapse to dispatch; measure body LOC against R4 acceptance criteria.

**Verification:** R4 metrics met; all U1 characterization green; GOD re-gate documented; `cargo clippy` clean.

---

### Phase 2 — projections apply spine (separate PR; **blocked on plan 007 U3**)

### U5. Characterize and split the projection apply path

**Goal:** Apply router/peer pattern to `session_lifecycle.rs:apply_session_update` (`:131–235`), not a monolithic `mod.rs`.

**Requirements:** R1 (analogue), R6

**Dependencies:** U4; **hard gate: plan 007 (`2026-06-11-007`) U3 complete** (live display-id synthesis in `session_lifecycle.rs` must be stable)

**Files:**
- Test: `projections/` characterization (per `SessionUpdate` variant + three entry-point idempotency: `apply_session_update` / `apply_session_update_at_event_seq` / `apply_canonical_event` at `:237–307`)
- Modify: `projections/session_lifecycle.rs` (thin apply router spine)
- **Do not relocate** `relink_tool_call_to_transcript_event_seq` (`operations.rs:17`) or `ensure_transcript_tool_operations` (`session_materialization/mod.rs:130`) until plan 007 lands

**Approach:**
- Characterize idempotency differences across three entry points first.
- Extract apply router only — `operations.rs` / `interactions.rs` peers already exist.

**Verification:** Characterization green; GOD re-gate documented; no conflict with plan 007 id authority.

---

## System-Wide Impact

- **Interaction graph:** Router and buffer peer consumed only by registry spine; envelope output to bridge/TS unchanged.
- **State lifecycle risks:** Lock order is highest concurrency risk — stays at spine, unchanged.
- **Unchanged invariants:** Canonical emission semantics preserved.

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Lock order inverted during refactor | Med | High | Document `buffer_emissions → transcript_viewports`; U3 grep audit |
| Single frontier flag changes interaction routing | Med | High | `BuildPlan.is_transcript_bearing` per arm; U2 characterization |
| Buffer peer widens race window | Med | High | Lock-held snapshot contract in U3 |
| Phase 2 conflicts with plan 007 | Med | High | **Hard gate** on U5; defer repair relocations |
| Registry still large after Phase 1 | High | Low | R4 metrics exclude test module; lifecycle extraction deferred |

---

## Sources & References

- Architecture review candidate 8 (re-baselined against current tree).
- Related: `2026-05-28-003-refactor-split-large-modules-plan.md`; plan 007 (`2026-06-11-007`) for Phase 2 gate.
- CONTEXT.md GOD gate.
