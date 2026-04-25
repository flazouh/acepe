---
title: "refactor: Async fire-and-forget session resume with event-driven completion"
type: refactor
status: active
date: 2026-04-12
origin: docs/brainstorms/2026-04-12-async-session-resume-requirements.md
---

# refactor: Async fire-and-forget session resume with event-driven completion

## Overview

Replace the blocking `acp_resume_session` Tauri invoke + frontend `withTimeout` race with a fire-and-forget invoke that returns immediately after validation, a `tokio::spawn` async task in Rust that does the heavy work under a single authoritative timeout, and lifecycle events (`connectionComplete` / `connectionFailed`) delivered through the existing SSE bridge. The frontend reacts to these events instead of blocking on the invoke result.

## Problem Frame

`acp_resume_session` is a blocking Tauri invoke taking 19–21s on cold Copilot resume (subprocess spawn + JSON-RPC init + history replay). The frontend wraps it in a `withTimeout(45s)` race — creating a dual-timeout architecture where the Rust backend and the frontend compete independently. When the frontend timeout fires first, Rust continues working and eventually succeeds, but the frontend has already declared failure. Events arrive to a "disconnected" frontend, get buffered or dropped, and the user sees a spurious error.

The invoke is doing too much synchronous work in a request-response pattern while the app already has an asynchronous event channel (SSE bridge) for session lifecycle events. (see origin: `docs/brainstorms/2026-04-12-async-session-resume-requirements.md`)

## Requirements Trace

- R1. Fire-and-forget resume command — validate inputs, return immediately
- R2. Async resume work in Rust — `tokio::spawn` with heavy work
- R3. Completion event via SSE bridge — `connectionComplete` / `connectionFailed`
- R4. Single authoritative timeout — one 45s encompassing Rust timeout, no frontend timeout
- R5. Frontend reacts to events — hot-state population moves to event handler
- R6. Buffered events flush on connectionComplete — replaces "invoke success" trigger

## Scope Boundaries

- `acp_resume_session` only — `acp_new_session` is a separate follow-up
- No progress events (spawning → initializing → replaying) — useful but separate scope
- No changes to the SSE bridge transport itself
- No changes to connection state machine states (disconnected → connecting → warmingUp → ready)
- No changes to `acp_fork_session` — structurally similar but separate scope

## Context & Research

### Relevant Code and Patterns

- `AcpUiEvent::session_update()` — existing factory for pushing `SessionUpdate` through the SSE bridge as `acp-session-update` events
- `AcpUiEventDispatcher` — Rust-side event publishing, batches events through `AcpEventHubState`
- `EventSubscriber` — frontend-side SSE consumer, dispatches to `SessionEventService.handleSessionUpdate()`
- `SessionEventService.flushPendingEvents()` — existing buffering + flush mechanism (buffer while disconnected, flush on connect)
- `SessionConnectionService` — drives the session state machine: `sendConnectionConnect`, `sendConnectionSuccess`, `sendCapabilitiesLoaded`, `sendConnectionError`
- `SessionHotStateStore.updateHotState()` — merges partial hot-state updates, auto-stamps `statusChangedAt`
- `client_ops.rs:resume_or_create_session_client()` — the 19-21s bottleneck: try existing client → if fail → create + init + resume

### Institutional Learnings

- `docs/solutions/` — no directly applicable prior solution for this pattern, but the event bridge architecture is well-tested and stable

## Key Technical Decisions

- **SSE bridge events over direct Tauri `app.emit()`**: The SSE bridge is already a persistent connection with guaranteed delivery (EventSource reconnect). Using `app.emit()` + `listen()` risks lost events if the listener isn't set up before the task completes. The SSE bridge avoids this race entirely — the `EventSubscriber` is always connected. Additionally, the existing `SessionEventService` already handles session-scoped event dispatch, buffering, and flush — reusing it means less new code.

- **New `SessionUpdate` variants over new event channel**: `connectionComplete` and `connectionFailed` are added as `SessionUpdate` variants rather than a new event name (e.g., `acp-session-lifecycle`). This reuses the existing `acp-session-update` → `EventSubscriber` → `SessionEventService.handleSessionUpdate()` pipeline with zero new plumbing. The variants carry the same session_id pattern as other updates.

- **Single encompassing `tokio::time::timeout(45s)` in the async task**: Wraps the entire resume operation (lock + resume/create + init + projection load + registration). The per-step timeouts (`SESSION_CLIENT_LOCK_TIMEOUT`, `SESSION_CLIENT_OPERATION_TIMEOUT`) remain as defense-in-depth inside `client_ops.rs` — they are shared by other commands (`interaction_commands.rs`, `inbound_commands.rs`) and should not be removed.

- **No frontend fallback timeout**: The Rust async task guarantees either `connectionComplete` or `connectionFailed` within 45s. If the Rust process crashes, the entire Tauri app crashes. However, as defense-in-depth against edge cases (SSE bridge reconnection gap, lagged subscriber), the frontend keeps a generous **safety-net watchdog timeout of 90s**. If neither `connectionComplete` nor `connectionFailed` arrives within 90s, the frontend transitions to error state. This is purely a watchdog — not a competing timeout — since it fires well after the Rust-side 45s timeout would have emitted a `connectionFailed` in any normal scenario.

- **Resume attempt correlation**: Each `connectSession` call generates a monotonically increasing attempt ID (per-session counter). This ID is passed to `acp_resume_session` and included in `connectionComplete` / `connectionFailed` payloads. The frontend ignores lifecycle events whose attempt ID does not match the current attempt, preventing stale tasks from flipping session state after a disconnect/retry.

- **`connectionComplete` payload carries `ResumeSessionResponse` fields inline**: Rather than nesting a `ResumeSessionResponse` struct (which Specta might expose differently), the variant inlines the fields: `models`, `modes`, `available_commands`, `config_options`. This keeps Specta serialization flat and matches the existing `SessionUpdate` pattern.

## Open Questions

### Resolved During Planning

- **Should `setModel` (stored model restoration) move to the async task?** Yes — it is part of the "make the session ready" work and should happen before `connectionComplete` is emitted. This removes a second `withTimeout` call from the frontend. The async task calls `setModel` on the client directly (no invoke needed — it has the client handle).

- **How does `setSessionAutonomous` work?** It currently calls `api.setSessionAutonomous(sessionId, enabled)` which is a Tauri invoke. In the async task, autonomous mode is restored via the backend `SessionPolicyRegistry` (not a session client method — the ACP client has no autonomous toggle). The resolved autonomous state is included in the `connectionComplete` payload so the frontend can set hot state accordingly without a separate invoke.

### Deferred to Implementation

- Exact error message format for `connectionFailed` — will match existing `SerializableAcpError` conventions
- Whether `resolve_resume_launch_mode_id` can be inlined into the Rust async task — depends on whether the function needs frontend-only state

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
BEFORE (blocking):
  Frontend                         Rust
  ┌──────────┐                    ┌─────────────┐
  │connectSes│─── invoke ────────►│acp_resume_  │
  │sion()    │    (blocks 20s)    │session()    │
  │          │◄── Result ────────│  heavy work  │
  │ populate │                    │  (19-21s)   │
  │ hot state│                    └─────────────┘
  │ flush    │
  └──────────┘

AFTER (fire-and-forget + event):
  Frontend                         Rust
  ┌──────────┐                    ┌─────────────┐
  │connectSes│─── invoke ────────►│acp_resume_  │
  │sion()    │◄── Ok(()) ────────│session()    │
  │ return   │    (instant)       │  validate   │
  └──────────┘                    │  spawn task─┼──► tokio::spawn {
                                  └─────────────┘      timeout(45s) {
                                                         resume_or_create
  ┌──────────┐    SSE event                              bind_provider_id
  │SessionEv │◄──connectionComplete──────────────────    load_projection
  │entService│                                           register_session
  │ populate │                                           restore_model
  │ hot state│                                         }
  │ flush    │                                         emit event
  └──────────┘                                       }
```

## Implementation Units

- [ ] **Unit 1: Rust — Add `SessionUpdate` connection lifecycle variants**

**Goal:** Define `ConnectionComplete` and `ConnectionFailed` variants on the `SessionUpdate` enum so they can travel through the existing SSE bridge.

**Requirements:** R3

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/session_update/types/session_update.rs`
- Modify: `packages/desktop/src-tauri/src/acp/ui_event_dispatcher.rs` (add `session_id()` match arms)

**Approach:**
- Add `ConnectionComplete` variant with inlined fields: `session_id`, `attempt_id` (`u64`), `models` (`SessionModelState`), `modes` (`SessionModes`), `available_commands` (`Vec<AvailableCommand>`), `config_options` (`Vec<ConfigOptionData>`), `autonomous_enabled` (`bool`)
- Add `ConnectionFailed` variant with `session_id`, `attempt_id` (`u64`), and `error` (String)
- Extend the `session_id()` match in `impl SessionUpdate` to cover both new variants
- Both variants should have `session_id` as non-optional `String` (not `Option<String>`) since we always know it — but serde still serializes it as `session_id` for frontend compatibility

**Patterns to follow:**
- Existing `TurnComplete` / `TurnError` variants for structure
- `PermissionRequest` for the high-priority pattern (connection lifecycle events should be high priority, non-droppable)

**Test scenarios:**
- Happy path: `ConnectionComplete` serializes to JSON with `type: "connectionComplete"` and all fields present
- Happy path: `ConnectionFailed` serializes with `type: "connectionFailed"`, session_id, and error string
- Edge case: `session_id()` returns correct value for both new variants

**Verification:**
- `cargo clippy` passes
- `cargo test` in session_update module passes
- Specta regeneration produces matching TypeScript types

---

- [ ] **Unit 2: Rust — Add encompassing resume timeout constant**

**Goal:** Define a single authoritative timeout constant for the entire resume operation.

**Requirements:** R4

**Dependencies:** None (parallel with Unit 1)

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/commands/mod.rs`

**Approach:**
- Add `const RESUME_SESSION_TIMEOUT: Duration = Duration::from_secs(45)` alongside existing constants
- Document that this is the single encompassing timeout for the entire resume flow and replaces the frontend `CONNECTION_TIMEOUT_MS`

**Patterns to follow:**
- Existing `SESSION_CLIENT_LOCK_TIMEOUT` / `SESSION_CLIENT_OPERATION_TIMEOUT` naming convention

**Test expectation:** none — pure constant definition

**Verification:**
- `cargo clippy` passes

---

- [ ] **Unit 3: Rust — Make `acp_resume_session` fire-and-forget with async task**

**Goal:** Split `acp_resume_session` into fast synchronous validation (returns immediately) and a `tokio::spawn` background task that does the heavy work and emits a lifecycle event on completion.

**Requirements:** R1, R2, R3, R4

**Dependencies:** Unit 1, Unit 2

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`

**Approach:**
- Keep the fast validation path synchronous: `resolve_resume_session_target`, `validate_session_cwd`, `resolve_resume_launch_mode_id`, agent registry lookups
- Change return type from `Result<ResumeSessionResponse, SerializableAcpError>` to `Result<(), SerializableAcpError>` — validation errors still return as invoke errors
- Accept a new `attempt_id: u64` parameter from the frontend for resume-attempt correlation
- After validation, clone the `AppHandle` and necessary state handles into a `tokio::spawn` closure
- Inside the task: wrap everything in `tokio::time::timeout(RESUME_SESSION_TIMEOUT, async { ... })`
- On success: emit `SessionUpdate::ConnectionComplete { ... }` via `AcpUiEvent::session_update()` → `AcpEventHubState.publish()`
- On timeout/error: emit `SessionUpdate::ConnectionFailed { session_id, error }` via the same path
- The event emission needs access to `AcpEventHubState` — obtain via `app.state::<AcpEventHubState>()`

**Patterns to follow:**
- Existing `acp_prompt_session` which is already fire-and-forget (returns `Ok(())` and streams results via events)
- Existing `AcpUiEvent::session_update()` factory for creating SSE-bridge events

**Test scenarios:**
- Happy path: invoke returns `Ok(())` immediately, then `ConnectionComplete` event is emitted with models/modes/commands/configOptions
- Error path (validation): invoke returns `Err(...)` immediately when session not found or CWD invalid — no async task spawned
- Error path (resume failure): async task catches `resume_or_create_session_client` error, emits `ConnectionFailed`
- Error path (timeout): 45s timeout fires, emits `ConnectionFailed` with timeout message
- Edge case: `bind_provider_session_id` and `load_stored_projection` run after successful resume, before `ConnectionComplete` emission

**Verification:**
- `cargo clippy` passes
- `cargo test` passes
- Manual test: cold Copilot session resume completes via event

---

- [ ] **Unit 4: TypeScript — Regenerate Specta bindings and add frontend types**

**Goal:** Update the generated TypeScript types to match the new Rust `SessionUpdate` variants and changed `acp_resume_session` return type.

**Requirements:** R3, R5

**Dependencies:** Unit 3

**Files:**
- Modify: `packages/desktop/src/lib/services/converted-session-types.ts` (auto-generated by Specta)
- Modify: `packages/desktop/src/lib/utils/tauri-client/acp.ts` (return type change)
- Modify: `packages/desktop/src/lib/acp/store/api.ts` (return type change)
- Modify: `packages/desktop/src/lib/acp/store/types.ts` (fix `ResumeSessionResult` alias)

**Approach:**
- Run Specta type generation to pick up `ConnectionComplete` and `ConnectionFailed` variants in the `SessionUpdate` discriminated union
- Update `resumeSession` in `acp.ts` to return `ResultAsync<void, AppError>` instead of `ResultAsync<ResumeSessionResult, AppError>`
- Update `resumeSession` in `api.ts` to match
- Fix or remove the `ResumeSessionResult` type alias (currently aliases `NewSessionResponse` — a mismatch). It may still be needed for `newSession` and `forkSession`; verify usage

**Patterns to follow:**
- Existing Specta regeneration workflow
- `api.sendPrompt` which already returns `ResultAsync<void, AppError>` for fire-and-forget invokes

**Test expectation:** none — type-level changes verified by `bun run check`

**Verification:**
- `bun run check` passes with no type errors
- All existing tests still compile

---

- [ ] **Unit 5: TypeScript — Handle `connectionComplete` / `connectionFailed` in SessionEventService**

**Goal:** Add event handlers for the new `SessionUpdate` variants that populate hot state, update the state machine, cache capabilities, flush buffered events, and restore autonomous mode — all the work currently done in `connectSession`'s success/error paths.

**Requirements:** R5, R6

**Dependencies:** Unit 4

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/session-event-service.svelte.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/session-event-service.test.ts` (create if not exists)

**Approach:**
- In `handleSessionUpdate()`, add `case "connectionComplete":` that:
  1. Extracts models/modes/commands/configOptions and autonomous state from the event payload
  2. Resolves provider metadata, models display, current model/mode (same logic as current `connectSession` lines 692–800)
  3. Caches models/modes in preferences store (lines 901–918)
  4. Updates capabilities manager (lines 921–927)
  5. Updates state machine: `sendConnectionSuccess` → `sendCapabilitiesLoaded` → `sendContentLoad` → `sendContentLoaded` (lines 932–939)
  6. Updates hot state to ready, including autonomousEnabled from payload (lines 941–953)
  7. Calls `flushPendingEvents()` (line 956)
  - Note: model restoration (`setModel`) and autonomous mode restoration are done in the Rust async task before `connectionComplete` is emitted. The frontend receives the already-resolved state and does NOT perform separate `setModel`/`setSessionAutonomous` invokes.
- **Buffering gate during `connecting`:** Ordinary `SessionUpdate` events (message chunks, tool calls, etc.) arriving while a session is in `connecting` state must be buffered — not processed immediately. Only `connectionComplete` and `connectionFailed` lifecycle events pass through. On `connectionComplete`, flush buffered events after hot state is initialized. This prevents processing replay events before hot state, capabilities, and readiness transitions exist.
- Add `case "connectionFailed":` that:
  1. Clears replay suppression
  2. Detects "Method not found" for read-only sessions
  3. Sends `sendConnectionError` on state machine
  4. Updates hot state with error (same logic as current lines 961–997)
- The cleanest approach: `SessionEventService.handleSessionUpdate` already dispatches to `SessionEventHandler` methods. Add `onConnectionComplete` and `onConnectionFailed` to the `SessionEventHandler` interface, and implement them in `SessionConnectionManager` where all the state-management code already lives

**Patterns to follow:**
- Existing `handleSessionUpdate` switch/case structure
- Existing `SessionEventHandler` interface for delegating domain logic

**Test scenarios:**
- Happy path: `connectionComplete` event with valid models/modes → hot state updated to ready, state machine transitions to ready, events flushed
- Happy path: `connectionComplete` with autonomousEnabled=true from payload → hot state reflects autonomous
- Error path: `connectionFailed` with generic error → hot state updated to error, state machine to error
- Error path: `connectionFailed` with "Method not found" → session marked read-only
- Edge case: `connectionComplete` for a session that was already disconnected by user → should no-op or handle gracefully
- Integration: buffered events are flushed after `connectionComplete` processes

**Verification:**
- `bun run check` passes
- `bun test` passes
- Manual test: session connects and hot state is populated correctly

---

- [ ] **Unit 6: TypeScript — Simplify `connectSession` to fire-and-forget**

**Goal:** Remove the `withTimeout` wrapper, the blocking invoke chain, and the hot-state population code from `connectSession`. It becomes: validate → transition to connecting → fire invoke → return.

**Requirements:** R1, R4, R5

**Dependencies:** Unit 5

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/services/session-connection-manager.ts`
- Test: `packages/desktop/src/lib/acp/store/services/__tests__/session-connection-manager.test.ts`

**Approach:**
- Remove `CONNECTION_TIMEOUT_MS` constant
- Remove `withTimeout` helper function
- Simplify `connectSession`:
  1. Keep the existing guards (already connected, bound ACP session, pending connection)
  2. Keep replay suppression setup
  3. Keep state machine transition to connecting and hot state update
  4. Generate a monotonically increasing `attemptId` (per-session counter) for this resume attempt
  5. Replace the massive `preferencesStore.ensureLoaded().andThen(...)` chain with:
     - Call `api.resumeSession(sessionId, resumeCwd, agentOverrideId, resumeLaunchModeId, attemptId)` — now returns `ResultAsync<void, AppError>`
     - On invoke error (validation failure): set error state, send `connectionError` on state machine, clear `pendingConnections`
     - On invoke success: return `okAsync(session)` — hot-state population will happen when `connectionComplete` event arrives
  6. `pendingConnections` entry persists until `connectionComplete`/`connectionFailed` event arrives (not on invoke ack). The event handler clears it.
  7. Add a 90s safety-net watchdog: if no lifecycle event arrives within 90s, transition to error. This is a pure watchdog, not a competing timeout.
  8. When `connectionComplete`/`connectionFailed` arrives, check `attemptId` matches current attempt; ignore stale events.
- Remove the autonomous mode restoration logic, stored model restoration, and capabilities caching — all moved to Unit 5
- Keep the `mapErr` for handling validation errors (session not found, CWD invalid)

**Patterns to follow:**
- Existing `sendPrompt` pattern which fires an invoke and returns immediately

**Test scenarios:**
- Happy path: `connectSession` returns immediately with `okAsync(session)` after invoke ack
- Happy path: state machine transitions to `connecting` before invoke
- Happy path: `attemptId` is generated and passed to invoke
- Error path (validation): invoke returns error → state machine to error, hot state to error, pendingConnections cleared
- Error path (session not found): returns `SessionNotFoundError` before invoke
- Error path (watchdog): 90s timeout fires → session transitions to error
- Edge case: already connected session returns immediately without invoking
- Edge case: pending connection deduplication — second `connectSession` while first is in-flight returns pending
- Edge case: stale `connectionComplete` with old `attemptId` is ignored
- Edge case: replay suppression is set up before invoke fires

**Verification:**
- `bun run check` passes
- All 41 session-connection-manager tests pass (many will need updating)
- Manual test: session connects end-to-end through the event-driven flow

---

- [ ] **Unit 7: Integration verification and cleanup**

**Goal:** Verify end-to-end flow, clean up dead code, ensure all callers work.

**Requirements:** R1–R6

**Dependencies:** Unit 6

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/services/session-connection-manager.ts` (cleanup)
- Verify: `packages/desktop/src/lib/services/initialization-manager.ts` (caller)
- Verify: `packages/desktop/src/lib/acp/store/services/session-handler.ts` (caller)
- Verify: `packages/desktop/src/lib/acp/store/services/session-preload-connect.ts` (caller)

**Approach:**
- Verify all three callers of `connectSession` still work with the new fire-and-forget semantics (they already ignore the return value)
- Remove any orphaned imports (e.g., `getProviderAwareSessionModelState` if only used in the moved code)
- Run full test suite
- Run `cargo clippy` and `bun run check`

**Patterns to follow:**
- Existing code review checklist

**Test scenarios:**
- Integration: initialization-manager calls `connectSession` → session eventually reaches ready state via events
- Integration: session-handler reconnect flow works end-to-end
- Integration: session-preload-connect preload → connect flow works

**Verification:**
- `bun run check` passes
- `bun test` passes
- `cargo clippy` passes
- `cargo test` passes
- Manual test: open app, sessions connect via event-driven flow

## System-Wide Impact

- **Interaction graph:** `acp_resume_session` invoke → fast ack. Async task → `AcpUiEvent::session_update()` → `AcpEventHubState.publish()` → SSE bridge → `EventSubscriber` → `SessionEventService.handleSessionUpdate()` → `SessionEventHandler.onConnectionComplete/onConnectionFailed()` (new) → hot-state population, state machine transitions, event flush
- **Error propagation:** Validation errors propagate synchronously via invoke error. Runtime errors (resume failure, timeout) propagate asynchronously via `connectionFailed` event. No error is silently swallowed.
- **State lifecycle risks:** If the async task panics (unlikely but possible), no event is emitted. Mitigated by: (a) `catch_unwind` in the async task emits `connectionFailed` on panic, (b) 90s frontend watchdog transitions to error if no lifecycle event arrives. The watchdog is defense-in-depth, not a competing timeout.
- **API surface parity:** `acp_new_session` and `acp_fork_session` have the same blocking pattern but are out of scope. After this refactor, they should be refactored similarly in a follow-up.
- **Integration coverage:** The key integration to verify is: invoke ack → async task → SSE event → frontend handler → hot state ready → buffered events flushed. Unit tests alone will not prove this — manual testing required.
- **Unchanged invariants:** The connection state machine states and transitions remain identical. The hot-state shape remains identical. The event buffering and flush mechanism remains identical. The SSE bridge transport remains identical. Only the _trigger point_ for hot-state population and event flush changes (from invoke success callback to event handler).

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Async task panics → session stuck in `connecting` | Wrap in `std::panic::AssertUnwindSafe` + `catch_unwind` equivalent for async; emit `connectionFailed` in panic path. Frontend 90s watchdog as final safety net. |
| SSE bridge reconnection gap loses lifecycle event | 90s frontend watchdog timeout transitions to error; user can retry. Not a competing timeout — fires well after Rust's 45s. |
| Stale resume task completes after disconnect/retry | `attempt_id` correlation: frontend ignores events with non-matching attempt ID |
| `setModel` restore in Rust async task needs different API than frontend invoke | The async task has direct access to the session client — call `client.set_model()` directly instead of going through the Tauri invoke |
| `setSessionAutonomous` in Rust requires different plumbing | Restore via `SessionPolicyRegistry` (not session client); include resolved state in `connectionComplete` payload |
| Specta regeneration changes more types than expected | Run regeneration early (Unit 4), review diff before proceeding |
| `pendingConnections` deduplication breaks with instant return | Entry persists until lifecycle event arrives (not on invoke ack); event handler clears it |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-12-async-session-resume-requirements.md](docs/brainstorms/2026-04-12-async-session-resume-requirements.md)
- Related code: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs:acp_resume_session`
- Related code: `packages/desktop/src/lib/acp/store/services/session-connection-manager.ts:connectSession`
- Related code: `packages/desktop/src-tauri/src/acp/ui_event_dispatcher.rs:AcpUiEvent`
- Related code: `packages/desktop/src/lib/acp/store/session-event-service.svelte.ts:handleSessionUpdate`
- Related commit: `6b355934b` — raised `CONNECTION_TIMEOUT_MS` from 15s to 45s (quick fix being replaced by this refactor)
