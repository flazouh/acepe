---
status: completed
priority: p1
issue_id: "022"
tags: [code-review, security, rust, streaming-batcher]
dependencies: []
---

# Unbounded Buffer Size - Memory Exhaustion Risk

## Problem Statement

The `StreamingDeltaBatcher` has no maximum size limit for accumulated delta strings. A malicious or misbehaving ACP agent could flood the system with streaming deltas, causing unbounded memory growth and potential application crash due to OOM.

## Findings

### Security Sentinel Analysis

- **Location:** `/packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs` lines 16-29, 67-76
- **Code:**

  ```rust
  struct DeltaBuffer {
      session_id: String,
      accumulated: String,  // No size limit
      first_received: Instant,
  }

  // In process():
  buffer.accumulated.push_str(&delta);  // Unbounded append
  ```

- **Attack Vector:** A malicious agent could send many unique `tool_call_id` values with small deltas, never triggering the 16ms timeout
- **Impact:** Application crash due to memory exhaustion, system instability

### Performance Oracle Analysis

- Confirmed that the accumulated string has no pre-allocation or size limits
- String reallocation happens dynamically as content grows

## Proposed Solutions

### Solution A: Add Maximum Buffer Size (Recommended)

**Approach:** Add a size limit constant and force flush when exceeded

```rust
const MAX_BUFFER_SIZE: usize = 10 * 1024 * 1024; // 10MB per tool call

// In process():
if buffer.accumulated.len() + delta.len() > MAX_BUFFER_SIZE {
    tracing::warn!("Buffer size limit exceeded for tool_call_id: {}", tool_call_id);
    // Force flush current buffer, then add new delta
    let flushed = self.flush_one(&tool_call_id);
    // ... emit flushed, then buffer new delta
}
```

| Pros                       | Cons                                                |
| -------------------------- | --------------------------------------------------- |
| Prevents memory exhaustion | May cause more frequent emissions for large outputs |
| Simple to implement        | Need to choose appropriate limit                    |
| No API changes needed      |                                                     |

**Effort:** Small
**Risk:** Low

### Solution B: Pre-allocate with Capacity Limit

**Approach:** Pre-allocate String with fixed capacity that acts as limit

```rust
accumulated: String::with_capacity(MAX_BUFFER_SIZE),

// Push would fail at capacity - need to handle
```

| Pros                  | Cons                                          |
| --------------------- | --------------------------------------------- |
| More memory-efficient | More complex error handling                   |
| Fails fast            | Rust String doesn't enforce capacity as limit |

**Effort:** Medium
**Risk:** Medium

## Recommended Action

Implement Solution A - add MAX_BUFFER_SIZE constant and force flush when exceeded.

## Technical Details

**Affected Files:**

- `/packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs`

**Suggested Constants:**

- MAX_BUFFER_SIZE: 10MB per tool call
- MAX_TOTAL_BUFFERS: 1000 concurrent tool calls
- MAX_TOTAL_MEMORY: 100MB across all buffers

## Acceptance Criteria

- [ ] Add MAX_BUFFER_SIZE constant (10MB recommended)
- [ ] Force flush when buffer exceeds size limit
- [ ] Add warning log when limit is hit
- [ ] Add test for buffer size limit behavior
- [ ] Rust compilation passes
- [ ] Existing tests still pass

## Work Log

| Date       | Action                   | Learnings                             |
| ---------- | ------------------------ | ------------------------------------- |
| 2026-01-31 | Created from code review | Identified by security-sentinel agent |

## Resources

- PR: N/A (uncommitted changes on main)
- Related: Similar limits exist in JS-side batching (MAX_STREAMING_BUFFER_SIZE = 1MB)
