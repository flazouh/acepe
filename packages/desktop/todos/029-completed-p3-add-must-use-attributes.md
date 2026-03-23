---
status: completed
priority: p3
issue_id: "029"
tags: [code-review, rust, streaming-batcher, code-quality]
dependencies: []
---

# Add #[must_use] Attributes

## Problem Statement

The `process()` and `flush_all()` methods return `Vec<SessionUpdate>` that should always be consumed. Without `#[must_use]`, callers could accidentally discard the return value, causing silent data loss.

## Findings

### Pattern Recognition Specialist Analysis

- **Location:** `/packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs`
- **Methods:**
  - `process()` - returns Vec that must be emitted
  - `flush_all()` - returns Vec that must be emitted
- **Issue:** No compiler warning if return value is discarded

## Proposed Solutions

### Solution A: Add #[must_use] (Recommended)

**Approach:** Add attribute to methods

```rust
#[must_use = "updates must be emitted to the frontend"]
pub fn process(&mut self, update: SessionUpdate) -> Vec<SessionUpdate>

#[must_use = "flushed updates must be emitted to the frontend"]
pub fn flush_all(&mut self) -> Vec<SessionUpdate>
```

| Pros                        | Cons |
| --------------------------- | ---- |
| Compiler warning on discard | None |
| Documents intent            |      |
| Prevents bugs               |      |

**Effort:** Trivial
**Risk:** None

## Recommended Action

Add `#[must_use]` to both methods.

## Technical Details

**Affected Files:**

- `/packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs`

## Acceptance Criteria

- [ ] Add #[must_use] to process()
- [ ] Add #[must_use] to flush_all()
- [ ] Rust compilation passes
- [ ] No unused result warnings in existing code

## Work Log

| Date       | Action                   | Learnings                                          |
| ---------- | ------------------------ | -------------------------------------------------- |
| 2026-01-31 | Created from code review | Identified by pattern-recognition-specialist agent |

## Resources

- PR: N/A (uncommitted changes on main)
- Rust #[must_use]: https://doc.rust-lang.org/reference/attributes/diagnostics.html#the-must_use-attribute
