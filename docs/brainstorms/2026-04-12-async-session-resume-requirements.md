# Async Session Resume Architecture

**Date:** 2026-04-12
**Status:** Draft
**Scope:** `acp_resume_session` only (not `acp_new_session`)

## Problem

`acp_resume_session` is a blocking Tauri invoke that takes 19-21s on cold Copilot resume (subprocess spawn + JSON-RPC init + history replay). The frontend wraps it in a `withTimeout` race, creating a dual-timeout architecture where the frontend and Rust backend compete independently. When the frontend timeout fires first, the Rust side continues working — eventually succeeding — but the frontend has already declared failure. Events arrive to a "disconnected" frontend, get buffered/dropped, and the user sees a spurious error.

The deeper issue: the invoke is doing too much synchronous work in a request-response pattern while the app already has an asynchronous event channel (SSE bridge) for session lifecycle events.

## Requirements

### R1: Fire-and-forget resume command

`acp_resume_session` validates inputs (session exists, CWD valid, agent resolved) and returns immediately with an acknowledgment. No subprocess spawn, no initialization, no history replay in the invoke path.

### R2: Async resume work in Rust

After returning the ack, Rust spawns a `tokio::spawn` task to perform the heavy work: `resume_or_create_session_client` (existing client reuse or create + initialize + resume). This task owns the single authoritative timeout.

### R3: Completion event via SSE bridge

On success, the async task emits a new `acp-session-update` event with type `connectionComplete` carrying the `ResumeSessionResponse` payload (models, modes, availableCommands, configOptions). On failure, it emits `connectionFailed` with error details. Both travel through the existing `AcpUiEventDispatcher` → `AcpEventHub` → SSE bridge path.

### R4: Single authoritative timeout

The Rust async task wraps the entire resume operation in one encompassing `tokio::time::timeout(45s)`. On timeout, it emits `connectionFailed`. The frontend `withTimeout` wrapper and `CONNECTION_TIMEOUT_MS` constant are removed entirely.

### R5: Frontend reacts to events

`connectSession` no longer blocks on an invoke result. It:
1. Transitions state machine to `connecting`
2. Fires the invoke (which returns immediately)
3. Returns `okAsync` on successful invoke ack

The hot-state population (models, modes, commands, configOptions, capabilities, autonomous state) moves into the `SessionEventService` handler for the new `connectionComplete` event type. On `connectionFailed`, it sets error state.

### R6: Buffered events flush on connectionComplete

The existing event buffering ("buffer while disconnected, flush on connect") continues to work. `connectionComplete` triggers the flush — replacing the current "invoke returned successfully" trigger.

## Non-goals

- Refactoring `acp_new_session` (same pattern, separate follow-up)
- Progress events (spawning → initializing → replaying) — useful but separate scope
- Changing the SSE bridge transport itself
- Changing the connection state machine states (disconnected → connecting → warmingUp → ready stays the same)

## Constraints

- `ResumeSessionResponse` carries no `sessionId` — only models/modes/commands/configOptions. The `sessionId` is already known by the caller.
- Callers of `connectSession` (initialization-manager, session-handler, session-preload-connect) all fire-and-forget the result — they don't use the returned `SessionCold`.
- The type alias `ResumeSessionResult = NewSessionResponse` in `store/types.ts` is a pre-existing mismatch that should be corrected as part of this work.
- Must not break the existing replay suppression / duplicate detection logic.

## Success Criteria

1. Cold Copilot session resume completes without spurious timeout errors
2. No dual-timeout architecture — single Rust-owned timeout
3. Frontend never blocks >1s waiting for resume invoke to return
4. Session events arriving during resume are properly buffered and flushed
5. Existing test suite passes (41 session-connection-manager tests, initialization-manager tests)

## Key Files

| Area | File |
|------|------|
| Rust command | `packages/desktop/src-tauri/src/acp/commands/session_commands.rs` |
| Rust client ops | `packages/desktop/src-tauri/src/acp/commands/client_ops.rs` |
| Rust event dispatch | `packages/desktop/src-tauri/src/acp/ui_event_dispatcher.rs` |
| Rust event hub | `packages/desktop/src-tauri/src/acp/event_hub.rs` |
| Rust timeout constants | `packages/desktop/src-tauri/src/acp/commands/mod.rs` |
| TS connection manager | `packages/desktop/src/lib/acp/store/services/session-connection-manager.ts` |
| TS event service | `packages/desktop/src/lib/acp/store/session-event-service.svelte.ts` |
| TS event subscriber | `packages/desktop/src/lib/acp/logic/event-subscriber.ts` |
| TS session types | `packages/desktop/src/lib/services/converted-session-types.ts` |
| TS store types | `packages/desktop/src/lib/acp/store/types.ts` |
| TS Tauri bindings | `packages/desktop/src/lib/utils/tauri-client/acp.ts` |
| State machine | `packages/desktop/src/lib/acp/logic/session-machine.ts` |
| Connection service | `packages/desktop/src/lib/acp/store/session-connection-service.svelte.ts` |
