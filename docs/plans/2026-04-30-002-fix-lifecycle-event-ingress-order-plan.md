---
title: fix: Enforce lifecycle-before-provider-event ingress
type: fix
status: active
date: 2026-04-30
origin: docs/brainstorms/2026-04-25-final-god-architecture-requirements.md
---

# fix: Enforce lifecycle-before-provider-event ingress

## Overview

Fresh Copilot session creation can fail immediately because a provider capability update reaches the shared runtime graph before the new session lifecycle is formally reserved. The early update creates a `SessionSupervisor` checkpoint as a side effect, then `acp_new_session` later calls `reserve` for the same session id and receives `AlreadyReserved`.

This plan fixes the shared Rust session lifecycle/event-ingress architecture. Copilot is the reproducer, but the invariant is provider-agnostic: provider facts may update capabilities, transcript, operations, or interactions only after `SessionSupervisor` owns lifecycle existence for that session. TypeScript must remain a canonical-envelope consumer; no TS fallback or Copilot-specific UI branch is part of the fix.

## Problem Frame

The final GOD architecture requires one product-state authority path: provider facts/history/live events -> provider adapter edge -> canonical session graph -> revisioned materializations -> desktop stores/selectors -> UI (see origin: `docs/brainstorms/2026-04-25-final-god-architecture-requirements.md`).

The reproduced failure violates that boundary:

1. `acp_new_session` starts a Copilot subprocess and calls provider `new_session`.
2. Copilot returns/announces session `6e96a1bb-dc6e-4476-91ae-49f26f310c01` and emits `available_commands_update` early.
3. Rust event ingress accepts the update before `SessionSupervisor::reserve` has completed for that session.
4. `ui_event_dispatcher` / `SessionGraphRuntimeRegistry` calls into the supervisor and stores a checkpoint for an unknown lifecycle session.
5. `acp_new_session` continues and calls `SessionSupervisor::reserve`, which correctly rejects the duplicate in-memory entry as already reserved.
6. The user sees `Creation failed (MetadataCommitFailed): Failed to reserve lifecycle runtime checkpoint... already reserved`.

The architectural issue is not that `reserve` rejects duplicates. The issue is that capability/provider updates can create supervisor lifecycle existence. That makes lifecycle a side effect of arbitrary provider timing instead of a deliberate session-creation transition.

## Requirements Trace

Requirements are grouped by concern; stable R-numbering is intentionally not strictly sequential across headings.

### Lifecycle Authority & Event Sequencing

- R1. Preserve one product-state authority path for sessions: provider facts -> backend/provider edge -> canonical session graph -> desktop selectors/UI.
- R2. Provider adapter outputs must not publish canonical lifecycle conclusions directly; only supervisor/graph reducer may produce lifecycle states (origin R4a).
- R3. Provider sequencing normalization must happen before graph application, and graph reducer must accept only ordered canonical events or explicit edge errors (origin R4b).
- R4. Session lifecycle truth must be backend/supervisor-owned and revision-bearing across the seven-state lifecycle (origin R10).
- R6. Delivery watermarks, event sequence IDs, and buffering are delivery mechanics only; semantic acceptance happens when the canonical graph reducer applies validated events (origin R22-R22a).

### Desktop Derivation & First-Send Routing

- R5. Desktop lifecycle/actionability/capabilities must derive from canonical selectors only; no hot-state or UI fallback patch (origin R12-R13).
- R7. Fresh `Reserved` sessions must still route first send through direct send, while `Detached` sessions authorize resume/load (`docs/concepts/session-lifecycle.md` and `docs/solutions/logic-errors/reserved-first-send-routed-through-resume-2026-04-28.md`).

### History Restore Integrity

- R8. Missing, unparseable, or unavailable provider history remains an explicit restore failure and is not repaired by local duplicate content.

### Buffer Safety & Diagnostics

- R9. Pre-reservation buffering must be in-memory delivery plumbing only: not persisted, not exposed to desktop stores/selectors, bounded to at most 16 buffered events and 64 KiB serialized payload per provider/client/session key, 128 buffered session keys globally, and 2 MiB total serialized payload globally unless stricter existing queue limits are reused, and discarded on creation failure, creation cancellation, provider-client stop, or app shutdown.
- R10. Orphan, overflow, and replay diagnostics must be sanitized and coalesced. They may include update kind, provider/agent id, non-secret session correlation, counts, and reason codes; they must not include raw provider payloads, command bodies, capability bodies, environment values, credentials, or file contents. Diagnostic emission must be bounded to one immediate diagnostic per provider/client/session key and reason plus a summary count on drain/discard.
- R11. Provider session ids are trust-boundary data. Buffer keys must be namespaced by a Rust-runtime-assigned provider/client handle plus provider session id, never by a provider-supplied identity namespace, and buffered events may replay only into the matching lifecycle-reserved session produced by the same creation path.

## Scope Boundaries

- This plan changes shared Rust lifecycle/event-ingress behavior, not Copilot-specific UI behavior.
- This plan does not introduce a new provider identity model; completed `session_metadata.id` remains the provider-owned canonical id, and pre-provider work remains in `creation_attempts`.
- This plan does not reintroduce local transcript/runtime checkpoint restore authority.
- This plan does not move lifecycle/actionability/capabilities into TypeScript transient state.
- This plan does not redesign first-send routing; it preserves the existing `Reserved` direct-send / `Detached` resume-load contract.
- This plan does not require changing `@acepe/ui` presentational components.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src-tauri/src/acp/lifecycle/supervisor.rs` owns `SessionSupervisor::reserve`, `record_session_update`, `transition_lifecycle`, `transition_lifecycle_state`, and checkpoint storage. Today, checkpoint replacement can implicitly create an entry.
- `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs` wraps the supervisor and currently applies session updates by replacing checkpoints.
- `packages/desktop/src-tauri/src/acp/ui_event_dispatcher.rs` is the provider event-ingress layer. It applies raw session updates into projections and persists/applies dispatch events.
- `packages/desktop/src-tauri/src/acp/session_journal.rs` limits persisted projection journal updates to a subset of session updates. Capability-class updates such as `available_commands_update` can take the non-journaled path.
- `packages/desktop/src-tauri/src/acp/commands/session_commands.rs` creates sessions and calls `SessionSupervisor::reserve` after provider `new_session` and metadata promotion.
- `packages/desktop/src-tauri/src/acp/client_transport.rs` and provider client loops deliver provider `session/update` notifications into the shared event dispatcher.
- `packages/desktop/src-tauri/src/acp/projections/mod.rs` can create projection snapshots independently from lifecycle if raw updates are applied too early.
- `packages/desktop/src-tauri/src/db/repository.rs` contains `SessionJournalEventRepository::append_session_update` and materialization barriers.
- Existing tests in `packages/desktop/src-tauri/src/acp/lifecycle/supervisor_tests.rs`, `packages/desktop/src-tauri/src/acp/ui_event_dispatcher.rs`, and `packages/desktop/src-tauri/src/acp/commands/tests.rs` provide the main seams.

### Institutional Learnings

- `docs/concepts/session-lifecycle.md` defines `Reserved` as the pre-live first-send state and says provider adapters emit facts while only the supervisor/graph reducer emits canonical lifecycle conclusions.
- `docs/solutions/architectural/revisioned-session-graph-authority-2026-04-20.md` says unknown-session envelopes must not fire side effects early and raw updates/canonical envelopes must respect pending-session buffering.
- `docs/solutions/logic-errors/reserved-first-send-routed-through-resume-2026-04-28.md` documents the previous split-authority failure class: `Reserved` first-send must not route through resume/load, and missing graph authority must fail closed instead of falling back to hot state.
- `docs/solutions/architectural/provider-owned-session-identity-2026-04-27.md` says pre-provider work belongs in `creation_attempts`, completed sessions are stored under provider-owned ids, and fake session metadata rows must not be inserted to reserve intent.
- `docs/solutions/architectural/final-god-architecture-2026-04-25.md` confirms lifecycle/actionability/activity/capability selectors are canonical graph outputs, not transient or raw-lane truth.

### External References

- None. Local GOD architecture documents and the observed Tauri failure are the governing source.

## Key Technical Decisions

- **Decision: fix the shared lifecycle/event-ingress layer, not Copilot.** Copilot merely exposes the race by emitting capabilities early; any provider can emit a pre-reservation fact.
- **Decision: only lifecycle-authorized paths may create supervisor entries.** `reserve`, restore/seed paths for known restored sessions, and explicitly reviewed creation-attempt promotion paths may create lifecycle existence. Arbitrary update application may not.
- **Decision: event ingress must fail closed or buffer before lifecycle exists.** A provider update for an unknown lifecycle session must not mutate projections, transcript projections, runtime graph, or journal semantics as product state. For useful early capability updates, buffering and replay after reservation is preferred to dropping.
- **Decision: the pre-reservation buffer is a standalone delivery component.** It must not live inside `SessionSupervisor` or become a readable graph/runtime source. It should sit beside shared ACP event-ingress state and expose only narrow operations to buffer an unknown-session update, drain a now-reserved session through the normal dispatcher path, and discard pending delivery facts for failed/cancelled sessions.
- **Decision: the buffer owns per-session drain serialization.** The buffer should model each key as `collecting -> draining -> open` or `collecting -> discarded`. `DispatcherSink::enqueue` and direct-publish paths consult that state before touching projections. `acp_new_session` calls the buffer's drain operation after `reserve` and relies on that operation's per-session ordering guarantee; it must not add an independent global dispatcher lock.
- **Decision: capability updates are facts, not lifecycle.** `available_commands_update` may enrich `SessionGraphCapabilities` after `Reserved`, but it cannot create `Reserved`.
- **Decision: preserve provider-owned identity ordering.** Do not reserve a completed session before provider id is known and metadata promotion has succeeded. If updates arrive in the narrow gap after provider id is known but before reserve completes, ingress buffering handles the ordering.
- **Decision: keep TS passive.** The fix should produce correct Rust canonical envelopes/open results; TypeScript should not special-case `already reserved`, synthesize lifecycle, or fall back to transient state.

## Open Questions

### Resolved During Planning

- **Should this be Copilot-specific?** No. The failing event is Copilot's `available_commands_update`, but the invariant belongs to shared lifecycle/event ingress.
- **Should `reserve` ignore `AlreadyReserved`?** No as the primary fix. Blind idempotence would mask the illegal creator and allow lifecycle existence to remain a side effect of provider timing.
- **Should pre-reservation capability updates be dropped?** Not as the preferred endpoint. They are useful facts for first activation and should be buffered when feasible, then replayed after `Reserved`.
- **Should reserve move before provider `new_session`?** Not for synchronous provider-owned ids. The completed session id is unknown until the provider returns; pre-provider intent belongs in `creation_attempts`.
- **Should TS show a friendlier error only?** No. Better copy without fixing the lifecycle race would preserve split authority.

### Deferred to Implementation

- **Exact internal storage primitive for the standalone buffer:** implementation should choose the narrowest existing shared-state registration pattern that lets `ui_event_dispatcher` buffer and `acp_new_session` drain/discard without making the buffer a graph authority.

## Pre-Reservation Update Policy

Unknown-session ingress must classify updates before any projection, journal, transcript, or runtime graph mutation:

| Update category | Variants | Pre-reservation handling |
|-----------------|----------|--------------------------|
| Capability/config facts | `AvailableCommandsUpdate`, `CurrentModeUpdate`, `ConfigOptionUpdate` | Buffer when a provider session id is present and the buffer is within count/byte limits. On overflow or invalid replay, drop the fact with sanitized coalesced diagnostics and continue creation from safe degraded canonical state. |
| Transcript/content/operation evidence | `UserMessageChunk`, `AgentMessageChunk`, `AgentThoughtChunk`, `ToolCall`, `ToolCallUpdate`, `Plan` | Do not buffer. Treat before reservation as an edge-ordering violation: no product-state mutation; fail the active session-scoped creation if it belongs to one, otherwise emit sanitized orphan diagnostics. |
| Interaction/turn lifecycle evidence | `PermissionRequest`, `QuestionRequest`, `TurnComplete`, `TurnError` | Do not buffer. Treat before reservation as semantically unsafe edge ordering: no product-state mutation; fail the active session-scoped creation if it belongs to one, otherwise emit sanitized orphan diagnostics. |
| Connection lifecycle notifications | `ConnectionComplete`, `ConnectionFailed` | Must target a known lifecycle session or a reviewed resume/reconnect path. Unknown-session calls are rejected by typed guard and sanitized diagnostics. |
| Telemetry | `UsageTelemetryUpdate` | Do not buffer before lifecycle exists. Drop with sanitized diagnostics; telemetry must never create lifecycle or actionability. |
| Missing session id or unknown/future variant | Any update with no provider session id, or any future `SessionUpdate` variant not classified here | Fail closed: no product-state mutation, no buffering, sanitized diagnostics only. |

Buffered events receive no trust elevation. During drain, each event must pass the same ingress validation and canonical reducer path as a live event of the same category.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
CURRENT FAILURE

Provider early update
        |
        v
ui_event_dispatcher
        |
        v
runtime graph applies update
        |
        v
SessionSupervisor checkpoint is created as side effect
        |
        v
acp_new_session calls reserve()
        |
        v
AlreadyReserved
```

```text
TARGET FLOW

Provider early update
        |
        v
event ingress asks: does SessionSupervisor own lifecycle?
        |
        +-- no  --> classify update before mutation
        |          capability/config + key + within limits -> buffer
        |          everything else -> sanitized edge/orphan diagnostic
        |
        +-- yes --> apply through canonical graph path

acp_new_session
        |
        v
provider returns canonical session id
        |
        v
metadata promotion succeeds
        |
        v
SessionSupervisor reserve() creates Reserved lifecycle
        |
        v
drain buffered provider facts first, under per-session ordering
        |
        v
emit/session-open canonical graph materialization
```

Core invariant:

```text
No provider event may create lifecycle existence.
```

## Implementation Units

- [x] **Unit 1: Characterize pre-reservation provider update race**

**Goal:** Add failing coverage that proves an early provider capability update can currently create supervisor state before `acp_new_session` reserves lifecycle.

**Requirements:** R1, R2, R4, R6

**Dependencies:** None

**Files:**
- Test: `packages/desktop/src-tauri/src/acp/lifecycle/supervisor_tests.rs`
- Test: `packages/desktop/src-tauri/src/acp/ui_event_dispatcher.rs`
- Test: `packages/desktop/src-tauri/src/acp/commands/tests.rs`
- Reference: `packages/desktop/src-tauri/src/acp/session_update.rs`

**Approach:**
- Create a focused supervisor-level characterization showing that update/checkpoint replacement for an unknown session can seed a snapshot that later blocks `reserve`.
- Create an event-ingress characterization using an `available_commands_update`-style session update before lifecycle reservation; assert the current behavior creates or advances runtime state for an unknown session.
- Add a command-level regression harness with a fake subprocess/provider path that emits an early capability update before new-session reservation completes, then assert creation currently fails with `AlreadyReserved`.
- Keep tests behavior-oriented: exercise supervisor/dispatcher/command APIs rather than source-text assertions.

**Execution note:** Test-first. These tests should fail before the architecture fix and pass after Units 2-4.

**Patterns to follow:**
- Existing setup helpers in `packages/desktop/src-tauri/src/acp/lifecycle/supervisor_tests.rs`.
- Dispatcher persistence tests in `packages/desktop/src-tauri/src/acp/ui_event_dispatcher.rs`.
- Creation/session command tests in `packages/desktop/src-tauri/src/acp/commands/tests.rs`.

**Test scenarios:**
- Happy path regression setup: unknown session receives an early capability update, then later lifecycle reservation is attempted -> before the fix this reproduces `AlreadyReserved`.
- Edge case: a journaled provider update before reservation must not be allowed to create a lifecycle checkpoint either.
- Integration: a fake provider emits `available_commands_update` before the session creation command reaches reserve; new-session creation must be the cross-layer behavior under test.

**Verification:**
- The failing tests name the race precisely and do not depend on Copilot binaries or live Tauri state.

- [x] **Unit 2: Make SessionSupervisor lifecycle creation explicit**

**Goal:** Enforce at the lowest shared layer that only lifecycle-authorized paths can create supervisor entries.

**Requirements:** R1, R2, R4, R6

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/lifecycle/supervisor.rs`
- Modify/test: `packages/desktop/src-tauri/src/acp/lifecycle/supervisor_tests.rs`
- Review: `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs`

**Approach:**
- Split the internal checkpoint write behavior into explicit creation versus existing-session update semantics.
- Keep `reserve` as the normal new-session creator and keep reviewed restore/seed paths as explicit creators.
- Change update/transition paths so an unknown lifecycle session cannot be silently inserted through checkpoint replacement.
- Return or log a typed unknown-session outcome rather than pretending the update was accepted. Avoid broad silent failure; the caller should be able to buffer or surface an edge-ordering problem.
- Preserve existing behavior for known sessions: lifecycle transitions still advance runtime epoch, capability updates still update capabilities, and ready/detached/failed states remain canonical.

**Execution note:** Keep this unit minimal and root-cause-focused. Do not change Copilot or TypeScript while proving the supervisor invariant.

**Patterns to follow:**
- `SessionSupervisor::seed_checkpoint` already guards explicit insertion.
- `SessionSupervisor::reserve` already rejects duplicate lifecycle creation.
- Seven-state lifecycle semantics in `packages/desktop/src-tauri/src/acp/lifecycle/state.rs` and `transition.rs`.

**Test scenarios:**
- Happy path: `reserve` on a session with no checkpoint creates `Reserved` and advances the frontier.
- Edge case: a checkpoint replacement/update for an unknown session does not create `snapshot_for_session`.
- Edge case: after an unknown-session update attempt, `reserve` for that session still succeeds.
- Error path: duplicate `reserve` after a legitimate reservation still returns `AlreadyReserved`.
- Integration: known-session capability/update paths still update the existing checkpoint and do not regress runtime epoch behavior.

**Verification:**
- `SessionSupervisor` becomes structurally unable to let arbitrary update application create lifecycle existence.

- [x] **Unit 3: Gate and buffer provider events at Rust event ingress**

**Goal:** Ensure provider events for unknown lifecycle sessions cannot mutate projection/runtime/transcript state, while preserving early capability facts for replay after reservation.

**Requirements:** R1, R2, R3, R6, R9, R10, R11

**Dependencies:** Unit 2

**Files:**
- Create/modify: `packages/desktop/src-tauri/src/acp/pre_reservation_event_buffer.rs`
- Modify: `packages/desktop/src-tauri/src/acp/ui_event_dispatcher.rs`
- Review: `packages/desktop/src-tauri/src/acp/client_transport.rs`
- Modify/review: `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs`
- Review: `packages/desktop/src-tauri/src/acp/projections/mod.rs`
- Test: `packages/desktop/src-tauri/src/acp/ui_event_dispatcher.rs`

**Approach:**
- Add a lifecycle-existence gate before event ingress applies provider updates to projection, journal, transcript projection, or runtime graph.
- Put the first gate at the top of `DispatcherSink::enqueue`, before `session_domain_event_from_update`, `ProjectionRegistry::apply_canonical_event`, or `ProjectionRegistry::apply_session_update` can run. A later `persist_dispatch_event` guard is still needed for journal/supervisor paths, but it is not sufficient alone.
- Route `publish_direct_session_update` through the same gate, or prove and guard that its callers only target lifecycle-known sessions. Unknown-session direct-publish calls must be rejected before `ProjectionRegistry::apply_session_update`.
- For updates whose session is not yet lifecycle-known, classify them with the Pre-Reservation Update Policy. Only capability/config facts with a provider session id are eligible for the standalone pre-reservation buffer keyed by Rust-runtime-assigned provider/client handle plus provider session id.
- Keep hard bounds in the buffer implementation: at most 16 buffered events and 64 KiB serialized payload per provider/client/session key, 128 buffered session keys globally, and 2 MiB serialized payload globally unless stricter existing queue limits are reused. Overflow must not apply product state; it must emit a sanitized coalesced diagnostic and follow the Pre-Reservation Update Policy.
- Do not persist buffered events. Discard them on creation failure before reserve, creation cancellation, provider-client stop, explicit orphan cleanup, or app shutdown.
- Preserve FIFO ordering for each session and avoid cross-session blocking. The drain serialization mechanism must be per-session-scoped; do not use a global dispatcher lock that stalls unrelated reserved sessions.
- Replay buffered events only after lifecycle reservation exists for that session. The buffer's per-session state must hold later live events for that same key behind the drain until the state transitions to `open`.
- During drain, replay each buffered event through the identical validation and canonical reducer path used for live ingress. Buffering must not mark an event trusted or pre-validated.
- Treat updates that cannot be buffered safely as explicit orphan/edge-ordering diagnostics rather than product-state mutations.
- Ensure both journaled and non-journaled updates respect the same gate. The `Ok(None)` non-journaled path is not the only path that can create state.
- Avoid applying raw updates to `ProjectionRegistry` before the lifecycle gate. The projection registry is also product graph state and must not be pre-reservation authority.
- Review `client_transport.rs` only to confirm live provider updates route through the gated dispatcher. Existing direct `ProjectionRegistry::apply_session_update` test setup does not need lifecycle gating; any live bypass must be routed through the shared gate instead of adding a second divergent gate.
- Review `projections/mod.rs` only to confirm no lifecycle dependency is added there. The projection registry should stay lifecycle-unaware; the gate belongs before callers invoke it.

**Execution note:** Add behavior tests for both non-journaled capability updates and journaled interaction/turn updates so the guard is not accidentally scoped only to `available_commands_update`.

**Patterns to follow:**
- Pending-session buffering rule in `docs/solutions/architectural/revisioned-session-graph-authority-2026-04-20.md`.
- Existing per-session ordering and queue logic in `packages/desktop/src-tauri/src/acp/ui_event_dispatcher.rs`.

**Test scenarios:**
- Happy path: early `available_commands_update` for an unknown session is buffered and does not create a supervisor checkpoint.
- Happy path: after `reserve`, buffered `available_commands_update` replays and capabilities appear in the canonical runtime graph.
- Edge case: multiple early updates for the same session replay in original order.
- Edge case: early updates for session A do not block normal updates for already-reserved session B.
- Edge case: a post-reservation live event for session A arrives while session A is draining; it waits behind the buffered drain, while session B continues normally.
- Edge case: an update with no session id before reservation is rejected with sanitized diagnostics and does not create graph/projection state.
- Error path: a pre-reservation `PermissionRequest`, `ToolCall`, or `TurnComplete` is rejected as edge-ordering violation and does not enter the buffer.
- Error path: creation fails after buffering but before reserve; buffered updates for that provider/client/session key are discarded and cannot replay into a later attempt.
- Error path: buffer count or byte overflow emits coalesced sanitized diagnostics and does not mutate product state.
- Error path: an update for a session that never becomes reserved is reported/cleaned as orphaned without mutating product state.
- Integration: projection registry does not have product session state for a buffered unknown-session update before reservation.

**Verification:**
- Provider ingress cannot race ahead of lifecycle authority, and useful early capability facts are preserved through the buffer.

- [x] **Unit 4: Flush buffered events from new-session reservation**

**Goal:** Wire the creation flow so synchronous provider sessions reserve lifecycle, then release buffered provider facts before the session is exposed as a completed open result.

**Requirements:** R3, R4, R6, R9, R10, R11

**Dependencies:** Units 2-3

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
- Modify/review: `packages/desktop/src-tauri/src/acp/pre_reservation_event_buffer.rs`
- Review: `packages/desktop/src-tauri/src/acp/session_open_snapshot/mod.rs`
- Modify/review: `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs`
- Test: `packages/desktop/src-tauri/src/acp/commands/tests.rs`

**Approach:**
- Keep `creation_attempts` and metadata promotion ordering intact: provider id must be known, metadata promotion must succeed, then lifecycle reservation happens.
- Immediately after successful `reserve`, ask the pre-reservation buffer to drain pending updates for that provider/client/session key through the normal canonical graph path.
- Drain buffered updates before the session open result is exposed and before later live events for that session can overtake the drained updates.
- Build the new-session open result from the post-reservation graph state so the desktop receives a `Reserved` lifecycle plus any safe early capabilities that were replayed.
- If replay of buffered capability/config facts fails validation, drop the invalid fact with a sanitized diagnostic and continue creation from the reserved graph state. If drain fails because of an internal graph/reducer error after `reserve`, transition the session-scoped lifecycle to `Failed` with a sanitized reason, discard the buffer, stop only the affected provider client/session path, and do not emit a successful open result.
- Pre-reservation transcript, interaction, turn, lifecycle, telemetry, missing-session-id, and unknown/future update categories should never be present in the drain because Unit 3 rejects them before buffering.
- If capability/config overflow happened before reservation, open from the safe post-drain graph state with degraded/missing capabilities rather than TS fallback or local repair. Later canonical provider updates may enrich capabilities through the normal live path.
- Ensure creation failure before `reserve`, replay failure that aborts creation, and provider-client teardown all discard buffered updates for the provider/client/session key.
- Keep deferred-creation providers separate: pending creation remains keyed by creation attempt until provider identity is proven; do not pretend a completed session exists early.
- Treat R7 as an unchanged constraint in this unit: returning `Reserved` must preserve first-send direct-send semantics, but TS routing verification belongs to Unit 5.
- Review `session_open_snapshot/mod.rs` to confirm the open result consumes the capabilities/session graph snapshot supplied by `session_commands.rs`; only modify it if that contract currently prevents post-drain graph materialization.

**Execution note:** Extend the command-level regression from Unit 1 so it proves the full fix: early provider update, successful creation, `Reserved` lifecycle, capabilities preserved, no `MetadataCommitFailed`.

**Patterns to follow:**
- `persist_session_metadata_for_cwd` and `SessionMetadataRepository::promote_creation_attempt` ordering in `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`.
- `session_open_result_for_new_session` and graph snapshot builders in `packages/desktop/src-tauri/src/acp/session_open_snapshot/mod.rs`.
- Provider-owned identity invariant in `docs/solutions/architectural/provider-owned-session-identity-2026-04-27.md`.

**Test scenarios:**
- Happy path: fake provider emits early `available_commands_update`; `acp_new_session` succeeds and returns a new-session open result.
- Happy path: returned open result has `lifecycle.status = Reserved` and contains replayed capability data when the early update was valid.
- Edge case: no early updates still follows the normal creation path.
- Error path: invalid buffered capability/config fact is dropped with sanitized diagnostics and creation still succeeds from the reserved graph state.
- Error path: capability/config overflow before reservation opens with safe degraded canonical capabilities and emits sanitized diagnostics; no TS fallback fills the gap.
- Error path: semantically unsafe pre-reservation transcript/interaction/turn update never reaches drain and becomes a sanitized typed creation/edge error instead of a generic `AlreadyReserved`.
- Error path: internal drain failure after reservation marks the session-scoped lifecycle failed and does not expose a successful open result.
- Error path: metadata promotion fails after early buffering but before reserve; the buffer entry is discarded and cannot affect a later creation attempt.
- Integration: session registry stores the client only after metadata, reservation, and buffered-event replay are complete.

**Verification:**
- New synchronous provider sessions can no longer fail because an early event pre-created supervisor state.

- [x] **Unit 5: Prove desktop remains canonical-only**

**Goal:** Verify the Rust fix produces the canonical lifecycle/capability state needed by desktop without adding TypeScript fallback authority.

**Requirements:** R5, R7, R8

**Dependencies:** Units 2-4

**Files:**
- Review/test: `packages/desktop/src/lib/acp/store/services/first-send-activation.ts`
- Review/test: `packages/desktop/src/lib/acp/store/services/session-messaging-service.ts`
- Review/test: `packages/desktop/src/lib/acp/store/__tests__/session-store-create-session.vitest.ts`
- Review/test: `packages/desktop/src/lib/acp/store/services/session-connection-manager.test.ts`
- Review/test: `packages/desktop/src/lib/acp/store/session-store.svelte.ts`

**Approach:**
- Confirm no TypeScript code was changed to handle the failure by reading transient/hot state lifecycle or by special-casing Copilot.
- If existing tests already cover `Reserved` first-send direct-send routing, ensure they still pass with the new Rust behavior.
- Add or update a narrow store-level regression only if the Rust open result shape changes what TS receives.
- Keep `localPersistedSessionProbeStatus` and other allowed transient fields unchanged; they are not lifecycle authority.

**Execution note:** This unit is primarily verification and guardrail. Do not add `canonical ?? hotState` fallback or client-side canonical synthesis.

**Patterns to follow:**
- `docs/solutions/logic-errors/reserved-first-send-routed-through-resume-2026-04-28.md`.
- GOD architecture check rules for canonical-overlap fields.

**Test scenarios:**
- Happy path: created `Reserved` session first prompt routes through direct send, not `connectSession`.
- Edge case: created session with missing canonical lifecycle still fails closed and does not infer sendability from hot/transient state.
- Integration: the new Rust creation flow yields the same TS-level actionability as a normal backend-authored `Reserved` open snapshot.

**Verification:**
- No desktop fallback or provider-specific UI patch is introduced, and first-send routing remains graph-backed.

- [x] **Unit 6: Regression verification and documentation**

**Goal:** Close the loop with targeted tests, live reproduction, and durable learning.

**Requirements:** R1-R11

**Dependencies:** Units 1-5

**Files:**
- Update: `docs/solutions/logic-errors/`
- Verify: `packages/desktop/src-tauri/src/acp/lifecycle/supervisor_tests.rs`
- Verify: `packages/desktop/src-tauri/src/acp/ui_event_dispatcher.rs`
- Verify: `packages/desktop/src-tauri/src/acp/commands/tests.rs`
- Verify: `packages/desktop/src/lib/acp/store/__tests__/session-store-create-session.vitest.ts`

**Approach:**
- Run focused Rust tests around supervisor, dispatcher, and session commands before broader Rust validation.
- Run focused TypeScript store tests only if Unit 5 touches TS behavior or generated types.
- Reproduce the original live scenario through the Tauri MCP bridge or human smoke: create a fresh Copilot session in `sandbox`, observe no immediate `MetadataCommitFailed`, send a first prompt, confirm direct-send behavior and visible response.
- Capture a solution note explaining the invariant: capability facts cannot create lifecycle existence.
- If any older plan/solution implies update application may create lifecycle implicitly, mark it superseded or clarify it.

**Execution note:** Verification should prove the actual user-visible failure, not only a lower-level unit proxy.

**Patterns to follow:**
- Review-time regression checklist in `docs/solutions/architectural/provider-owned-session-identity-2026-04-27.md`.
- GOD closure notes in `docs/solutions/architectural/final-god-architecture-2026-04-25.md`.

**Test scenarios:**
- Integration: fresh Copilot-style session creation no longer produces `Creation failed (MetadataCommitFailed)` when early capabilities arrive.
- Integration: newly created session remains `Reserved` until first send and then transitions through the canonical lifecycle path.
- Error path: orphaned provider updates for never-reserved sessions are diagnosed/cleaned and never materialize UI product state.
- Error path: orphan, overflow, and replay diagnostics contain no raw provider payloads or credential-like values.
- Error path: repeated overflow/orphan events coalesce diagnostics by provider/client/session key and reason instead of emitting unbounded per-event logs.
- Regression: old missing-provider-history sessions still show explicit restore failure rather than being repaired by local journal/runtime state.

**Verification:**
- Targeted tests and live reproduction both confirm the original crash is gone without weakening GOD authority.

## System-Wide Impact

- **Interaction graph:** Provider update ingress, runtime graph, projection registry, transcript projection, and session creation command flow all share the same ordering boundary after this change.
- **Error propagation:** Early invalid/unclaimable provider updates become typed edge/orphan diagnostics or creation failures, not silent graph mutations or raw JSON-RPC leaks.
- **State lifecycle risks:** The key risk is introducing a buffer that becomes semantic authority. The buffer must store in-memory delivery facts only, be hard-bounded, never be read by desktop/product selectors, and replay through the normal canonical graph reducer after lifecycle exists.
- **API surface parity:** All providers using shared ACP event ingress benefit; Copilot is the primary regression test but the change should cover Cursor/OpenCode/subprocess providers where applicable.
- **Trust boundary:** Provider session ids are trusted only as provider-scoped correlation values. Buffer and replay matching must include provider/client identity to avoid cross-provider or stale-attempt collisions.
- **Provider-agnostic ingress:** Providers or helper paths that cannot supply a provider session id before lifecycle exists are not buffer-eligible. They fail closed with sanitized diagnostics rather than using `creation_attempts` as a fake session key.
- **Integration coverage:** Unit tests must include supervisor-only, dispatcher-ingress, and command-level creation flows; live Tauri/Copilot verification proves the real timing path.
- **Unchanged invariants:** `creation_attempts` remain pre-provider intent; completed sessions remain keyed by provider-owned ids; TypeScript remains canonical-envelope consumer; `Reserved` first-send direct-send routing remains unchanged.

## Alternative Approaches Considered

- **Make `reserve` idempotent whenever a checkpoint exists.** Rejected as the primary architecture because it legitimizes the illegal creator and can hide lifecycle seeded by arbitrary provider timing.
- **Drop all pre-reservation provider updates.** Rejected as the preferred endpoint because `available_commands_update` can be the initial capability evidence that makes the fresh `Reserved` open result accurate before first user action. Dropping remains acceptable for overflow, orphaned, invalid, or semantically unsafe updates when paired with sanitized diagnostics and no product-state mutation.
- **Special-case Copilot's `available_commands_update`.** Rejected because provider-specific branches belong at adapter edges, and the lifecycle invariant is shared.
- **Patch TypeScript to recover from `MetadataCommitFailed`.** Rejected because it keeps split authority and does not prevent malformed Rust graph state.
- **Reserve before provider `new_session`.** Rejected for synchronous provider-owned ids because the canonical session id is not known yet; pre-provider work belongs in `creation_attempts`.
- **Two-phase supervisor reservation using creation-attempt id, then provider-id promotion.** Rejected for this fix because it introduces a second lifecycle identity and promotion/aliasing semantics inside the supervisor. That would weaken the provider-owned identity invariant and is heavier than a bounded in-memory delivery buffer that never becomes product state.

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Buffered early updates are never flushed | Medium | Missing initial capabilities or stale UI actionability | Flush from the creation path immediately after `reserve`; add command-level tests that assert capabilities survive |
| Buffer becomes a second semantic authority | Medium | GOD architecture regression | Keep buffer as delivery-only; replay through canonical reducer; no desktop reads from buffer |
| Buffer overflow or orphan retention grows memory | Medium | Memory pressure or hidden provider-loop failure | Hard-bound per-session/global buffer counts; discard on creation failure/client stop; emit sanitized diagnostics |
| Buffered payload bytes exhaust memory despite count caps | Medium | Desktop process memory pressure | Add per-key and global serialized byte caps; overflow drops delivery facts without product mutation |
| Drain ordering uses a global lock | Medium | Unrelated sessions stall during creation | Require per-session drain state (`collecting -> draining -> open/discarded`) and test cross-session non-blocking |
| Unknown-session updates are silently dropped | Medium | Debugging blind spots | Emit sanitized structured diagnostics and bounded cleanup logs; test orphan cleanup behavior |
| Supervisor hardening breaks legitimate restore/seed paths | Medium | Cold-open/reconnect regressions | Preserve explicit creation paths (`reserve`, reviewed seed/restore) and add tests for known-session update paths |
| Projection registry still mutates before lifecycle gate | Medium | Split graph state remains even if supervisor is fixed | Gate before projection application; add tests asserting no product projection exists before lifecycle reservation |
| Sanitized edge-ordering errors are still confusing | Medium | Users see a new opaque creation failure | Return typed creation errors with stable reason codes and no raw payloads; only fail creation for semantically unsafe replay failures |
| Fix accidentally changes first-send routing | Low | Fresh sessions route through resume/load again | Keep TS tests for `Reserved` direct-send and run focused store tests |

## Phased Delivery

### Phase 1: Failing characterization and supervisor invariant

- Add tests that reproduce the early-update/reserve race.
- Harden `SessionSupervisor` so update paths cannot implicitly create entries.

### Phase 2: Event-ingress buffering and creation flush

- Gate provider updates before product graph mutation.
- Buffer early per-session updates and flush after reservation in `acp_new_session`.

### Phase 3: Canonical-only verification and closure

- Confirm TypeScript remains canonical-only.
- Run targeted tests and live Copilot/Tauri reproduction.
- Document the solution as a durable GOD invariant.

## Documentation / Operational Notes

- Add a `docs/solutions/logic-errors/` learning after implementation, because this is a recurring GOD failure class: capability facts must not create lifecycle existence.
- If the implementation adds orphan, overflow, or replay diagnostics, document that diagnostics are local, sanitized, and payload-free. Do not persist raw buffered provider updates.
- No user-facing docs are required unless the error copy changes.

## Sources & References

- **Origin document:** `docs/brainstorms/2026-04-25-final-god-architecture-requirements.md`
- Concept: `docs/concepts/session-lifecycle.md`
- Prior learning: `docs/solutions/logic-errors/reserved-first-send-routed-through-resume-2026-04-28.md`
- Prior learning: `docs/solutions/architectural/revisioned-session-graph-authority-2026-04-20.md`
- Prior learning: `docs/solutions/architectural/provider-owned-session-identity-2026-04-27.md`
- Prior learning: `docs/solutions/architectural/final-god-architecture-2026-04-25.md`
- Related plan: `docs/plans/2026-04-28-001-fix-session-graph-authority-plan.md`
- Core code: `packages/desktop/src-tauri/src/acp/lifecycle/supervisor.rs`
- Core code: `packages/desktop/src-tauri/src/acp/ui_event_dispatcher.rs`
- Core code: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
- Core code: `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs`
