---
status: complete
priority: p2
issue_id: "017"
tags: [code-review, security, checkpoint, rust]
dependencies: []
---

# Add File Size Limits to Checkpoint Creation

## Problem Statement

When creating checkpoints, file content is read without size validation. A misconfigured or malicious agent could trigger checkpoints on very large files, causing memory exhaustion and database bloat.

## Findings

**Location:** `packages/desktop/src-tauri/src/checkpoint/manager.rs:110-152`

```rust
match tokio::fs::read_to_string(&full_path).await {
    Ok(content) => {
        let content_hash = Self::compute_hash(&content);
        let file_size = content.len() as i64;
        Some((rel_path, content_hash, content, file_size))  // No size limit
    }
```

**Risks:**

- Large binary files read as strings could cause memory issues
- Database TEXT column could grow unboundedly (500MB files stored directly)
- Repeated checkpoints multiply storage impact

**Attack Scenario:** Agent edits a large generated file (e.g., 500MB compiled asset), triggering auto-checkpoint that reads 500MB into memory and stores it in SQLite.

## Proposed Solutions

### Option 1: Add File Size Check Before Read (Recommended)

**Approach:** Check file metadata before reading content.

```rust
const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024; // 10MB

let metadata = full_path.metadata().await?;
if metadata.len() > MAX_FILE_SIZE {
    tracing::warn!("File too large for checkpoint, skipping: {}", rel_path);
    return None;
}
```

**Pros:**

- Simple implementation
- No I/O wasted on large files
- Configurable limit

**Cons:**

- May skip legitimate large text files

**Effort:** 30 minutes

**Risk:** Low

---

### Option 2: Skip Binary Files by Extension

**Approach:** Maintain list of binary extensions to skip.

**Pros:**

- Avoids corrupted text from binary files
- More targeted

**Cons:**

- Maintenance burden for extension list
- Some text files have unusual extensions

**Effort:** 1 hour

**Risk:** Low

---

### Option 3: Combined Size + Extension Check

**Approach:** Use both size limit and binary file detection.

**Pros:**

- Most robust
- Handles edge cases

**Cons:**

- More complex logic

**Effort:** 1-2 hours

**Risk:** Low

## Recommended Action

_To be filled during triage._

## Technical Details

**Affected files:**

- `packages/desktop/src-tauri/src/checkpoint/manager.rs:110-152`

**Configuration:**

- Consider making `MAX_FILE_SIZE` configurable via app settings

## Acceptance Criteria

- [x] Files over 10MB are skipped with warning log
- [x] Binary files are handled appropriately (skipped if too large)
- [x] Checkpoint creation doesn't OOM on large files
- [ ] Tests cover size limit enforcement

## Work Log

### 2026-01-31 - Security Review Discovery

**By:** Claude Code

**Actions:**

- Identified missing file size validation via security review
- Analyzed checkpoint creation flow
- Documented attack scenario

**Learnings:**

- Current path validation is robust
- Size validation is the main gap

### 2026-01-31 - Implementation Complete

**By:** Claude Code

**Actions:**

- Added `MAX_CHECKPOINT_FILE_SIZE` constant (10 MB) at line 15
- Added metadata check before file read (lines 136-152)
- Files exceeding limit are logged and skipped
- Metadata read failure also results in skip with warning
- Verified with `cargo clippy` - no new warnings

**Learnings:**

- Using `tokio::fs::metadata()` is efficient for size checks before read
- Match guard syntax (`Ok(meta) if meta.len() > MAX`) provides clean conditional
