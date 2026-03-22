---
status: complete
priority: p1
issue_id: "031"
tags: [code-review, rust, data-integrity, streaming, dead-code]
dependencies: []
---

# Data Loss on Stale Buffer Cleanup

## Problem Statement

The `cleanup_stale()` method in the streaming delta batcher removes buffers older than 60 seconds, but **silently discards their accumulated data** without emitting it first. This is a data loss bug waiting to happen when the method gets wired up.

**Why it matters:** Currently `cleanup_stale()` is dead code (never called), but if it gets activated, users would lose data for any streaming operations that stall for 60+ seconds then resume.

## Findings

### Location

`/packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs:401-435`

### Current Behavior

```rust
pub fn cleanup_stale(&mut self) -> usize {
    let now = Instant::now();
    let stale_deltas: Vec<_> = self.delta_buffers
        .iter()
        .filter(|(_, buf)| now.duration_since(buf.last_accessed) > STALE_BUFFER_TIMEOUT)
        .map(|(k, _)| k.clone())
        .collect();

    for key in stale_deltas {
        tracing::warn!(tool_call_id = %key, "Removing stale delta buffer");
        self.delta_buffers.remove(&key);  // DATA LOST - accumulated content dropped
        count += 1;
    }
    // Same pattern for message_buffers...
}
```

### Root Cause

The method removes stale buffers without emitting their content. The 60-second timeout (`STALE_BUFFER_TIMEOUT`) assumes that stale buffers contain abandoned/incomplete data, but this isn't always true - a network stall or agent pause could cause temporary inactivity.

### Current Status

- `cleanup_stale()` is **never called** in the codebase (verified via grep)
- The method is effectively dead code
- If wired up without fixing, would cause silent data loss

## Proposed Solutions

### Option A: Emit Before Cleanup (Recommended if keeping)

Modify `cleanup_stale()` to emit buffer content before removal.

```rust
pub fn cleanup_stale(&mut self) -> Vec<SessionUpdate> {
    let mut results = Vec::new();
    let now = Instant::now();

    let stale_delta_keys: Vec<_> = self.delta_buffers
        .iter()
        .filter(|(_, buf)| now.duration_since(buf.last_accessed) > STALE_BUFFER_TIMEOUT)
        .map(|(k, _)| k.clone())
        .collect();

    for key in stale_delta_keys {
        tracing::warn!(tool_call_id = %key, "Emitting and removing stale delta buffer");
        results.extend(self.emit_tool_delta(&key));  // Emit before removal
    }
    // Same for message buffers...
    results
}
```

**Pros:** Preserves data, method becomes safe to wire up
**Cons:** Stale data may arrive unexpectedly late
**Effort:** Small
**Risk:** Low

### Option B: Remove Dead Code (Recommended if not needed)

Delete `cleanup_stale()`, `STALE_BUFFER_TIMEOUT`, and related timestamp fields since they're unused.

```rust
// Remove these:
const STALE_BUFFER_TIMEOUT: Duration = Duration::from_secs(60);
// Remove last_accessed field from buffers
// Remove cleanup_stale() method entirely
```

**Pros:** Eliminates dead code, reduces maintenance burden
**Cons:** Loses potential future cleanup capability
**Effort:** Small
**Risk:** Very low

### Option C: Wire Up With Timer + Emit

Keep `cleanup_stale()`, fix it to emit first, and wire it up on a periodic timer.

**Pros:** Prevents unbounded memory growth from abandoned streams
**Cons:** More complex, needs async timer integration
**Effort:** Medium
**Risk:** Low

## Recommended Action

**Option B** (Remove dead code) if stale cleanup is not needed for the current use case.
**Option A** (Emit before cleanup) if the feature will be wired up soon.

Given that `MAX_BUFFERS` already prevents unbounded growth via LRU eviction, the stale cleanup may be unnecessary. Recommend Option B unless there's a specific need for time-based cleanup.

## Technical Details

### Affected Files

- `packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs`

### Lines to Remove (Option B)

- Line 29-30: `STALE_BUFFER_TIMEOUT` constant
- Lines 41-42, 51-52: `last_accessed` fields in buffer structs
- Lines 401-435: `cleanup_stale()` method
- Lines 178, 226: `last_accessed` updates in buffer methods

### Test Coverage

- No tests currently cover `cleanup_stale()` (it's dead code)
- If keeping, add tests for emit-before-cleanup behavior

## Acceptance Criteria

**If Option A (keep and fix):**

- [ ] `cleanup_stale()` returns `Vec<SessionUpdate>` with emitted data
- [ ] Test verifies no data loss during stale cleanup
- [ ] Document when/how cleanup_stale should be called

**If Option B (remove):**

- [ ] `cleanup_stale()` method removed
- [ ] `STALE_BUFFER_TIMEOUT` constant removed
- [ ] `last_accessed` fields removed from buffer structs
- [ ] All tests pass after removal

## Work Log

| Date       | Action    | Notes                                                                                                                              |
| ---------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 2026-02-01 | Created   | Identified during code review - dead code with latent bug                                                                          |
| 2026-02-01 | Completed | Implemented Option B: Removed `cleanup_stale()` method and `STALE_BUFFER_TIMEOUT` constant. Kept `last_accessed` for LRU eviction. |

## Resources

- PR: Uncommitted changes on main
- File: `streaming_delta_batcher.rs:401-435`
- Related: #030 (LRU eviction data loss)
- Related: #024 (stale buffer cleanup - completed, but didn't address emit-before-drop)
