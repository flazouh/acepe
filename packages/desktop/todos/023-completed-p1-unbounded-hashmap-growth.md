---
status: completed
priority: p1
issue_id: "023"
tags: [code-review, security, rust, streaming-batcher]
dependencies: []
---

# Unbounded HashMap Growth - DoS via Tool Call ID Flooding

## Problem Statement

The `StreamingDeltaBatcher` has no limit on the number of entries in its `buffers` HashMap. An attacker or misbehaving agent could send streaming updates with unique `tool_call_id` values to exhaust memory.

## Findings

### Security Sentinel Analysis

- **Location:** `/packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs` lines 28, 69
- **Code:**

  ```rust
  pub struct StreamingDeltaBatcher {
      buffers: HashMap<String, DeltaBuffer>,  // Unbounded
  }

  // Entry created for each unique tool_call_id
  let buffer = self.buffers.entry(tool_call_id.clone()).or_insert_with(...)
  ```

- **Attack Vector:** Send thousands of streaming updates with unique tool_call_id values
- **Impact:** Memory exhaustion, application unresponsiveness

### Architecture Strategist Analysis

- Each unique tool_call_id creates a new HashMap entry
- Entries persist until explicitly flushed or loop ends
- No eviction mechanism for stale entries

## Proposed Solutions

### Solution A: Maximum Concurrent Buffers (Recommended)

**Approach:** Add a limit on HashMap entries with LRU eviction

```rust
const MAX_BUFFERS: usize = 1000;

// In process():
if self.buffers.len() >= MAX_BUFFERS && !self.buffers.contains_key(&tool_call_id) {
    tracing::warn!("Maximum buffer count reached, evicting oldest");
    // Find and evict the oldest buffer (by first_received)
    if let Some((oldest_id, _)) = self.buffers.iter()
        .min_by_key(|(_, buf)| buf.first_received)
        .map(|(id, buf)| (id.clone(), buf.clone()))
    {
        self.flush_one(&oldest_id);
    }
}
```

| Pros                            | Cons                                           |
| ------------------------------- | ---------------------------------------------- |
| Prevents unbounded growth       | May evict active buffers in pathological cases |
| LRU eviction is fair            | Slightly more complex                          |
| 1000 buffers = ~10MB worst case |                                                |

**Effort:** Small
**Risk:** Low

### Solution B: IndexMap with Size Limit

**Approach:** Use IndexMap for O(1) oldest eviction

```rust
use indexmap::IndexMap;

buffers: IndexMap<String, DeltaBuffer>,

// Evict from front (oldest insertion order)
if self.buffers.len() >= MAX_BUFFERS {
    if let Some((id, _)) = self.buffers.shift_remove_entry(&self.buffers.keys().next().unwrap().clone()) {
        // Emit the evicted buffer
    }
}
```

| Pros                      | Cons                              |
| ------------------------- | --------------------------------- |
| O(1) eviction             | Adds dependency (indexmap)        |
| Preserves insertion order | May already have indexmap in deps |

**Effort:** Small
**Risk:** Low

## Recommended Action

Implement Solution A with simple min_by_key eviction. If performance is a concern, consider Solution B.

## Technical Details

**Affected Files:**

- `/packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs`

**Combined with Issue 022:**
Both buffer size limits and count limits should be implemented together as a cohesive defensive measure.

## Acceptance Criteria

- [ ] Add MAX_BUFFERS constant (1000 recommended)
- [ ] Implement eviction when limit is reached
- [ ] Log warning when eviction occurs
- [ ] Add test for buffer count limit behavior
- [ ] Rust compilation passes
- [ ] Existing tests still pass

## Work Log

| Date       | Action                   | Learnings                             |
| ---------- | ------------------------ | ------------------------------------- |
| 2026-01-31 | Created from code review | Identified by security-sentinel agent |

## Resources

- PR: N/A (uncommitted changes on main)
- Related: Issue 022 (buffer size limit)
