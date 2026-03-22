---
status: completed
priority: p2
issue_id: "024"
tags: [code-review, rust, streaming-batcher, memory-leak]
dependencies: []
---

# Stale Buffer Cleanup - Memory Leak Risk

## Problem Statement

Buffers in `StreamingDeltaBatcher` are only removed when:

1. The 16ms timeout expires AND a new delta arrives for the same tool_call_id
2. `flush_one()` or `flush_all()` is called

If a tool call is abandoned (agent crashes, network issue, session terminated), the buffer persists indefinitely until `flush_all()` is called when the subprocess stdout reader task ends.

## Findings

### Security Sentinel Analysis

- **Location:** `/packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs` lines 79-83, 106-128
- **Issue:** No periodic cleanup of stale buffers
- **Impact:** Gradual memory leak over time in long-running sessions

### Data Integrity Guardian Analysis

- **Scenario:** Tool call starts streaming but never completes
- **Result:** Buffer remains in HashMap forever
- **Risk:** Low in practice (sessions are short-lived), but could accumulate

### Performance Oracle Analysis

- Confirmed: No staleness check or periodic cleanup mechanism exists
- `flush_all()` only called when stdout reader task ends

## Proposed Solutions

### Solution A: Periodic Staleness Check (Recommended)

**Approach:** Add cleanup method and call it periodically

```rust
const MAX_BUFFER_AGE: Duration = Duration::from_secs(60);

pub fn cleanup_stale(&mut self) -> Vec<SessionUpdate> {
    let now = Instant::now();
    let stale_ids: Vec<String> = self.buffers
        .iter()
        .filter(|(_, buf)| now.duration_since(buf.first_received) > MAX_BUFFER_AGE)
        .map(|(id, _)| id.clone())
        .collect();

    stale_ids.iter().filter_map(|id| self.flush_one(id)).collect()
}

// In client.rs, call periodically or on certain events
```

| Pros                             | Cons                                |
| -------------------------------- | ----------------------------------- |
| Prevents memory leaks            | Need to decide when to call cleanup |
| Simple implementation            | Adds maintenance overhead           |
| Configurable staleness threshold |                                     |

**Effort:** Small
**Risk:** Low

### Solution B: Auto-cleanup on New Delta

**Approach:** Check and cleanup stale buffers when processing new deltas

```rust
// In process(), before adding new buffer:
if self.buffers.len() > 100 { // Only when many buffers
    self.cleanup_stale();
}
```

| Pros                      | Cons                        |
| ------------------------- | --------------------------- |
| No separate timer needed  | Coupled to delta processing |
| Cleanup happens naturally | May cause latency spikes    |

**Effort:** Small
**Risk:** Low

## Recommended Action

Implement Solution A and call `cleanup_stale()` when the loop is idle (e.g., after processing each batch of lines).

## Technical Details

**Affected Files:**

- `/packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs`
- `/packages/desktop/src-tauri/src/acp/client.rs`

**Suggested Threshold:**

- MAX_BUFFER_AGE: 60 seconds (tool calls shouldn't stream for more than a minute without updates)

## Acceptance Criteria

- [ ] Add MAX_BUFFER_AGE constant (60s recommended)
- [ ] Add cleanup_stale() method
- [ ] Call cleanup from client.rs periodically
- [ ] Add test for staleness cleanup behavior
- [ ] Rust compilation passes
- [ ] Existing tests still pass

## Work Log

| Date       | Action                   | Learnings                                                          |
| ---------- | ------------------------ | ------------------------------------------------------------------ |
| 2026-01-31 | Created from code review | Identified by security-sentinel and data-integrity-guardian agents |

## Resources

- PR: N/A (uncommitted changes on main)
- Related: Issue 022, 023 (other buffer limits)
