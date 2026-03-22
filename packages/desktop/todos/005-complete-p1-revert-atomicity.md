---
status: complete
priority: p1
issue_id: "005"
tags: [code-review, data-integrity, checkpoint]
dependencies: []
---

# Revert Operations Lack Atomicity

## Problem Statement

The `revert_to_checkpoint` method performs file writes in a loop without any transactional guarantee. If the operation fails mid-way, some files will be reverted while others remain unchanged, leaving the filesystem in an inconsistent state with no automatic rollback mechanism.

This is a **CRITICAL data integrity issue** that could cause:

- Partial code states that don't compile
- Mixed versions of interdependent files
- User confusion about actual file states
- Data loss if the user doesn't notice the partial revert

## Findings

**Location:** `/packages/desktop/src-tauri/src/checkpoint/manager.rs` (lines 89-140)

```rust
for snapshot in snapshots {
    let content = CheckpointRepository::get_file_content(db, checkpoint_id, &snapshot.file_path)
        .await?
        .ok_or_else(|| anyhow::anyhow!("File content not found"))?;

    match Self::write_file(project_path, &snapshot.file_path, &content).await {
        Ok(()) => {
            reverted_files.push(snapshot.file_path);
        }
        Err(e) => {
            failed_files.push(RevertError::new(snapshot.file_path, e.to_string()));
        }
    }
}
```

**Data Corruption Scenario:**

1. User reverts to checkpoint #3 containing files A, B, C, D
2. Files A and B are successfully written
3. File C fails due to permissions/disk full
4. File D is never attempted
5. Filesystem now has files A/B from checkpoint #3, but files C/D from current state

## Proposed Solutions

### Solution A: Two-Phase Write with Temp Files (Recommended)

**Effort:** Medium (3-4 hours)
**Risk:** Low

```rust
async fn revert_to_checkpoint(...) -> Result<RevertResult> {
    let temp_dir = tempfile::tempdir()?;
    let mut temp_files = Vec::new();

    // Phase 1: Write all files to temp location
    for snapshot in snapshots {
        let content = get_content(...)?;
        let temp_path = temp_dir.path().join(&snapshot.file_path);
        tokio::fs::write(&temp_path, &content).await?;
        temp_files.push((temp_path, snapshot.file_path.clone()));
    }

    // Phase 2: Atomically move to final locations
    for (temp_path, final_path) in temp_files {
        let full_final = Path::new(project_path).join(&final_path);
        tokio::fs::rename(&temp_path, &full_final).await?;
    }

    Ok(RevertResult::success(reverted_files))
}
```

**Pros:** Atomic all-or-nothing behavior, easy rollback (just delete temp dir)
**Cons:** Uses temporary disk space, slightly more complex

### Solution B: Create Pre-Revert Checkpoint

**Effort:** Small (1-2 hours)
**Risk:** Low

Before any revert, automatically create a checkpoint of current state:

```rust
async fn revert_to_checkpoint(...) -> Result<RevertResult> {
    // Create safety checkpoint first
    Self::create_checkpoint(db, CreateCheckpointInput {
        session_id: session_id.to_string(),
        project_path: project_path.to_string(),
        modified_files: get_current_files(),
        is_auto: true,
        tool_call_id: Some("pre-revert-safety".to_string()),
    }).await?;

    // Proceed with revert...
}
```

**Pros:** Always recoverable, simple to implement
**Cons:** Doesn't prevent inconsistent state, just makes it recoverable

### Solution C: Fail-Fast on Any Error

**Effort:** Small (30 min)
**Risk:** Medium - may be frustrating for users

Change from continuing on error to aborting:

```rust
match Self::write_file(...).await {
    Ok(()) => reverted_files.push(...),
    Err(e) => return Err(anyhow::anyhow!("Revert aborted: {}", e)),
}
```

**Pros:** Simple, no partial state
**Cons:** Single file failure aborts everything, no partial recovery

## Recommended Action

_To be filled during triage_

## Technical Details

**Affected Files:**

- `packages/desktop/src-tauri/src/checkpoint/manager.rs`

**Database Changes:** None (Solution B may add a new checkpoint)

## Acceptance Criteria

- [x] Revert operation is atomic (all-or-nothing)
- [x] Failed reverts leave filesystem in known state
- [x] Users can recover from failed reverts
- [ ] Test covers partial failure scenario

## Work Log

| Date       | Action                   | Learnings                                                                                                                                                  |
| ---------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-01-31 | Created from code review | Data-integrity-guardian identified non-atomic file operations                                                                                              |
| 2026-01-31 | **FIXED**                | Implemented two-phase write: (1) write all to temp dir with validation, (2) if any fail abort, (3) copy all from temp to final. Temp auto-cleaned on drop. |

## Resources

- Data integrity review agent findings
