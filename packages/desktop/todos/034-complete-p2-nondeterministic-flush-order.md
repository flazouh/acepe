---
status: complete
priority: p2
issue_id: "034"
tags: [code-review, rust, data-integrity, streaming]
dependencies: []
---

# Non-deterministic Flush Order in Rust Batcher

## Problem Statement

`flush_all()` uses `HashMap::drain()` which iterates in arbitrary order. When multiple message/thought buffers are flushed, they may arrive at the frontend out of order.

**Why it matters:** Thoughts and messages for the same session may appear out of order in the UI.

## Findings

### Location

`/packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs:379-380`

### Current Behavior

```rust
for (_, buffer) in self.message_buffers.drain() {  // ARBITRARY ORDER
    // ...
}
```

## Proposed Solution

Sort buffers by `first_received` timestamp before emitting:

```rust
// Collect and sort by first_received
let mut buffers: Vec<_> = self.message_buffers.drain().collect();
buffers.sort_by_key(|(_, buf)| buf.first_received);
for (_, buffer) in buffers {
    // emit...
}
```

## Acceptance Criteria

- [ ] Sort delta buffers by first_received before emitting
- [ ] Sort message buffers by first_received before emitting
- [ ] Add test verifying ordering is preserved
