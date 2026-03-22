---
status: complete
priority: p2
issue_id: "009"
tags: [code-review, performance, checkpoint]
dependencies: []
---

# Sequential Database Inserts for File Snapshots

## Problem Statement

Each file snapshot is inserted individually in a loop, causing N round-trips to the database. Batch insertion would be significantly faster.

## Findings

**Location:** `/packages/desktop/src-tauri/src/checkpoint/repository.rs` (lines 56-71)

```rust
for (file_path, content_hash, content, file_size) in file_snapshots {
    let snapshot_id = Uuid::new_v4().to_string();
    let snapshot_model = file_snapshot::ActiveModel { ... };
    FileSnapshot_entity::insert(snapshot_model)
        .exec(&txn)
        .await?;  // One insert per file!
}
```

**Performance Impact:**

- 10 files: ~50ms
- 100 files: ~500ms
- 500 files: ~2.5s

## Proposed Solutions

### Solution A: Use insert_many (Recommended)

**Effort:** Small (30 min)
**Risk:** Low

```rust
let snapshot_models: Vec<file_snapshot::ActiveModel> = file_snapshots
    .into_iter()
    .map(|(file_path, content_hash, content, file_size)| {
        file_snapshot::ActiveModel {
            id: Set(Uuid::new_v4().to_string()),
            checkpoint_id: Set(checkpoint_id.clone()),
            file_path: Set(file_path),
            content_hash: Set(content_hash),
            content: Set(content),
            file_size: Set(file_size),
        }
    })
    .collect();

FileSnapshot_entity::insert_many(snapshot_models)
    .exec(&txn)
    .await?;
```

**Pros:** Single database round-trip, simple change
**Cons:** None significant

## Recommended Action

_To be filled during triage_

## Technical Details

**Affected Files:**

- `packages/desktop/src-tauri/src/checkpoint/repository.rs`

**Database Changes:** None

## Acceptance Criteria

- [x] File snapshots inserted in single batch
- [x] Transaction still commits atomically
- [x] Performance improves for large checkpoints

## Work Log

| Date       | Action                   | Learnings                                                                      |
| ---------- | ------------------------ | ------------------------------------------------------------------------------ |
| 2026-01-31 | Created from code review | Performance-oracle identified sequential insert pattern                        |
| 2026-01-31 | **FIXED**                | Replaced loop with insert_many() for single batch insert of all file snapshots |

## Resources

- Performance review agent findings
- SeaORM insert_many documentation
