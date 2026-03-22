---
status: wontfix
priority: p2
issue_id: "035"
tags: [code-review, rust, streaming, architecture]
dependencies: []
---

# No Periodic Flush for Stalled Streams

## Problem Statement

The batcher only emits when:

1. A new delta arrives after `BATCH_INTERVAL` (16ms) has passed
2. Buffer exceeds `MAX_BUFFER_SIZE`
3. A non-delta status update arrives
4. `flush_all()` is called explicitly

If a stream stalls after partial accumulation, data sits forever until one of these triggers.

**Why it matters:** Network stalls or agent pauses could leave buffered content invisible to users for long periods.

## Findings

### Location

`/packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs` (architecture)

### Current Behavior

No timer-based flush exists. Buffered content waits indefinitely for the next event.

## Proposed Solution

Add a `flush_aged_buffers()` method that emits any buffer older than BATCH_INTERVAL, and call it from the client's event loop.

Alternatively, since the Rust batcher is called on every incoming event, we could check all buffer ages on each `process()` call - but this adds overhead to every call.

**Recommendation:** Keep the current design. The 16ms batch interval is already handled when new data arrives. True stalls (no data at all) are rare, and the `BatcherWithGuard::Drop` ensures data is flushed on session end.

This issue is lower priority than the others - marking as "won't fix" unless user reports issues.

## Decision

**Won't Fix** - The current design handles the common case (continuous streaming) well. True stalls are rare and handled by Drop. Adding a timer adds complexity without clear benefit.
