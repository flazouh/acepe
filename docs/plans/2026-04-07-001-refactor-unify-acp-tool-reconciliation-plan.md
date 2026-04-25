---
title: "refactor: unify ACP tool reconciliation into one backend canonical layer"
type: refactor
status: completed
date: 2026-04-07
---

# refactor: unify ACP tool reconciliation into one backend canonical layer

## Overview

The recent Claude and Cursor fixes moved the worst provider-specific tool behavior to the adapter boundary and moved frontend progressive arguments onto canonical `ToolCall` entries. The remaining architecture gap is that reconciliation is still split across multiple layers:

- provider bridges normalize some tool semantics
- `TaskReconciler` assembles parent/child task structure and duplicate tool events
- `StreamingDeltaBatcher` batches raw streaming deltas
- `SessionEventService` still coalesces and routes streaming tool updates specially before they reach the store

This plan consolidates tool reconciliation into a single backend-owned canonical layer so the frontend becomes a pure consumer of stable tool state.

## Phase Success Criteria

This phase is successful when all of the following are true:

- `packages/desktop/src/lib/acp/store/session-event-service.svelte.ts` no longer contains tool-protocol-specific branching or tool streaming queues
- The backend ACP pipeline is the sole owner of tool lifecycle/progressive-argument merge semantics before UI dispatch
- The durable Rust→frontend contract for tool reconciliation is explicit and implemented consistently across backend and frontend layers
- Provider-specific tool quirks continue to terminate at adapters/parsers rather than leaking into store/event-service logic
- Regression coverage remains intact for Claude, Cursor, OpenCode, Copilot, and Codex tool flows at the levels defined in this plan

## Problem Frame

The target architecture requires one reconciler to own streaming identity, progressive-argument/lifecycle merging after adapter parsing has normalized provider input, and parent/child tool structure. Today that responsibility is still split:

1. Backend adapters emit canonical tool events, but some tool lifecycle merging still happens later
2. `TaskReconciler` knows about duplicate tool calls and task-child relationships, but not the full streaming/coalescing contract
3. `SessionEventService` still has a tool-specific fast path for `streamingArguments` and lifecycle forwarding
4. The frontend therefore remains partly responsible for tool event semantics instead of only projecting canonical state

That split keeps the architecture short of the intended “single canonical live stream” model and makes future providers more expensive to add.

## Requirements Trace

- R1. One backend-owned reconciliation layer must own canonical tool lifecycle merging before updates reach the frontend
- R2. Parent/child task assembly and duplicate tool call collapse must remain backend responsibilities
- R3. Progressive tool arguments must continue to stream live without requiring frontend coalescing logic
- R4. Frontend tool update handling must become provider-agnostic and stop reconstructing tool protocol semantics
- R5. Existing behavior for Claude, Cursor, OpenCode, Copilot, and Codex tool flows must remain intact

## Scope Boundaries

- NOT redesigning the entire session event model into a brand new `ToolStarted` / `ToolCompleted` event taxonomy in this phase
- NOT changing assistant text/thought batching in the frontend or Rust unless required by the tool reconciliation refactor
- NOT redesigning non-tool session updates like usage telemetry, question requests, or permission requests
- NOT rewriting provider adapters that already terminate quirks correctly at the parser/bridge boundary

## Planning Input

No relevant requirements document was found in `docs/brainstorms/` for this architecture continuation. This plan uses the direct user request and the already-completed architecture slices as the source of truth.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src-tauri/src/acp/task_reconciler.rs` — current backend reconciler for duplicate tool events and parent/child task assembly
- `packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs` — Rust-side batching for `streaming_input_delta`, `streaming_arguments`, todos, and questions
- `packages/desktop/src-tauri/src/acp/client_updates/reconciler.rs` — route that feeds tool calls and updates through `TaskReconciler`
- `packages/desktop/src-tauri/src/acp/client_updates/mod.rs` — central ACP update handling before dispatch
- `packages/desktop/src/lib/acp/store/session-event-service.svelte.ts` — current frontend fast path for tool streaming updates and lifecycle forwarding
- `packages/desktop/src/lib/acp/store/services/tool-call-manager.svelte.ts` — canonical frontend tool entry store; now owns `progressiveArguments`
- `packages/desktop/src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts` — current frontend streaming semantics contract
- `packages/desktop/src/lib/acp/store/__tests__/tool-call-event-flow.test.ts` — end-to-end store behavior and prior race-condition regressions
- `packages/desktop/src-tauri/src/acp/parsers/cc_sdk_bridge.rs` — example of provider-edge ownership for Claude-specific lifecycle/input semantics

### Architectural Observations

- The backend already has the right primitives (`TaskReconciler` and `StreamingDeltaBatcher`) to become the backend reconciliation pipeline
- The frontend still treats tool streaming as special in `SessionEventService`, which is the main remaining architectural leak
- `ToolCall` entries now own `progressiveArguments`, so the store can already represent canonical live tool state once upstream dispatch becomes simpler
- Current Rust tests prove provider-edge ownership for Claude and canonical raw input across providers; the next gap is reconciliation ownership, not parser ownership

## Key Technical Decisions

- **Promote the backend reconciler instead of inventing a new parallel subsystem**: extend the existing Rust reconciliation path into one explicit backend tool pipeline with clear responsibilities
- **Canonical ownership split inside the backend pipeline is explicit**:
  - the reconciler (`TaskReconciler`, renamed during implementation if warranted) owns semantic tool state: duplicate-ID policy, parent/child assembly, progressive-argument merge semantics, lifecycle merge semantics, and terminal cleanup rules
  - `StreamingDeltaBatcher` remains transport-only: it coalesces already-reconciled streaming updates and preserves flush/order boundaries, but does not invent semantic merge behavior
- **Choose a durable backend→frontend contract up front**:
  - first sighting of a top-level tool emits `ToolCall`
  - subsequent changes emit canonical `ToolCallUpdate`
  - every child mutation (topology, status, result, or progressive-argument change) re-emits the assembled parent `ToolCall` so the frontend can delete `updateChildInParent`-style semantic merge behavior entirely
  - terminal success and non-success updates (`completed`, `failed`, interrupted/cancelled equivalents surfaced by providers) must flush pending streaming state before final emission
  - parent `ToolCall` re-emissions caused by child mutation must also flush relevant pending deltas before emission so parent snapshots never overtake newer progressive child state
- **Define duplicate-ID policy explicitly**:
  - same-ID events before terminal state are treated as enrichment for one invocation
  - terminal emission must not occur until all allowed enrichment for that invocation is merged
  - same-ID traffic after terminal emission is invalid late traffic and should be ignored/logged rather than silently treated as a new invocation
- **Keep frontend store semantics, remove frontend reconciliation semantics**: the `ToolCallManager` remains the canonical entry store, but `SessionEventService` should stop doing tool-specific coalescing and split-path routing
- **Preserve event ordering guarantees through Rust batching**: the current `StreamingDeltaBatcher` already knows how to flush pending deltas before lifecycle boundaries; prefer extending that pattern rather than recreating it in TypeScript

## Provider Validation Strategy

- **Tier 1 architecture blockers:** Claude, Cursor, and OpenCode. These are the provider flows most directly exercised by the recent architecture work and must remain explicitly green before the phase is complete.
- **Tier 2 shared-pipeline regressions:** Copilot and Codex. They must retain parity through focused regression scenarios covering the shared reconciler path, but this phase does not require new provider-specific architecture work for them.
- **Sign-off rule:** the phase is not complete if Tier 1 behavior regresses or if Tier 2 regression checks fail against the unified reconciler contract.

## Provider Verification Matrix

- **Claude (Tier 1):**
  - `packages/desktop/src-tauri/src/acp/parsers/cc_sdk_bridge.rs` tests covering streamed edit/tool lifecycle behavior
  - `packages/desktop/src/lib/acp/store/__tests__/tool-call-event-flow.test.ts`
- **Cursor (Tier 1):**
  - `packages/desktop/src-tauri/src/acp/providers/cursor_session_update_enrichment.rs` tests
  - `packages/desktop/src-tauri/src/acp/client_updates/mod.rs` tests covering live Cursor enrichment before dispatch
  - `packages/desktop/src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts`
- **OpenCode (Tier 1):**
  - `packages/desktop/src-tauri/src/acp/opencode/sse/task_hydrator.rs` and related reconciler/batcher coverage exercised by `TaskReconciler`/client update tests
- **Copilot (Tier 2):**
  - focused Rust reconciler/client update tests covering Copilot sequences through the shared ACP update path
- **Codex (Tier 2):**
  - `packages/desktop/src/lib/acp/store/__tests__/tool-call-event-flow.test.ts` Codex replay regressions
  - focused Rust/shared reconciler tests when shared backend ownership changes touch Codex flows

## Open Questions

### Resolved During Planning

- **Where should the single reconciler live?** In the Rust ACP pipeline, extending the existing `TaskReconciler`/batching path rather than introducing another frontend or provider-specific reconciler
- **Should the frontend still keep progressive tool state?** Yes, but only as canonical entry state (`ToolCall.progressiveArguments`), not as an event-processing cache
- **Does this phase require a full event taxonomy rewrite?** No. This phase can reach the intended architectural ownership without replacing `ToolCall` / `ToolCallUpdate`

### Deferred to Implementation

- **Whether to rename `TaskReconciler` to reflect broader ownership**: this is desirable if the resulting role clearly exceeds “task” reconciliation, but the rename should be driven by code clarity and diff cost during implementation
- **Whether the reconciler rename should happen in this phase or immediately after**: if the name actively obscures ownership after Unit 1, rename in-phase; otherwise defer to a follow-up naming cleanup

## Implementation Units

- [x] **Unit 1: Establish the canonical backend tool contract in the reconciler**

  **Goal:** Make the Rust reconciler the semantic owner of canonical tool state: duplicate-ID policy, parent/child assembly, progressive-argument merge rules, lifecycle merge rules, and final emitted contract shape.

  **Requirements:** R1, R2, R3, R5

  **Execution note:** test-first

  **Dependencies:** None

  **Files:**
  - Modify: `packages/desktop/src-tauri/src/acp/task_reconciler.rs`
  - Modify: `packages/desktop/src-tauri/src/acp/client_updates/reconciler.rs`
  - Modify: `packages/desktop/src-tauri/src/acp/client_updates/mod.rs`
  - Test: `packages/desktop/src-tauri/src/acp/task_reconciler.rs`
  - Test: `packages/desktop/src-tauri/src/acp/client_updates/reconciler.rs`

  **Approach:**
  - Extend the current reconciler state to absorb the streaming/lifecycle combination rules that are still implicitly duplicated later in the pipeline
  - Reconcile `ToolCallUpdate` progressive arguments and terminal transitions into the explicit contract chosen above
  - Preserve current parent/child assembly and duplicate same-ID tool-call normalization using the explicit duplicate-ID policy from this plan
  - Re-emit assembled parent `ToolCall` values on every child mutation so the frontend never reconstructs nested child semantics
  - Keep non-semantic batching concerns out of the reconciler so Unit 2 has a clean transport-only role

  **Patterns to follow:**
  - `packages/desktop/src-tauri/src/acp/task_reconciler.rs` — current duplicate tool collapse and task assembly patterns
  - `packages/desktop/src-tauri/src/acp/parsers/cc_sdk_bridge.rs` — provider quirks terminate before reconciliation

  **Test scenarios:**
  - Duplicate same-ID tool calls with richer second payload collapse into canonical update output without frontend-specific assumptions
  - Streaming argument updates followed by terminal completion produce one coherent final backend sequence
  - Streaming argument updates followed by terminal failure produce one coherent final backend sequence
  - Streaming argument updates followed by interruption/cancellation-equivalent provider signals flush and close state correctly
  - Child status/result/progressive-argument updates re-emit an assembled parent `ToolCall` with no frontend child-merge semantics required
  - Terminal tool completion cleans up reconciler state without regressing duplicate follow-up handling
  - Late same-ID updates after terminal emission are ignored/logged rather than silently treated as new invocations
  - Claude live edit, Cursor enriched updates, and OpenCode task-child flows continue to normalize correctly
  - Copilot tool update sequences continue to reconcile without frontend-specific tool semantics
  - Codex tool-call/update sequences with final argument enrichment continue to reconcile without frontend-specific tool semantics

  **Verification:**
  - Focused Rust reconciler tests pass for duplicate, child, and streaming update flows
  - Existing backend behavior tests for Claude/Cursor/OpenCode tool paths remain green

- [x] **Unit 2: Move transport-level tool coalescing fully into Rust batching**

  **Goal:** Make Rust batching the sole transport-level coalescing layer for already-reconciled tool updates, with ordering and flush semantics preserved.

  **Requirements:** R1, R3, R5

  **Execution note:** test-first

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs`
  - Modify: `packages/desktop/src-tauri/src/acp/client_loop.rs`
  - Modify: `packages/desktop/src-tauri/src/acp/client_updates/mod.rs`
  - Test: `packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs`
  - Test: `packages/desktop/src-tauri/src/acp/client_updates/mod.rs`

  **Approach:**
  - Ensure the Rust batcher flushes and emits the canonical tool updates produced by Unit 1 without adding new semantic merge rules
  - Preserve the existing guarantees around flushing buffered streaming deltas before non-delta lifecycle boundaries
  - Remove any need for frontend re-coalescing of `streamingArguments`
  - Flush pending relevant tool buffers before parent `ToolCall` re-emissions so child-derived snapshots cannot overtake newer deltas
  - Keep assistant text/thought batching behavior unchanged unless a tool-ordering fix requires a targeted adjustment

  **Patterns to follow:**
  - `packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs` — existing delta buffering and boundary flush logic
  - `packages/desktop/src-tauri/src/acp/non_streaming_batcher.rs` — separation of concerns between streaming and non-streaming updates

  **Test scenarios:**
  - Multiple tool streaming deltas for the same tool coalesce in Rust and still surface the latest progressive arguments
  - A terminal tool update flushes buffered streaming state before completion output
  - A terminal failure or interruption update flushes buffered streaming state before final output
  - A parent re-emission caused by child mutation flushes relevant pending deltas before the parent snapshot is emitted
  - Interleaved tool streams for multiple tool IDs preserve per-tool ordering and isolation
  - Tool boundaries do not overtake buffered assistant text/thought chunks
  - Session-level turn-complete, turn-error, and cancellation paths flush session-scoped tool buffers before final turn events

  **Verification:**
  - Focused Rust batching tests pass

- [x] **Unit 3: Remove tool-specific reconciliation logic from the frontend event service**

  **Goal:** Simplify `SessionEventService` and related store interfaces so the frontend applies canonical tool updates uniformly instead of reconstructing streaming semantics.

  **Requirements:** R3, R4, R5

  **Execution note:** characterization-first

  **Dependencies:** Unit 2

  **Files:**
  - Modify: `packages/desktop/src/lib/acp/store/session-event-service.svelte.ts`
  - Modify: `packages/desktop/src/lib/acp/store/session-event-handler.ts`
  - Modify: `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
  - Modify: `packages/desktop/src/lib/acp/store/services/interfaces/tool-call-manager-interface.ts`
  - Modify: `packages/desktop/src/lib/acp/store/services/session-messaging-service.ts`
  - Modify: `packages/desktop/src/lib/acp/store/services/tool-call-manager.svelte.ts`
  - Modify as needed: `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts`
  - Test: `packages/desktop/src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts`
  - Test: `packages/desktop/src/lib/acp/store/__tests__/tool-call-event-flow.test.ts`
  - Test: `packages/desktop/src/lib/acp/store/__tests__/session-entry-store-streaming.vitest.ts`
  - Test: `packages/desktop/src/lib/acp/store/services/__tests__/session-messaging-service-stream-lifecycle.test.ts`
  - Test: `packages/desktop/src/lib/acp/store/services/__tests__/tool-call-manager.test.ts`

  **Approach:**
  - Remove the special `toolCallUpdate` streaming fast path from `SessionEventService`
  - Remove remaining frontend merge logic that would still decide how streaming, child, or lifecycle semantics combine; keep only passive projection/state-application helpers
  - Delete `updateChildInParent`-style semantic ownership from the frontend once Unit 1 re-emits assembled parent state on every child mutation
  - Keep the frontend’s responsibility to applying updates into canonical `ToolCall` entry state, not deciding how streaming and lifecycle data combine
  - Preserve the public store projection API as needed (`getStreamingArguments()` may remain as a projection over canonical tool state)
  - Update interfaces and tests to reflect the narrower frontend responsibility

  **Patterns to follow:**
  - Current `ToolCallManager` progressive-arguments ownership in `packages/desktop/src/lib/acp/store/services/tool-call-manager.svelte.ts`
  - Existing event-flow regression tests in `packages/desktop/src/lib/acp/store/__tests__/tool-call-event-flow.test.ts`

  **Test scenarios:**
  - Frontend event service no longer coalesces tool streaming updates itself
  - Live tool updates still render progressive read/edit/execute state correctly through the store
  - Known blank-card and rapid completion regressions remain covered
  - Child tool topology continues to render correctly without frontend reconstruction rules
  - Non-tool streaming behavior (assistant text/thought) remains unaffected

  **Verification:**
  - Focused TypeScript/Vitest store tests pass
  - Tool update flows observed by frontend tests no longer depend on TypeScript-side coalescing behavior
  - `bun run check` passes

- [x] **Unit 4: Final architecture validation**

  **Goal:** Prove the reconciler migration preserves existing provider behavior while reducing architectural split.

  **Requirements:** R1, R2, R3, R4, R5

  **Execution note:** test-first

  **Dependencies:** Unit 3

  **Files:**
  - Modify: targeted tests only
  - Test: `packages/desktop/src-tauri/src/acp/task_reconciler.rs`
  - Test: `packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs`
  - Test: `packages/desktop/src-tauri/src/acp/client_updates/mod.rs`
  - Test: `packages/desktop/src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts`
  - Test: `packages/desktop/src/lib/acp/store/__tests__/tool-call-event-flow.test.ts`

  **Approach:**
  - Re-run the focused backend and frontend regression suites that cover recent architecture slices
  - Add one architecture-level regression proving the frontend no longer needs tool-specific streaming reconciliation to preserve live tool behavior
  - Confirm the new code path preserves the “provider quirks die at the adapter boundary” rule
  - Treat this unit as verification-only; any required production changes discovered here must be moved back into Units 1-3 rather than absorbed silently

  **Test scenarios:**
  - Claude streamed edit input still becomes live progressive edit state
  - Cursor persisted enrichment still backfills canonical raw input without extra frontend logic
  - Duplicate tool-call collapse still works for sparse/enriched sequences
  - Copilot tool flows still preserve canonical behavior after frontend tool fast-path removal
  - Codex tool flows still preserve canonical behavior after frontend tool fast-path removal
  - Frontend receives canonical tool updates without a TypeScript tool streaming fast path

  **Verification:**
  - Focused Rust test commands pass for reconciler/batcher/client update modules
  - `bun run check` passes
  - Focused Vitest store/event-flow suites pass

## System-Wide Impact

- **Backend becomes the canonical tool-state owner before UI dispatch:** this is the main architectural shift
- **Frontend becomes a simpler projector of canonical tool state:** tool handling becomes less provider-aware and less timing-sensitive
- **Provider adapters stay narrow:** this plan does not move provider quirks back out of the adapter layer
- **Ordering and batching remain critical:** tool and assistant stream ordering must stay stable while responsibility shifts out of the frontend

## Risks & Dependencies

- **Behavioral regression risk:** tool ordering and rapid completion races are subtle; prior regressions must remain explicitly covered
- **Diff size risk:** this touches both Rust and TypeScript, so commit boundaries should follow the implementation units closely
- **Naming/ownership risk:** if the reconciler broadens materially beyond “task” responsibilities, naming and module boundaries may need to change during implementation

## Sources & References

- Direct user request to continue the “GOD architecture” toward one canonical reconciler
- Current session architecture notes in `docs/plans/` history and local session plan
- Related code: `packages/desktop/src-tauri/src/acp/task_reconciler.rs`
- Related code: `packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs`
- Related code: `packages/desktop/src/lib/acp/store/session-event-service.svelte.ts`
