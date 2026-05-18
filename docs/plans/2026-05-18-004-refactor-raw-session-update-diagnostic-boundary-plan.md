---
title: "refactor: Raw session update diagnostic boundary"
type: refactor
status: active
date: 2026-05-18
origin: docs/brainstorms/2026-04-25-final-god-architecture-requirements.md
depends_on:
  - docs/plans/2026-05-18-003-refactor-live-transcript-identity-boundary-plan.md
  - docs/solutions/architectural/live-transcript-display-identity-boundary-2026-05-18.md
---

# Refactor: Raw Session Update Diagnostic Boundary

## Overview

The live transcript identity bug is fixed in Rust and committed. The next GOD cleanup is the old TypeScript raw `SessionUpdate` display-entry surface.

The target rule is simple:

```text
raw SessionUpdate event
  -> diagnostic logging / buffering only
  -> no product transcript entry creation in TypeScript
```

Product transcript rows must come from canonical Rust transcript snapshots and deltas. TypeScript can record raw events for debugging, but it must not expose public APIs or helper classes that suggest raw provider updates can be converted directly into visible transcript rows.

## Planning Inventory

Inventory was collected before implementation planning on 2026-05-18.

### Real GOD Violation Candidates

- `packages/desktop/src/lib/acp/logic/message-processor.ts`
  - Exposes `processUpdate(update: SessionUpdate): Result<ThreadEntry | null, AcpError>`.
  - Converts raw `agentMessageChunk`, `agentThoughtChunk`, `userMessageChunk`, and `toolCall` updates into visible `ThreadEntry` rows.
  - Risk: this is exactly the old downstream repair shape. Even if production no longer calls it for live transcript truth, the API is still exported and easy to reuse.
  - GOD issue: raw provider events should not become display entries in TypeScript.

- `packages/desktop/src/lib/acp/logic/index.ts`
  - Re-exports `MessageProcessor` from the public ACP logic barrel.
  - Risk: external or nearby code can import a raw-event-to-display-entry converter without crossing a canonical boundary.
  - GOD issue: compatibility/raw helpers must not be public product APIs.

- `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
  - Exposes public `handleSessionUpdate(update: SessionUpdate): void`.
  - It routes raw updates into `SessionEventService.handleSessionUpdate`.
  - Current event service mostly treats raw updates as diagnostic, but the public store method still looks like a product state mutation door.
  - GOD issue: product store API should expose canonical session-state envelope application and transcript snapshot/delta methods, not raw provider update ingestion.

- `packages/desktop/src/lib/acp/store/services/chunk-aggregator.ts`
  - Still owns compatibility assistant/user display-row aggregation.
  - Uses provider `messageId` inside a TypeScript aggregation state.
  - Current callers are private/test seams only, but the class and interface still have broad public methods.
  - GOD issue: this should be explicitly test-only compatibility support or narrowed so production code cannot call raw chunk aggregation.

- `packages/desktop/src/lib/acp/store/services/interfaces/chunk-aggregator-interface.ts`
  - Public interface still advertises `aggregateCompatibilityAssistantChunk(...)` and `aggregateCompatibilityUserChunk(...)`.
  - GOD issue: service interfaces should describe product behavior. Compatibility-only mutation methods should not be public interface obligations.

### Mostly Legal Or Lower-Risk Findings

- `packages/desktop/src/lib/acp/store/session-event-service.svelte.ts`
  - `handleSessionUpdate(...)` is needed as the event subscriber callback.
  - It now drops assistant message/thought chunks and logs other raw events.
  - It may stay, but it should be private to event subscription and test-access only if tests need it.

- `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts`
  - Compatibility writer methods are already private after the previous slice.
  - Remaining risk is lower than the public `MessageProcessor` and raw store method.

- `packages/desktop/src/lib/acp/store/services/transcript-tool-call-buffer.svelte.ts`
  - Writes compatibility tool-call rows through the internal entry-store interface.
  - It also handles progressive argument indexes. This should not be deleted until tests prove all production tool transcript rendering is canonical.

## Problem Frame

Acepe now has canonical Rust transcript projection for live display identity, but old TypeScript helpers still encode the previous mental model:

```text
SessionUpdate -> ThreadEntry
```

That model is no longer the product architecture. It keeps a second display-entry creation path alive and makes future regressions likely. The clean architecture removes or hides that path, then keeps only the minimal compatibility helper code needed by tests until it can be deleted safely.

## Requirements Trace

- R1. Provider facts flow through Rust-owned canonical data before TypeScript display projection.
- R3. Transcript order and transcript identity are product truth.
- R12. UI and store projections consume canonical state; they do not repair provider quirks.
- R23. Desktop stores consume and project canonical state, not repair it.
- R27. Old authorities must be deleted or quarantined with proof.

## Scope Boundaries

- This plan does not change Rust transcript projection behavior.
- This plan does not remove diagnostic raw event recording.
- This plan does not remove canonical snapshot or delta application APIs.
- This plan does not make historical sessions read-only.
- This plan does not delete compatibility tool-call buffering until tests prove no product path depends on it.

## Key Technical Decisions

- **Delete the raw-event-to-display-entry API.** `MessageProcessor.processUpdate(...)` is the wrong abstraction now. Keep only content merge/normalization helpers that compatibility tests still need.
- **Remove public exports for compatibility-only helpers.** A raw display-row helper may exist only by direct local import from its owner module or test helper, not from the public ACP logic barrel.
- **Close the public raw store door.** Production callers should not call `SessionStore.handleSessionUpdate(...)`. Event subscription can call `SessionEventService` directly.
- **Keep compatibility tests honest.** Tests that still exercise compatibility aggregation should import explicit test-access helpers or the exact internal class under test. They must not imply a production transcript path.

## Implementation Units

- [x] **Unit 1: Characterize Raw Lane As Diagnostic**

**Goal:** Prove the raw event service does not create transcript rows from assistant chunks.

**Requirements:** R1, R3, R27

**Files:**
- Test: `packages/desktop/src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts`
- Test: `packages/desktop/src/lib/acp/store/services/__tests__/session-event-service-streaming.vitest.ts` if a narrower event-service test already exists or is more natural

**Approach:**
- Add or confirm a test where a known session receives raw `agentMessageChunk` through the event service path.
- Assert no compatibility transcript entry is appended.
- Assert canonical snapshot/delta application remains the path that changes entries.

**Execution note:** Characterization-first.

**Verification:**
- The test fails only if raw assistant chunks can still create transcript display rows.

**Execution result:** Added `treats raw assistant chunks as diagnostic and leaves transcript entries unchanged` in `packages/desktop/src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts`. The test proves a raw `agentMessageChunk` does not change compatibility entries or canonical transcript snapshots.

- [x] **Unit 2: Delete Public Raw Message Processing API**

**Goal:** Remove the general `SessionUpdate -> ThreadEntry` converter from public TypeScript code.

**Requirements:** R1, R12, R23, R27

**Files:**
- Modify: `packages/desktop/src/lib/acp/logic/message-processor.ts`
- Modify: `packages/desktop/src/lib/acp/logic/index.ts`
- Modify/Delete: `packages/desktop/src/lib/acp/logic/__tests__/message-processor.test.ts`
- Modify: `packages/desktop/src/lib/acp/store/services/chunk-aggregator.ts`

**Approach:**
- Remove `processUpdate(...)` from `MessageProcessor`.
- Rename or narrow the remaining class if it only merges compatibility message chunks.
- Remove `MessageProcessor` from the public `logic/index.ts` barrel.
- Update tests so they cover the remaining merge/normalization behavior without raw `SessionUpdate` conversion.

**Verification:**
- No production search result for `processUpdate(` or public `MessageProcessor` import.

**Execution result:** Deleted `MessageProcessor` and its raw `SessionUpdate -> ThreadEntry` tests. Added `CompatibilityMessageChunkMerger` for the remaining compatibility-only chunk merge behavior. Removed the `MessageProcessor` public barrel export.

- [x] **Unit 3: Narrow Compatibility Chunk Aggregator Interface**

**Goal:** Stop advertising compatibility row aggregation as a public service contract.

**Requirements:** R12, R23, R27

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/services/interfaces/chunk-aggregator-interface.ts`
- Modify: `packages/desktop/src/lib/acp/store/services/chunk-aggregator.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts`
- Modify tests that instantiate or mock `IChunkAggregator`

**Approach:**
- Remove compatibility aggregation methods from the exported interface if no production polymorphic caller needs them.
- Keep boundary/cleanup methods that product lifecycle still needs.
- Leave compatibility aggregation methods as concrete internal methods only while tests still need them.

**Verification:**
- Production search shows no interface-based caller can create compatibility transcript rows.

**Execution result:** Removed compatibility aggregation methods from `IChunkAggregator`. The concrete compatibility methods remain only on the implementation used by the private `SessionEntryStore` compatibility test seam.

- [x] **Unit 4: Remove Or Privatize `SessionStore.handleSessionUpdate`**

**Goal:** Ensure the store public API does not expose raw provider update mutation.

**Requirements:** R1, R12, R23, R27

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
- Modify tests that call `store.handleSessionUpdate(...)`
- Optional test helper: `packages/desktop/src/lib/acp/store/__tests__/session-store-test-access.ts`

**Approach:**
- Search all callers.
- If only tests call it, move access behind a test helper or delete the tests that encode old behavior.
- If production calls it, reroute that production call to canonical envelope or event-service diagnostic handling.

**Verification:**
- Production search shows no public `SessionStore.handleSessionUpdate(...)` surface.

**Execution result:** Removed the public `SessionStore.handleSessionUpdate(...)` method. Tests that need to exercise diagnostic raw events now use `packages/desktop/src/lib/acp/store/__tests__/session-store-test-access.ts`.

## Verification Plan

- `cd packages/desktop && bun run check`
- Focused Bun tests for:
  - `packages/desktop/src/lib/acp/logic/__tests__/message-processor.test.ts` or its replacement
  - `packages/desktop/src/lib/acp/store/services/__tests__/chunk-aggregator.test.ts`
  - `packages/desktop/src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts`
  - streaming/session event tests touched by Unit 1 or Unit 4
- Guard scans:
  - `rg -n "processUpdate\\(|export \\{ MessageProcessor \\}|\\.handleSessionUpdate\\(|aggregateCompatibilityAssistantChunk\\(|aggregateCompatibilityUserChunk\\(" packages/desktop/src/lib/acp -g '!**/__tests__/**' -g '!**/*.test.ts' -g '!**/*.vitest.ts'`

Expected scan result: no public raw event to display-entry processor, no public store raw update method, and compatibility aggregation limited to internal implementation or tests.

## Current Verification

- `cd packages/desktop && bun test ./src/lib/acp/logic/__tests__/compatibility-message-chunk-merger.test.ts ./src/lib/acp/store/services/__tests__/chunk-aggregator.test.ts ./src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts ./src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts`
  - 145 passed, 0 failed
- `cd packages/desktop && bun run check`
  - passed with the existing SvelteKit `baseUrl`/`paths` warning
- `git diff --check`
  - passed
- Guard scans:
  - no production `MessageProcessor`, `processUpdate(...)`, public `MessageProcessor` barrel export, or `store.handleSessionUpdate(...)`
  - no compatibility aggregation methods left on `IChunkAggregator`
