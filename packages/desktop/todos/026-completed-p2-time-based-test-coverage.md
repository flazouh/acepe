---
status: completed
priority: p2
issue_id: "026"
tags: [code-review, rust, streaming-batcher, testing]
dependencies: []
---

# Missing Time-Based Test Coverage

## Problem Statement

The `StreamingDeltaBatcher` tests verify buffering and manual flushing, but no test verifies that deltas are automatically emitted after 16ms passes. The time-based emission is a core behavior that is untested.

## Findings

### Pattern Recognition Specialist Analysis

- **Current Tests:**
  1. `buffers_rapid_deltas` - Tests immediate buffering
  2. `flush_all_returns_accumulated` - Tests manual flush
  3. `non_delta_updates_pass_through` - Tests pass-through
  4. `flushes_pending_before_status_update` - Tests ordering

- **Missing Tests:**
  - Time-based automatic emission after 16ms
  - Multiple tool calls interleaved
  - Empty delta strings
  - Session ID handling when None
  - Buffer behavior at exact 16ms boundary

### Data Integrity Guardian Analysis

- Time-based batching is the core feature but untested
- Edge case: What if no deltas arrive after T=15ms? Buffered data sits indefinitely

## Proposed Solutions

### Solution A: Sleep-Based Test (Simple)

**Approach:** Use std::thread::sleep to test timing

```rust
#[test]
fn emits_after_batch_interval() {
    let mut batcher = StreamingDeltaBatcher::new();

    // First delta - buffered
    let result = batcher.process(make_delta_update("tool-1", "hello"));
    assert!(result.is_empty());

    // Wait for batch interval
    std::thread::sleep(Duration::from_millis(20));

    // Next delta should trigger emission
    let result = batcher.process(make_delta_update("tool-1", " world"));
    assert_eq!(result.len(), 1);

    if let SessionUpdate::ToolCallUpdate { update, .. } = &result[0] {
        assert_eq!(update.streaming_input_delta.as_deref(), Some("hello world"));
    }
}
```

| Pros                | Cons             |
| ------------------- | ---------------- |
| Simple to implement | Slow (20ms wait) |
| Tests actual timing | Flaky on slow CI |
| No dependencies     |                  |

**Effort:** Small
**Risk:** Low (may be flaky)

### Solution B: Mockable Clock (Robust)

**Approach:** Abstract Instant::now() for testing

```rust
trait Clock {
    fn now(&self) -> Instant;
}

struct RealClock;
impl Clock for RealClock {
    fn now(&self) -> Instant { Instant::now() }
}

struct MockClock(AtomicU64);
impl Clock for MockClock {
    fn now(&self) -> Instant { /* return controlled time */ }
}
```

| Pros                          | Cons                             |
| ----------------------------- | -------------------------------- |
| Fast, reliable tests          | More complex implementation      |
| No flakiness                  | Requires trait injection         |
| Can test edge cases precisely | Over-engineering for simple case |

**Effort:** Medium
**Risk:** Low

## Recommended Action

Start with Solution A (sleep-based test) for quick coverage, consider Solution B if flakiness is an issue.

## Technical Details

**Affected Files:**

- `/packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs` (tests module)

**Additional Tests Needed:**

1. Time-based emission (primary)
2. Multiple concurrent tool calls
3. Empty delta handling
4. Session ID None edge case

## Acceptance Criteria

- [ ] Add test for time-based emission
- [ ] Add test for multiple concurrent tool calls
- [ ] Add test for empty delta strings
- [ ] All tests pass
- [ ] Rust compilation passes

## Work Log

| Date       | Action                   | Learnings                                          |
| ---------- | ------------------------ | -------------------------------------------------- |
| 2026-01-31 | Created from code review | Identified by pattern-recognition-specialist agent |

## Resources

- PR: N/A (uncommitted changes on main)
- Current tests: lines 150-280 in streaming_delta_batcher.rs
