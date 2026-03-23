---
status: complete
priority: p1
issue_id: "030"
tags: [code-review, rust, data-integrity, streaming]
dependencies: []
---

# Data Loss on LRU Buffer Eviction

## Problem Statement

When the streaming delta batcher reaches `MAX_BUFFERS` (1000 concurrent buffers), it evicts the oldest buffer to make room for new ones. However, the eviction **silently discards accumulated data** without emitting it first. This causes data loss for users.

**Why it matters:** Users could lose partial tool call input or message chunks during high-load scenarios with many concurrent streaming operations. The data loss is silent - no error or warning is shown to the user.

## Findings

### Location

`/packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs:305-342`

### Current Behavior

```rust
fn evict_oldest_buffer(&mut self) {
    // ... find oldest buffer ...
    if delta_time < msg_time {
        tracing::warn!(tool_call_id = %delta_key, "Evicting oldest delta buffer");
        self.delta_buffers.remove(&delta_key);  // DATA LOST HERE - accumulated string dropped
    } else {
        tracing::warn!(?msg_key, "Evicting oldest message buffer");
        self.message_buffers.remove(&msg_key);  // DATA LOST HERE - accumulated text dropped
    }
}
```

### Root Cause

The `evict_oldest_buffer()` method removes buffers using `HashMap::remove()` which drops the value. The accumulated `String` content is deallocated without being sent to the frontend.

### Impact

- Partial tool outputs missing in UI
- Incomplete streaming text chunks
- Silent failure - users don't know data was lost
- Affects scenarios with 1000+ concurrent streaming operations

## Proposed Solutions

### Option A: Emit Before Eviction (Recommended)

Modify `evict_oldest_buffer()` to emit the buffer content before removing it.

```rust
fn evict_oldest_buffer(&mut self) -> Vec<SessionUpdate> {
    let mut results = Vec::new();
    // ... find oldest ...
    if delta_time < msg_time {
        tracing::warn!(tool_call_id = %delta_key, "Evicting oldest delta buffer - emitting first");
        results.extend(self.emit_tool_delta(&delta_key));  // Emit before removal
    } else {
        tracing::warn!(?msg_key, "Evicting oldest message buffer - emitting first");
        results.extend(self.emit_message_chunk(&msg_key));  // Emit before removal
    }
    results
}
```

Then update callers to emit the returned updates.

**Pros:** No data loss, minimal code change
**Cons:** Evicted data arrives slightly out of normal batch timing
**Effort:** Small
**Risk:** Low

### Option B: Increase MAX_BUFFERS

Raise `MAX_BUFFERS` from 1000 to 10000 to make eviction less likely.

**Pros:** Simple constant change
**Cons:** Doesn't fix the bug, just delays it; higher memory usage
**Effort:** Trivial
**Risk:** Low but doesn't solve root cause

### Option C: Per-Session Buffer Quotas

Add `MAX_BUFFERS_PER_SESSION` to prevent one session from consuming all slots.

**Pros:** Fairer resource distribution, prevents single session monopolizing buffers
**Cons:** More complex implementation, doesn't fix the emit-before-drop issue
**Effort:** Medium
**Risk:** Medium

## Recommended Action

**Option A** - Emit data before eviction. This is the correct fix that preserves user data.

## Technical Details

### Affected Files

- `packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs`

### Test Coverage Needed

- Test that eviction emits data before removal
- Test that evicted data is valid and complete
- Test with MAX_BUFFERS concurrent streams

## Acceptance Criteria

- [x] `evict_oldest_buffer()` returns `Vec<SessionUpdate>` with emitted data
- [x] Callers of `evict_oldest_buffer()` forward returned updates for emission
- [x] Warn log includes "emitting first" to indicate data was preserved
- [x] Test verifies no data loss during eviction scenario
- [x] Existing tests continue to pass

## Work Log

| Date       | Action    | Notes                                                                                                                                                                                                                        |
| ---------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-02-01 | Created   | Identified during code review                                                                                                                                                                                                |
| 2026-02-01 | Completed | Modified `evict_oldest_buffer()` to use `emit_tool_delta()`/`emit_message_chunk()` instead of `.remove()`. Updated callers to propagate evicted updates. Added `eviction_emits_data_before_removal` test. All 11 tests pass. |

## Resources

- PR: Uncommitted changes on main
- File: `streaming_delta_batcher.rs:305-342`
- Related: #023 (unbounded hashmap growth - completed)
