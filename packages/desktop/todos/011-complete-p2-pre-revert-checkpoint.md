---
status: complete
priority: p2
issue_id: "011"
tags: [code-review, data-integrity, checkpoint, ux]
dependencies: []
---

# No Pre-Revert State Capture

## Problem Statement

When reverting to a checkpoint, the current state of files is not captured. If a user accidentally reverts and loses recent work, there is no way to recover.

## Findings

**Location:** `/packages/desktop/src-tauri/src/checkpoint/manager.rs` (lines 89-140)

The `revert_to_checkpoint` method directly writes files without creating a safety checkpoint first.

**Data Loss Scenario:**

1. User accidentally clicks "revert to checkpoint #1" instead of "#5"
2. All changes from checkpoints #2-5 plus any uncommitted changes are permanently lost
3. No recovery mechanism exists

## Proposed Solutions

### Solution A: Auto-Create Pre-Revert Checkpoint (Recommended)

**Effort:** Small (1 hour)
**Risk:** Low

```rust
pub async fn revert_to_checkpoint(...) -> Result<RevertResult> {
    // Create safety checkpoint of current state first
    let modified_files = snapshots.iter()
        .map(|s| s.file_path.clone())
        .collect();

    Self::create_checkpoint(db, CreateCheckpointInput {
        session_id: session_id.to_string(),
        project_path: project_path.to_string(),
        modified_files,
        is_auto: true,
        tool_call_id: Some("pre-revert-safety".to_string()),
    }).await?;

    // Proceed with revert...
}
```

**Pros:** Always recoverable, automatic safety net
**Cons:** Creates extra checkpoints (minimal storage impact)

### Solution B: Confirmation Dialog with Warning

**Effort:** Small (30 min)
**Risk:** Low

Frontend shows explicit warning before revert:
"This will overwrite current file state. Create backup first?"

**Pros:** User control
**Cons:** Can be dismissed, doesn't prevent accidents

## Recommended Action

_To be filled during triage_

## Technical Details

**Affected Files:**

- `packages/desktop/src-tauri/src/checkpoint/manager.rs`

**Database Changes:** None (just creates additional checkpoint)

## Acceptance Criteria

- [x] Revert operations create pre-revert checkpoint
- [x] User can recover from accidental revert
- [x] Pre-revert checkpoints are labeled appropriately

## Work Log

| Date       | Action                   | Learnings                                                                                                                                  |
| ---------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-01-31 | Created from code review | Data-integrity-guardian identified recovery gap                                                                                            |
| 2026-01-31 | **FIXED**                | Added automatic pre-revert checkpoint creation before revert, named "Before revert to checkpoint #N" with tool_call_id "pre-revert-safety" |

## Resources

- Data integrity review agent findings
