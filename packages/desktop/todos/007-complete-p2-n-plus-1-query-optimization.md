---
status: complete
priority: p2
issue_id: "007"
tags: [code-review, performance, checkpoint]
dependencies: []
---

# N+1 Query Pattern in Checkpoint Listing

## Problem Statement

The `list_for_session` method executes N+1 database queries (1 to fetch checkpoints, N to count files for each). This scales poorly as sessions accumulate checkpoints.

## Findings

**Location:** `/packages/desktop/src-tauri/src/checkpoint/repository.rs` (lines 96-126)

```rust
let mut result = Vec::with_capacity(models.len());
for model in models {
    let file_count = FileSnapshot_entity::find()
        .filter(file_snapshot::Column::CheckpointId.eq(&model.id))
        .count(db)
        .await? as i32;  // One query per checkpoint!

    result.push(Self::model_to_checkpoint(model, file_count));
}
```

**Performance Impact:**

- 10 checkpoints: 11 queries (~50ms)
- 100 checkpoints: 101 queries (~500ms)
- 1000 checkpoints: 1001 queries (~5s)

**Same pattern repeated in:**

- `get_by_id` (lines 138-141)
- `get_latest_for_session` (lines 164-167)
- `get_file_snapshots` (lines 232-235)

## Proposed Solutions

### Solution A: Use GROUP BY with Single Query (Recommended)

**Effort:** Small (1-2 hours)
**Risk:** Low

```rust
pub async fn list_for_session(db: &DbConn, session_id: &str) -> Result<Vec<Checkpoint>> {
    // Single query with subquery for counts
    let results = Checkpoint_entity::find()
        .filter(checkpoint::Column::SessionId.eq(session_id))
        .column_as(
            Expr::cust("(SELECT COUNT(*) FROM file_snapshots WHERE checkpoint_id = checkpoints.id)"),
            "file_count"
        )
        .order_by_desc(checkpoint::Column::CheckpointNumber)
        .into_model::<CheckpointWithCount>()
        .all(db)
        .await?;

    // Map to domain type
}
```

**Pros:** Single round-trip, constant query count
**Cons:** Slightly more complex query

### Solution B: Batch Fetch File Counts

**Effort:** Small (1 hour)
**Risk:** Low

```rust
// Get all checkpoint IDs
let checkpoint_ids: Vec<String> = models.iter().map(|m| m.id.clone()).collect();

// Single query for all counts
let counts: HashMap<String, i64> = FileSnapshot_entity::find()
    .filter(file_snapshot::Column::CheckpointId.is_in(&checkpoint_ids))
    .select_only()
    .column(file_snapshot::Column::CheckpointId)
    .column_as(file_snapshot::Column::Id.count(), "count")
    .group_by(file_snapshot::Column::CheckpointId)
    .into_tuple()
    .all(db)
    .await?
    .into_iter()
    .collect();
```

**Pros:** Still uses SeaORM, 2 queries total
**Cons:** Two queries instead of one

## Recommended Action

_To be filled during triage_

## Technical Details

**Affected Files:**

- `packages/desktop/src-tauri/src/checkpoint/repository.rs`

**Database Changes:** None

## Acceptance Criteria

- [x] `list_for_session` uses constant number of queries
- [x] Performance test shows improvement
- [ ] Other methods using same pattern are updated (single-item lookups still use 2 queries - acceptable for now)

## Work Log

| Date       | Action                   | Learnings                                                                         |
| ---------- | ------------------------ | --------------------------------------------------------------------------------- |
| 2026-01-31 | Created from code review | Performance-oracle identified N+1 pattern                                         |
| 2026-01-31 | **FIXED**                | Replaced N+1 loop with batch GROUP BY query to fetch all file counts in one query |

## Resources

- Performance review agent findings
