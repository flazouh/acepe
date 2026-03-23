---
status: complete
priority: p1
issue_id: "004"
tags: [code-review, security, checkpoint]
dependencies: []
---

# Path Traversal Vulnerability in File Operations

## Problem Statement

The checkpoint manager's `write_file` and file reading operations join `project_path` and `relative_path` without validating that the resulting path remains within the project directory. An attacker could supply a `relative_path` containing `../` sequences to read or write files anywhere on the filesystem.

This is a **CRITICAL security vulnerability** that could allow:

- Reading sensitive files (SSH keys, credentials, system files)
- Writing malicious files to arbitrary locations
- Privilege escalation through file system manipulation

## Findings

**Location:** `/packages/desktop/src-tauri/src/checkpoint/manager.rs`

**Write Path Traversal (lines 241-257):**

```rust
async fn write_file(project_path: &str, relative_path: &str, content: &str) -> Result<()> {
    let full_path = Path::new(project_path).join(relative_path);  // No validation!
    // ...writes to arbitrary location
}
```

**Read Path Traversal (lines 40-64):**

```rust
for relative_path in &input.modified_files {
    let full_path = Path::new(&input.project_path).join(relative_path);  // No validation!
    // ...reads from arbitrary location
}
```

**Comparison:** The `acp_read_text_file` function in `src/acp/commands.rs:572-590` properly canonicalizes paths and validates they are absolute. This protection is missing in the checkpoint module.

## Proposed Solutions

### Solution A: Validate and Canonicalize Paths (Recommended)

**Effort:** Small (1-2 hours)
**Risk:** Low

Add validation function:

```rust
fn validate_relative_path(project_path: &str, relative_path: &str) -> Result<PathBuf> {
    // Reject paths with suspicious patterns
    if relative_path.contains("..") || relative_path.starts_with('/') {
        return Err(anyhow::anyhow!("Invalid relative path: {}", relative_path));
    }

    let full_path = Path::new(project_path).join(relative_path);
    let canonical = full_path.canonicalize()
        .with_context(|| format!("Cannot access path: {}", full_path.display()))?;

    let project_canonical = Path::new(project_path).canonicalize()
        .with_context(|| format!("Cannot access project: {}", project_path))?;

    if !canonical.starts_with(&project_canonical) {
        return Err(anyhow::anyhow!("Path escapes project directory: {}", relative_path));
    }

    Ok(canonical)
}
```

**Pros:** Direct fix, reusable validation
**Cons:** None significant

### Solution B: Use Allowlist of Safe Characters

**Effort:** Small
**Risk:** Medium - may be too restrictive

Only allow alphanumeric, `/`, `.`, `-`, `_` in paths.

**Pros:** Very restrictive
**Cons:** May break legitimate paths with special characters

## Recommended Action

_To be filled during triage_

## Technical Details

**Affected Files:**

- `packages/desktop/src-tauri/src/checkpoint/manager.rs` (lines 40-64, 241-257)
- `packages/desktop/src-tauri/src/checkpoint/commands.rs` (all commands accepting paths)

**Database Changes:** None

## Acceptance Criteria

- [x] All file paths are validated before use
- [x] Paths containing `..` are rejected
- [x] Canonicalized paths must start with project path
- [x] Unit tests cover path traversal attempts
- [ ] Integration test verifies rejection of malicious paths

## Work Log

| Date       | Action                   | Learnings                                                                                                                                                                                   |
| ---------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-01-31 | Created from code review | Security-sentinel identified missing validation compared to acp_read_text_file                                                                                                              |
| 2026-01-31 | **FIXED**                | Added `validate_relative_path()` in manager.rs that: (1) rejects paths with `..`, (2) rejects absolute paths, (3) canonicalizes and verifies paths stay within project. Added 3 unit tests. |

## Resources

- Security review agent findings
- Compare with: `src/acp/commands.rs:572-590` (proper validation example)
