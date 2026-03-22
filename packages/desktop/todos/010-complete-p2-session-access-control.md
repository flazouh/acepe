---
status: complete
priority: p2
issue_id: "010"
tags: [code-review, security, checkpoint]
dependencies: []
---

# Missing Session Access Control for Checkpoints

## Problem Statement

Checkpoint commands accept any `checkpoint_id` without verifying the caller has access to the associated session. While UUID guessing is difficult, this is a defense-in-depth violation.

## Findings

**Location:** `/packages/desktop/src-tauri/src/checkpoint/commands.rs` (lines 57-74)

```rust
pub async fn checkpoint_get_file_content(
    db: State<'_, DbConn>,
    checkpoint_id: String,  // No session ownership verification
    file_path: String,
) -> Result<String, String> {
    CheckpointManager::get_file_content_at_checkpoint(&db, &checkpoint_id, &file_path)
        .await
        .map_err(|e| e.to_string())
}
```

**Same issue in:**

- `checkpoint_revert` (lines 77-93)
- `checkpoint_revert_file` (lines 95-114)

## Proposed Solutions

### Solution A: Add Session Verification to Commands (Recommended)

**Effort:** Small (1 hour)
**Risk:** Low

```rust
async fn verify_checkpoint_ownership(
    db: &DbConn,
    checkpoint_id: &str,
    session_id: &str,
) -> Result<(), String> {
    let checkpoint = CheckpointRepository::get_by_id(db, checkpoint_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Checkpoint not found".to_string())?;

    if checkpoint.session_id != session_id {
        return Err("Access denied".to_string());
    }
    Ok(())
}
```

Then require session_id parameter in commands:

```rust
pub async fn checkpoint_get_file_content(
    db: State<'_, DbConn>,
    session_id: String,      // Add this
    checkpoint_id: String,
    file_path: String,
) -> Result<String, String> {
    verify_checkpoint_ownership(&db, &checkpoint_id, &session_id).await?;
    // ...
}
```

**Pros:** Explicit access control, audit trail
**Cons:** Requires frontend to pass session_id

## Recommended Action

_To be filled during triage_

## Technical Details

**Affected Files:**

- `packages/desktop/src-tauri/src/checkpoint/commands.rs`
- `packages/desktop/src/lib/utils/tauri-client.ts`

**Database Changes:** None

## Acceptance Criteria

- [x] All checkpoint commands verify session ownership
- [x] Access denied error returned for wrong session
- [x] Frontend passes session_id to commands

## Work Log

| Date       | Action                   | Learnings                                                                                                       |
| ---------- | ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| 2026-01-31 | Created from code review | Security-sentinel identified missing access control                                                             |
| 2026-01-31 | **FIXED**                | Added verify_checkpoint_ownership() to commands.rs, updated tauri-client and checkpoint-store to pass sessionId |

## Resources

- Security review agent findings
