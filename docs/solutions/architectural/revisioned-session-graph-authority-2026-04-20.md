---
title: Revisioned session graph is the only product-state authority
date: 2026-04-20
last_updated: 2026-04-24
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
| Runtime / Cursor state | canonical envelopes and live runtime after attach | provider-owned history restores content; Acepe does not persist a second cold-open runtime checkpoint |
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

### Reopen / refresh

- On cold reopen, rebuild content from provider-owned history.
- Do not persist a separate Acepe-owned runtime checkpoint for reopen.
- Let reconnect/live envelopes repopulate runtime lifecycle and capability state after attach.

### Cold-open restore delivery

The 2026-04-23 provider-authority refactor made this boundary concrete instead
of aspirational:

1. `history/commands/session_loading.rs` now returns provider-translated content
   directly from `load_provider_owned_session_snapshot(...)` and no longer
   materializes transcript/projection/thread copies into Acepe-managed durable
   storage.
2. `acp/session_journal.rs` no longer treats `session_journal_event` as a
   replayable transcript/tool payload store. The durable journal is narrowed to
   Acepe-owned metadata, interaction, and lifecycle markers.
3. `acp/commands/session_commands.rs` no longer restores runtime state from a
   local checkpoint on reopen or close. Cold reopen gets content from provider
   history; live reconnect repopulates runtime lifecycle and capabilities after
   attach.
4. The snapshot-table cleanup migration drops
   `session_projection_snapshot`, `session_transcript_snapshot`, and
   `session_thread_snapshot` outright instead of preserving compatibility stubs.

The operational rule is:

- provider-owned files/logs/JSONL own cold-open content,
- provider live transport owns attached-session freshness,
- Acepe local durability owns only metadata it genuinely owns.

If any new reopen path tries to add a second local content or runtime checkpoint
for safety, it is reintroducing the split-brain this refactor removed.

### Failure semantics

Honest failure is part of the authority model.

- Missing provider history returns an explicit `missing` open result instead of
  a stale local fallback.
- Unparseable provider history returns a non-retryable `parseFailure`.
- Generic provider-load failures remain retryable `internal` errors and must
  not be mislabeled as parse failures.

That distinction matters because "try again later" is a real product path for
flush gaps or transient provider failures, while malformed provider history is
not.

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
5. cold reopen depending on Acepe-local checkpoint persistence to reconstruct Cursor/runtime state.

If any of those paths still own state, Acepe regresses into split-brain behavior such as duplicated user messages, missing Cursor state after reopen, or inconsistent tool badges.

## Regression coverage

- `packages/desktop/src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts`
- `packages/desktop/src/lib/acp/store/__tests__/session-entry-store-streaming.vitest.ts`
- `packages/desktop/src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts`
- `packages/desktop/src/lib/acp/store/__tests__/operation-store.vitest.ts`
- `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs`
- `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
- `packages/desktop/src-tauri/src/history/commands/session_loading.rs`
- `packages/desktop/src/lib/components/main-app-view/tests/open-persisted-session.test.ts`

## Related

- `docs/solutions/best-practices/deterministic-tool-call-reconciler-2026-04-18.md`
- `docs/solutions/best-practices/telemetry-integration-tauri-svelte-privacy-first-2026-04-14.md`
- `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md`
- `docs/plans/2026-04-23-002-refactor-provider-owned-restore-authority-plan.md`
