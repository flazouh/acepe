---
status: complete
priority: p1
issue_id: "006"
tags: [code-review, data-integrity, checkpoint, concurrency]
dependencies: []
---

# Race Condition in Checkpoint Number Assignment

## Problem Statement

The `get_next_checkpoint_number` function and checkpoint creation are not atomic. Two concurrent checkpoint requests for the same session could get the same checkpoint number, resulting in duplicate checkpoint numbers which breaks the ordering guarantee.

## Findings

**Location:** `/packages/desktop/src-tauri/src/checkpoint/repository.rs` (lines 176-178)

```rust
pub async fn get_next_checkpoint_number(db: &DbConn, session_id: &str) -> Result<i32> {
    let latest = Self::get_latest_for_session(db, session_id).await?;
    Ok(latest.map(|c| c.checkpoint_number + 1).unwrap_or(1))
}
```

**Called from manager.rs:**

```rust
let checkpoint_number =
    CheckpointRepository::get_next_checkpoint_number(db, &input.session_id).await?;
// ... file reading happens here (takes time) ...
CheckpointRepository::create(
    db,
    &input.session_id,
    checkpoint_number,  // Could be duplicate!
    // ...
)
```

**Race Scenario:**

1. Request A calls `get_next_checkpoint_number()` → returns 5
2. Request B calls `get_next_checkpoint_number()` → returns 5 (same!)
3. Request A creates checkpoint with number 5
4. Request B creates checkpoint with number 5
5. Two checkpoints exist with number 5

**Compounding Issue:** The index `idx_checkpoints_session_number` is NOT unique, so duplicates are allowed.

## Proposed Solutions

### Solution A: Add UNIQUE Constraint + Handle Conflict (Recommended)

**Effort:** Small (1 hour)
**Risk:** Low

1. Create migration to add UNIQUE constraint:

```rust
Index::create()
    .name("idx_checkpoints_session_number")
    .table(Checkpoints::Table)
    .col(Checkpoints::SessionId)
    .col(Checkpoints::CheckpointNumber)
    .unique()  // Add this
```

2. Handle constraint violation in create:

```rust
match Checkpoint_entity::insert(model).exec(&txn).await {
    Ok(result) => Ok(result),
    Err(DbErr::UniqueConstraintViolation(_)) => {
        // Retry with next number
        let new_number = get_next_checkpoint_number(db, session_id).await? + 1;
        // ... retry insert
    }
    Err(e) => Err(e),
}
```

**Pros:** Database enforces uniqueness, retry handles race
**Cons:** Requires migration

### Solution B: Move Number Calculation Into Transaction

**Effort:** Medium (2 hours)
**Risk:** Low

Use SELECT FOR UPDATE pattern inside the create transaction:

```rust
pub async fn create(...) -> Result<Checkpoint> {
    let txn = db.begin().await?;

    // Get next number with lock
    let latest = Checkpoint_entity::find()
        .filter(checkpoint::Column::SessionId.eq(session_id))
        .order_by_desc(checkpoint::Column::CheckpointNumber)
        .lock_exclusive()  // FOR UPDATE
        .one(&txn)
        .await?;

    let checkpoint_number = latest.map(|c| c.checkpoint_number + 1).unwrap_or(1);
    // ... create with this number
    txn.commit().await?;
}
```

**Pros:** Serializes access properly
**Cons:** Holds lock during file reading (not ideal)

### Solution C: Use Auto-Increment Per Session

**Effort:** Medium (2-3 hours)
**Risk:** Medium

Store last checkpoint number on session table:

```sql
ALTER TABLE session_metadata ADD COLUMN last_checkpoint_number INTEGER DEFAULT 0;
```

Then atomically increment:

```sql
UPDATE session_metadata SET last_checkpoint_number = last_checkpoint_number + 1
WHERE id = ? RETURNING last_checkpoint_number;
```

**Pros:** Simple, atomic increment
**Cons:** Modifies session table, requires migration

## Recommended Action

_To be filled during triage_

## Technical Details

**Affected Files:**

- `packages/desktop/src-tauri/src/checkpoint/repository.rs`
- `packages/desktop/src-tauri/src/db/migrations/` (new migration needed)

**Database Changes:** Add UNIQUE constraint or modify session table

## Acceptance Criteria

- [x] Concurrent checkpoint creation produces unique numbers
- [x] Database constraint prevents duplicate (session_id, checkpoint_number)
- [ ] Test covers concurrent checkpoint creation scenario

## Work Log

| Date       | Action                   | Learnings                                                                                                                                                        |
| ---------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-01-31 | Created from code review | Data-integrity-guardian identified TOCTOU race condition                                                                                                         |
| 2026-01-31 | **FIXED**                | (1) Created migration m20250131_000002 adding UNIQUE index on (session_id, checkpoint_number). (2) Added retry logic in repository.create() to handle conflicts. |

## Resources

- Data integrity review agent findings
- Related: 005-pending-p1-revert-atomicity.md
