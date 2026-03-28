# Minimal Actions Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the current `actions/checkout@v4` Node 20 deprecation warning with the smallest safe workflow change and fix the Linux backend dead-code failure for `trim_trailing_separators`.

**Architecture:** Keep workflow behavior unchanged except for the `actions/checkout` version bump, and fix the backend by aligning Rust `cfg` compilation with actual platform usage. Do not broaden the modernization scope beyond the currently observed warning and the current Linux backend blocker.

**Tech Stack:** GitHub Actions workflows, Rust/Tauri, Cargo check/clippy/test

---

### Task 1: Minimal GitHub Actions modernization

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/release-claude-acp.yml`

- [ ] **Step 1: Update `actions/checkout` in CI workflow**

Replace the checkout step in `.github/workflows/ci.yml` from:

```yml
- uses: actions/checkout@v4
```

to:

```yml
- uses: actions/checkout@v5
```

- [ ] **Step 2: Update `actions/checkout` in release workflow**

Replace the checkout step in `.github/workflows/release.yml` from:

```yml
- uses: actions/checkout@v4
```

to:

```yml
- uses: actions/checkout@v5
```

- [ ] **Step 3: Update `actions/checkout` in release-claude-acp workflow**

Replace the checkout step in `.github/workflows/release-claude-acp.yml` from:

```yml
- uses: actions/checkout@v4
```

to:

```yml
- uses: actions/checkout@v5
```

- [ ] **Step 4: Review the workflow diff for unintended changes**

Run:

```bash
git diff -- .github/workflows/ci.yml .github/workflows/release.yml .github/workflows/release-claude-acp.yml
```

Expected: only `actions/checkout` version lines change from `v4` to `v5`

- [ ] **Step 5: Commit the workflow modernization**

```bash
git add .github/workflows/ci.yml .github/workflows/release.yml .github/workflows/release-claude-acp.yml
git commit -m "ci: update checkout action for node 24 compatibility"
```

### Task 2: Fix Linux dead-code failure in path safety helper

**Files:**
- Modify: `packages/desktop/src-tauri/src/path_safety.rs`
- Test: `packages/desktop/src-tauri/src/path_safety.rs`

- [ ] **Step 1: Make `trim_trailing_separators` macOS-only**

Update the helper declaration in `packages/desktop/src-tauri/src/path_safety.rs` from:

```rust
#[cfg(any(target_os = "macos", test))]
fn trim_trailing_separators(path: &Path) -> PathBuf {
```

to:

```rust
#[cfg(target_os = "macos")]
fn trim_trailing_separators(path: &Path) -> PathBuf {
```

This keeps the helper compiled only where it is actually used.

- [ ] **Step 2: Verify macOS-only lexical tests stay macOS-gated**

Confirm the lexical tests in the same file remain behind macOS cfgs:

```rust
#[cfg(target_os = "macos")]
#[test]
fn lexical_classifier_flags_root_and_home_without_fs_access() {
```

Expected: no Linux-only reference path to `trim_trailing_separators` remains.

- [ ] **Step 3: Run backend check**

Run:

```bash
cd packages/desktop/src-tauri && cargo check --all-targets
```

Expected: exit code `0`

- [ ] **Step 4: Run backend clippy**

Run:

```bash
cd packages/desktop/src-tauri && cargo clippy --all-targets -- -D warnings
```

Expected: exit code `0`

- [ ] **Step 5: Run backend tests**

Run:

```bash
cd packages/desktop/src-tauri && cargo test -- --skip claude_history::export_types
```

Expected: exit code `0`

- [ ] **Step 6: Commit the backend fix**

```bash
git add packages/desktop/src-tauri/src/path_safety.rs
git commit -m "fix: gate path safety helper for linux builds"
```

### Task 3: Push and confirm CI outcome

**Files:**
- Modify: none

- [ ] **Step 1: Push the branch**

Run:

```bash
git push -u origin main
```

Expected: remote `main` updates successfully

- [ ] **Step 2: Inspect latest CI run**

Run:

```bash
gh run list --workflow CI --branch main --limit 3
```

Expected: newest run corresponds to the pushed commit

- [ ] **Step 3: Confirm frontend and backend results**

Run:

```bash
gh run view --log-failed
```

Expected: no backend dead-code failure for `trim_trailing_separators`, and the Node 20 warning no longer points to `actions/checkout@v4`

- [ ] **Step 4: If CI is green, prepare release follow-up**

Run:

```bash
git log --oneline -3
```

Expected: latest commits show the workflow modernization and backend fix, ready for the next `v*` tag
