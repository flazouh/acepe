---
status: completed
priority: p2
issue_id: "025"
tags: [code-review, rust, streaming-batcher, data-integrity]
dependencies: []
---

# Data Loss on Panic or Termination

## Problem Statement

Buffered deltas are only flushed when the stdout reader task ends gracefully. If the application terminates abruptly (SIGKILL, crash, panic inside the loop), buffered data is lost without being emitted to the frontend.

## Findings

### Data Integrity Guardian Analysis

- **Location:** `/packages/desktop/src-tauri/src/acp/client.rs` lines 477-482
- **Code:**
  ```rust
  // Flush happens ONLY on graceful exit
  if let Some(ref handle) = app_handle {
      for update in streaming_batcher.flush_all() {
          emit_session_update(handle, update);
      }
  }
  tracing::info!("Subprocess stdout reader task ended");
  ```
- **Risk:** If the task panics before reaching this code, deltas are lost

### Exit Condition Analysis

| Exit Condition            | Flush Happens? | Data Loss? |
| ------------------------- | -------------- | ---------- |
| Graceful EOF (`Ok(None)`) | Yes            | No         |
| Read error (`Err(_)`)     | Yes            | No         |
| Panic inside loop         | No             | **Yes**    |
| Task cancellation         | No             | **Yes**    |
| SIGKILL                   | No             | **Yes**    |

### Impact

- Users may see incomplete tool outputs
- UI may appear to lag or jump when streaming stops and resumes

## Proposed Solutions

### Solution A: Drop Guard Pattern (Recommended)

**Approach:** Use a struct that flushes on Drop

```rust
struct BatcherGuard<'a> {
    batcher: &'a mut StreamingDeltaBatcher,
    app_handle: Option<AppHandle>,
}

impl Drop for BatcherGuard<'_> {
    fn drop(&mut self) {
        if let Some(ref handle) = self.app_handle {
            for update in self.batcher.flush_all() {
                emit_session_update(handle, update);
            }
        }
    }
}

// In the task:
let mut streaming_batcher = StreamingDeltaBatcher::new();
let _guard = BatcherGuard {
    batcher: &mut streaming_batcher,
    app_handle: app_handle.clone()
};
// Guard will flush on panic or normal exit
```

| Pros                         | Cons                   |
| ---------------------------- | ---------------------- |
| Guarantees flush on any exit | Slightly more complex  |
| Rust Drop is reliable        | May emit during unwind |
| No explicit flush needed     |                        |

**Effort:** Small
**Risk:** Low

### Solution B: Catch Unwind

**Approach:** Wrap loop body in catch_unwind

```rust
while let Ok(Some(line)) = lines.next_line().await {
    if let Err(e) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        // ... process line
    })) {
        // Flush before propagating
        for update in streaming_batcher.flush_all() {
            emit_session_update(handle, update);
        }
        std::panic::resume_unwind(e);
    }
}
```

| Pros                    | Cons                            |
| ----------------------- | ------------------------------- |
| Explicit panic handling | More verbose                    |
| Can log panic info      | catch_unwind in async is tricky |

**Effort:** Medium
**Risk:** Medium

## Recommended Action

Implement Solution A (Drop guard pattern) for clean, reliable flush on any exit.

## Technical Details

**Affected Files:**

- `/packages/desktop/src-tauri/src/acp/client.rs`
- Potentially add new guard type to streaming_delta_batcher.rs

## Acceptance Criteria

- [ ] Implement Drop guard for StreamingDeltaBatcher
- [ ] Verify flush happens on panic (test with intentional panic)
- [ ] Verify flush happens on normal exit
- [ ] Rust compilation passes
- [ ] Existing tests still pass

## Work Log

| Date       | Action                   | Learnings                                   |
| ---------- | ------------------------ | ------------------------------------------- |
| 2026-01-31 | Created from code review | Identified by data-integrity-guardian agent |

## Resources

- PR: N/A (uncommitted changes on main)
- Rust Drop documentation: https://doc.rust-lang.org/std/ops/trait.Drop.html
