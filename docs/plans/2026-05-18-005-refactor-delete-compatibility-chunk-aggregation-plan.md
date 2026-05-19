---
title: "refactor: Delete compatibility chunk aggregation"
type: refactor
status: active
date: 2026-05-18
origin: docs/brainstorms/2026-04-25-final-god-architecture-requirements.md
depends_on:
  - docs/plans/2026-05-18-004-refactor-raw-session-update-diagnostic-boundary-plan.md
  - docs/solutions/architectural/live-transcript-display-identity-boundary-2026-05-18.md
---

# Refactor: Delete Compatibility Chunk Aggregation

## Overview

The raw `SessionUpdate -> ThreadEntry` converter is gone. The next remaining GOD violation is the compatibility assistant/user chunk aggregation stack that still keeps provider-message-id grouping logic in TypeScript.

Target rule:

```text
TypeScript entry store
  -> stores canonical transcript snapshots/deltas
  -> may buffer canonical tool rows
  -> does not aggregate assistant/user chunks by provider message id
```

## Planning Inventory

Inventory was collected after commit `7754f1fc3`.

### Real GOD Violation Candidates

- `packages/desktop/src/lib/acp/logic/chunk-action-resolver.ts`
  - Resolves assistant chunk grouping from `messageId`.
  - Can choose `entryId = sourceMessageId`.
  - GOD issue: provider message ids must not be display-entry identity or grouping authority in TypeScript.

- `packages/desktop/src/lib/acp/logic/chunk-aggregation-types.ts`
  - Defines state for `lastKnownMessageId`, `pendingBoundaries`, and `postBoundaryMap`.
  - GOD issue: preserves the old provider-id aggregation model.

- `packages/desktop/src/lib/acp/store/services/chunk-aggregator.ts`
  - Owns compatibility assistant/user chunk aggregation.
  - Uses provider `messageId` and the old boundary state.
  - Production search shows no non-test caller except private compatibility wrappers on `SessionEntryStore`.

- `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts`
  - Holds a `ChunkAggregator`.
  - Private methods still expose compatibility assistant/user aggregation to test helpers.
  - Updates an assistant `messageId` index when entries are appended or replaced.

- `packages/desktop/src/lib/acp/store/services/entry-index-manager.ts`
  - Maintains `messageIdIndex` only for assistant chunk aggregation.
  - GOD issue: an index named message-id still suggests provider message ids are a display-row lookup key.

- `packages/desktop/src/lib/acp/store/services/interfaces/entry-index.ts`
  - Exposes message-id index methods.
  - GOD issue: service interface preserves the old authority seam.

### Mostly Legal Or Lower-Risk Findings

- `TranscriptToolCallBuffer` still writes compatibility tool rows.
  - Keep it in this slice. Tool rows are tied to canonical tool-call ids and current tests still cover progressive arguments.

- `EntryIndexManager` entry-id and tool-call-id indexes are legal.
  - Entry ids are Acepe/canonical display ids.
  - Tool call ids are canonical operation ids promoted by Rust.

## Problem Frame

Acepe no longer uses raw assistant chunks as product transcript input. Keeping the old TypeScript chunk aggregation stack means the codebase still contains a complete alternative transcript builder. That is not just dead code; it is a ready-made regression path.

The clean fix is deletion:

- delete raw assistant/user compatibility aggregation,
- delete provider-message-id entry indexes,
- keep canonical snapshot/delta entry storage,
- keep tool-call buffering only where canonical tool rows still need progressive display support.

## Requirements Trace

- R1. Provider facts flow through Rust-owned canonical data before TypeScript display projection.
- R3. Transcript order and transcript identity are product truth.
- R12. UI and store projections consume canonical state; they do not repair provider quirks.
- R23. Desktop stores consume and project canonical state, not repair it.
- R27. Old authorities must be deleted or quarantined with proof.

## Scope Boundaries

- This plan does not delete `TranscriptToolCallBuffer`.
- This plan does not change Rust projection.
- This plan does not remove `SessionEntryStore` canonical snapshot/delta storage.
- This plan does not delete user optimistic/pending panel-local UI state.

## Implementation Units

- [x] **Unit 1: Delete Compatibility Chunk Aggregation Tests**

**Goal:** Remove tests that encode the old TypeScript provider-message-id aggregation behavior.

**Requirements:** R3, R27

**Files:**
- Delete: `packages/desktop/src/lib/acp/logic/__tests__/chunk-action-resolver.test.ts`
- Delete: `packages/desktop/src/lib/acp/store/services/__tests__/chunk-aggregator.test.ts`
- Delete or rewrite old compatibility aggregation suites under `packages/desktop/src/lib/acp/store/__tests__/`

**Approach:**
- Delete tests whose only purpose is proving raw chunk aggregation.
- Keep tests that prove canonical snapshot/delta behavior or tool-call buffering.

**Verification:**
- Focused test list no longer references `aggregateCompatibilityAssistantChunk(...)` or `chunk-action-resolver`.

**Execution result:** Deleted the obsolete raw chunk aggregation suites and removed old test references from remaining session-entry, tool-flow, and messaging lifecycle tests.

- [x] **Unit 2: Delete Chunk Aggregation Implementation**

**Goal:** Remove the TypeScript provider-message-id assistant/user aggregation stack.

**Requirements:** R1, R3, R12, R23, R27

**Files:**
- Delete: `packages/desktop/src/lib/acp/logic/chunk-action-resolver.ts`
- Delete: `packages/desktop/src/lib/acp/logic/chunk-aggregation-types.ts`
- Delete: `packages/desktop/src/lib/acp/store/services/chunk-aggregator.ts`
- Delete: `packages/desktop/src/lib/acp/logic/compatibility-message-chunk-merger.ts` if no remaining production/test caller needs it
- Modify: `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/__tests__/entry-store-test-access.ts`

**Approach:**
- Remove `ChunkAggregator` from `SessionEntryStore`.
- Remove private assistant/user compatibility aggregation methods.
- Make `clearStreamingAssistantEntry(...)` and `startNewAssistantTurn(...)` no-ops or delete them if service interfaces allow it.

**Verification:**
- No production search result for `ChunkAggregator`, `aggregateCompatibilityAssistantChunk`, `aggregateCompatibilityUserChunk`, or `chunk-action-resolver`.

**Execution result:** Deleted `chunk-action-resolver.ts`, `chunk-aggregation-types.ts`, `normalize-chunk.ts`, `message-chunk.schema.ts`, `ChunkAggregator`, and the compatibility message chunk merger. Removed `ChunkAggregator` from `SessionEntryStore`; assistant chunk lifecycle methods are now no-op compatibility hooks because raw assistant chunks are canonical-only.

- [x] **Unit 3: Delete Message-Id Entry Index**

**Goal:** Remove the provider-message-id index from entry storage.

**Requirements:** R3, R23, R27

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/services/entry-index-manager.ts`
- Modify: `packages/desktop/src/lib/acp/store/services/interfaces/entry-index.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts`
- Modify/Delete: `packages/desktop/src/lib/acp/store/services/__tests__/entry-index-manager.test.ts`

**Approach:**
- Use `entryIdIndex` for assistant display-entry lookup.
- Keep `toolCallIdIndex`.
- Remove message-id index storage and methods.

**Verification:**
- No production search result for `getMessageIdIndex`, `addMessageId`, `deleteMessageId`, or `rebuildMessageIdIndex`.

**Execution result:** Removed message-id index state and methods from `EntryIndexManager`, `IEntryIndex`, `SessionEntryStore`, and tests. Entry storage now keeps only canonical entry-id and tool-call-id indexes.

## Verification Plan

- `cd packages/desktop && bun run check`
- Focused tests that remain relevant:
  - `packages/desktop/src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts`
  - `packages/desktop/src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts`
  - `packages/desktop/src/lib/acp/store/services/__tests__/transcript-tool-call-buffer.test.ts`
  - `packages/desktop/src/lib/acp/store/services/__tests__/entry-index-manager.test.ts` if retained for entry/tool indexes
- Guard scans:
  - `rg -n "ChunkAggregator|chunk-action-resolver|chunk-aggregation-types|aggregateCompatibilityAssistantChunk|aggregateCompatibilityUserChunk|getMessageIdIndex|addMessageId|deleteMessageId|rebuildMessageIdIndex" packages/desktop/src/lib/acp -g '!**/__tests__/**' -g '!**/*.test.ts' -g '!**/*.vitest.ts'`

Expected result: no matches.

## Current Verification

- `cd packages/desktop && bun test ./src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts ./src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts ./src/lib/acp/store/services/__tests__/transcript-tool-call-buffer.test.ts ./src/lib/acp/store/services/__tests__/entry-index-manager.test.ts ./src/lib/acp/store/__tests__/session-entry-store-streaming.vitest.ts ./src/lib/acp/store/__tests__/tool-call-event-flow.test.ts ./src/lib/acp/store/services/__tests__/session-messaging-service-stream-lifecycle.test.ts`
  - 252 passed, 0 failed
- `cd packages/desktop && bun run check`
  - passed with the existing SvelteKit `baseUrl`/`paths` warning
- `git diff --check`
  - passed
- Guard scan:
  - no production matches for `ChunkAggregator`, `chunk-action-resolver`, `chunk-aggregation-types`, compatibility assistant/user aggregation, message-id index methods, `CompatibilityMessageChunkMerger`, `normalizeChunk`, `message-chunk.schema`, `AssistantChunkInput`, or old assistant/user entry lookup helpers
