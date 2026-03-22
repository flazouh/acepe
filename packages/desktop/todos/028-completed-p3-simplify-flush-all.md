---
status: completed
priority: p3
issue_id: "028"
tags: [code-review, rust, streaming-batcher, code-quality]
dependencies: []
---

# Simplify flush_all() Implementation

## Problem Statement

The `flush_all()` method collects keys first, then iterates to flush each. This causes double iteration and extra allocations.

## Findings

### Performance Oracle & Code Simplicity Analysis

- **Location:** `/packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs` lines 132-143
- **Current Code:**

  ```rust
  pub fn flush_all(&mut self) -> Vec<SessionUpdate> {
      let tool_call_ids: Vec<String> = self.buffers.keys().cloned().collect(); // Iteration 1 + allocations
      let mut updates = Vec::new();

      for tool_call_id in tool_call_ids {
          if let Some(update) = self.flush_one(&tool_call_id) { // Iteration 2 + HashMap lookups
              updates.push(update);
          }
      }

      updates
  }
  ```

- **Issue:** Double iteration and intermediate Vec allocation

## Proposed Solutions

### Solution A: Use drain() (Recommended)

**Approach:** Use HashMap::drain() to avoid double iteration

```rust
pub fn flush_all(&mut self) -> Vec<SessionUpdate> {
    self.buffers
        .drain()
        .filter(|(_, buffer)| !buffer.accumulated.is_empty())
        .map(|(tool_call_id, buffer)| SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id,
                status: None,
                result: None,
                content: None,
                raw_output: None,
                title: None,
                locations: None,
                streaming_input_delta: Some(buffer.accumulated),
                normalized_todos: None,
                normalized_questions: None,
            },
            session_id: Some(buffer.session_id),
        })
        .collect()
}
```

| Pros                       | Cons                                       |
| -------------------------- | ------------------------------------------ |
| Single iteration           | Slightly longer                            |
| No intermediate allocation | Duplicates ToolCallUpdateData construction |
| More idiomatic Rust        |                                            |

**Effort:** Small
**Risk:** None

## Recommended Action

Refactor to use drain() for cleaner, more efficient implementation.

## Technical Details

**Affected Files:**

- `/packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs` lines 132-143

## Acceptance Criteria

- [ ] Refactor flush_all() to use drain()
- [ ] Rust compilation passes
- [ ] Existing tests still pass

## Work Log

| Date       | Action                   | Learnings                                                            |
| ---------- | ------------------------ | -------------------------------------------------------------------- |
| 2026-01-31 | Created from code review | Identified by performance-oracle and code-simplicity-reviewer agents |

## Resources

- PR: N/A (uncommitted changes on main)
