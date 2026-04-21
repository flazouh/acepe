---
title: Revisioned session graph is the only product-state authority
date: 2026-04-20
category: architectural
module: desktop ACP session state
problem_type: architecture
component: assistant
severity: high
tags:
  - session-state
  - canonical-authority
  - transcript
  - operations
  - telemetry
  - runtime
  - refresh
  - reopen
---

# Revisioned session graph is the only product-state authority

## Intent

Acepe's ACP session model must have exactly one durable authority: the **revisioned session graph** delivered through `SessionStateEnvelope`.

Raw `acp-session-update` frames still exist, but only as transport-time coordination and observability. They must not own durable transcript, runtime, tool, or telemetry state.

## Authority boundary

| Surface | Authoritative source | Non-authoritative role |
|-------|------------------------|------------------------|
| Transcript history | `SessionStatePayload::Snapshot` and `SessionStatePayload::Delta` | raw chunk events may drive optimistic UX only |
| Turn lifecycle | canonical graph lifecycle + revisions | raw `turnComplete` / `turnError` are observational |
| Runtime / Cursor state | canonical runtime stored in projection snapshots and reopen refresh state | live registry is a cache, not the only source |
| Current / last tool UI | canonical `OperationStore` materialized from graph operations | transcript tool rows are presentation only |
| Usage telemetry | `SessionStatePayload::Telemetry` | raw telemetry updates are observational only |
| Commands / modes / config / capabilities | canonical graph and capability envelopes | raw update lanes are observational only |
| Permissions / questions / interactions | canonical interaction graph | raw prompts are transport hints only |

## Envelope contract

The backend emits one revisioned stream:

1. `snapshot` seeds the full session graph.
2. `delta` advances the graph frontier from an accepted `from_revision` to `to_revision`.
3. `lifecycle` updates runtime lifecycle without inventing a second authority path.
4. `capabilities` updates commands, modes, config, and model availability.
5. `telemetry` updates usage accounting and context-budget state.

Frontend consumers must apply envelopes in revision order and buffer them until the target session is registered locally. Unknown-session envelopes are not allowed to fire side effects early.

## Backend responsibilities

### Runtime registry

- Preserve the real accepted delta frontier when emitting live envelopes.
- Emit canonical telemetry envelopes instead of making telemetry a raw-only side channel.
- Treat the live runtime registry as a materialized cache over canonical state, not a hidden second database.

### Projection snapshots and reopen / refresh

- Persist runtime with transcript, operations, and interactions in `SessionProjectionSnapshot`.
- On reopen, restore runtime into the registry from the stored projection snapshot.
- On refresh / cold open, use stored runtime when no live runtime entry exists.

This is why Cursor/runtime state survives refresh and reopen even when the live process registry has been dropped.

## Frontend responsibilities

### Session event service

- Raw `SessionUpdate` frames may coordinate optimistic UI and connection waiters.
- Canonical envelopes own durable state application.
- Both raw updates and canonical envelopes must respect the same pending-session buffer so cold sessions do not receive partial side effects before registration.

### Session store

- `applySessionStateGraph(...)` owns transcript, operations, interactions, runtime reconciliation, and turn-finalization side effects.
- `applySessionStateEnvelope(...)` is the only path allowed to accumulate canonical telemetry.
- When transcript frontiers mismatch, refresh from a canonical snapshot instead of repairing from raw data.

### Transcript entries vs operations

Transcript tool rows are useful for transcript rendering, but they are not rich enough to be the live tool authority.

Why:

- transcript replacements can legally carry degraded tool rows (`kind: "other"`, minimal text segments),
- current/last tool badges need stable typed arguments and status,
- queue/tab/session preview surfaces must agree on the same tool identity.

So the split is:

- **`SessionEntryStore`**: render transcript history.
- **`OperationStore`**: drive current streaming tool, last tool, and typed tool UI.

Transcript snapshot replacement must never wipe canonical operation state.

## What this architecture removes

The migration is complete only when these legacy authority paths are gone:

1. raw `userMessageChunk` mutating durable transcript history,
2. raw turn-complete / turn-error lanes finalizing the session independently of canonical lifecycle,
3. raw telemetry ownership,
4. transcript-tool-entry fallback as the source of current / last tool UI,
5. refresh / reopen depending on a live runtime registry entry to reconstruct Cursor/runtime state.

If any of those paths still own state, Acepe regresses into split-brain behavior such as duplicated user messages, missing Cursor state after reopen, or inconsistent tool badges.

## Regression coverage

- `packages/desktop/src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts`
- `packages/desktop/src/lib/acp/store/__tests__/session-entry-store-streaming.vitest.ts`
- `packages/desktop/src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts`
- `packages/desktop/src/lib/acp/store/__tests__/operation-store.vitest.ts`
- `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs`
- `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`

## Related

- `docs/solutions/best-practices/deterministic-tool-call-reconciler-2026-04-18.md`
- `docs/solutions/best-practices/telemetry-integration-tauri-svelte-privacy-first-2026-04-14.md`
