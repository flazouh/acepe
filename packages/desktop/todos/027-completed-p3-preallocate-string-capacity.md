---
status: completed
priority: p3
issue_id: "027"
tags: [code-review, rust, streaming-batcher, performance]
dependencies: []
---

# Pre-allocate String Capacity for Delta Buffer

## Problem Statement

The `DeltaBuffer.accumulated` String is created with default capacity and grows dynamically via `push_str()`. With ~100 deltas/sec and average delta size of 10-50 characters, this causes repeated memory reallocations.

## Findings

### Performance Oracle Analysis

- **Location:** `/packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs` line 76
- **Code:**
  ```rust
  buffer.accumulated.push_str(&delta);  // May cause reallocation
  ```
- **Impact:** Each reallocation doubles capacity, so for 16ms of accumulation (~1-2 deltas), this is likely 1-2 reallocations per batch
- **Severity:** Low - not a critical issue

### Code Simplicity Analysis

- Default String starts at capacity 0
- First push allocates, subsequent pushes may reallocate
- Pre-allocation would reduce allocations

## Proposed Solutions

### Solution A: Pre-allocate on Creation (Recommended)

**Approach:** Set initial capacity based on expected delta sizes

```rust
DeltaBuffer {
    session_id: session_id.clone().unwrap_or_default(),
    accumulated: String::with_capacity(512), // ~10-20 typical deltas
    first_received: now,
}
```

| Pros                | Cons                                |
| ------------------- | ----------------------------------- |
| Reduces allocations | May over-allocate for small outputs |
| Simple change       | Minimal impact                      |
| No API changes      |                                     |

**Effort:** Trivial
**Risk:** None

## Recommended Action

Add `String::with_capacity(512)` when creating DeltaBuffer.

## Technical Details

**Affected Files:**

- `/packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs` line 71

## Acceptance Criteria

- [ ] Add with_capacity(512) when creating accumulated String
- [ ] Rust compilation passes
- [ ] Existing tests still pass

## Work Log

| Date       | Action                   | Learnings                              |
| ---------- | ------------------------ | -------------------------------------- |
| 2026-01-31 | Created from code review | Identified by performance-oracle agent |

## Resources

- PR: N/A (uncommitted changes on main)
