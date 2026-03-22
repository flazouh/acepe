---
status: complete
priority: p3
issue_id: "038"
tags: [code-review, typescript, performance, architecture]
dependencies: []
---

# Two-Layer Batching Redundancy

## Problem Statement

TypeScript `session-event-service.svelte.ts` was buffering streaming deltas and message chunks, then flushing via RAF-aligned `BatchScheduler`. However, the Rust `StreamingDeltaBatcher` already batches at 16ms intervals (aligned with 60fps) before emitting Tauri events.

This created redundant two-layer batching:

1. **Rust layer**: Accumulates text, batches at 16ms, emits via Tauri
2. **TypeScript layer**: Re-accumulates the already-accumulated text, batches via RAF (~16ms)

## Findings

### Removed Components (~140 lines)

- `streamingDeltaBuffer` Map - buffered tool call streaming deltas
- `messageChunkBuffer` Map - buffered message/thought text chunks
- `streamingDeltaScheduler` BatchScheduler instance
- `messageChunkScheduler` BatchScheduler instance
- `MAX_STREAMING_BUFFER_SIZE` constant (1MB limit)
- `bufferStreamingDelta()` method
- `bufferMessageChunk()` method
- `flushStreamingDeltas()` method
- `flushMessageChunks()` method
- `flushAllBuffers()` method

### Why Removal is Safe

- Rust `StreamingDeltaBatcher` already provides 16ms batching
- Rust already accumulates text strings before emitting
- RAF alignment (~16ms) was nearly identical to Rust batching interval
- The downstream stores (`SessionEntryStore`) have their own RAF-aligned batching

## Solution

- Removed TypeScript buffering layer
- Modified `handleSessionUpdate()` to process streaming updates directly
- Streaming deltas now call `handler.accumulateStreamingInputDelta()` immediately
- Message chunks now call `handler.aggregateAssistantChunk()` immediately
- Removed unused `BatchScheduler` import

## Data Flow After Change

```
Rust StreamingDeltaBatcher (16ms batch)
    ↓ emits SessionUpdate via Tauri
TypeScript SessionEventService
    ↓ processes immediately (no buffering)
TypeScript SessionEntryStore (RAF-aligned batching)
    ↓ flushes to SvelteMap
Svelte reactivity (renders)
```

## Acceptance Criteria

- [x] TypeScript buffering removed from session-event-service.svelte.ts
- [x] Streaming deltas processed directly via handler
- [x] Message chunks processed directly via handler
- [x] TypeScript check passes (excluding pre-existing paraglide errors)
- [x] All tests pass

## Note on BatchScheduler

BatchScheduler class (38 lines) was kept as a clean abstraction. It's still used in 4 production locations:

- `session-entry-store.svelte.ts` (2 usages)
- `session-hot-state-store.svelte.ts` (1 usage)
- `session-capabilities-store.svelte.ts` (1 usage)

The abstraction provides value by encapsulating the RAF scheduling + deduplication pattern.

## Work Log

| Date       | Action                | Notes                                  |
| ---------- | --------------------- | -------------------------------------- |
| 2026-02-01 | Created and completed | Removed redundant TypeScript buffering |
