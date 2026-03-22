---
title: Eliminate ACP Debug/Release Skew by Using Bun Binary in Dev
type: refactor
date: 2026-02-28
---

# Eliminate ACP Debug/Release Skew by Using Bun Binary in Dev

## Overview

The debug build spawns `node dist/index.mjs` (an esbuild bundle checked into the repo). The release build spawns the Bun-compiled binary `dist/claude-agent-acp`. These follow different code paths, need different env var workarounds (`set_cli_js_env` / `CLAUDE_CODE_EXECUTABLE` only in debug), and can silently diverge when upstream `@zed-industries/claude-agent-acp` is updated.

**The fix:** Use the Bun binary in dev too. The drift problem disappears at its root — no checked-in `dist/index.mjs` to go stale, no `set_cli_js_env()` workaround, debug and release run identical code.

The comment at `claude_code.rs:66-67` says the Node.js path exists because "Bun-compiled binaries have issues with import.meta.url resolution and silent hangs." That bug was fixed in the `static-entry.ts` + `CLAUDE_AGENT_ACP_IS_SINGLE_FILE_BUN=true` refactor (2026-02-25). The release binary already works correctly. The guard is protecting against a bug that no longer exists.

---

## What Changes

### Before (Two Code Paths)

```
Debug:   node dist/index.mjs         (esbuild bundle, needs set_cli_js_env())
Release: dist/claude-agent-acp       (Bun binary, self-contained)
```

### After (One Code Path)

```
Debug:   dist/claude-agent-acp       (same Bun binary, found via relative paths)
Release: RESOURCE_DIR/.../claude-agent-acp  (bundled copy of same binary)
```

---

## What We Delete

| Thing | Why It Existed | Why Safe to Delete |
|---|---|---|
| `set_cli_js_env()` | esbuild bundle can't resolve `cli.js` via `import.meta.resolve` | Bun binary handles `--cli` routing internally via `static-entry.ts` |
| `CLAUDE_CODE_EXECUTABLE` env var injection | Same reason | Same reason |
| 3 static path checks for `dist/index.mjs` | Finding the Node.js bundle | Replaced with same paths targeting `dist/claude-agent-acp` |
| 5-level upward traversal for `index.mjs` | Fallback for unusual cwd | Same traversal, different filename |
| `dist/index.mjs` checked into repo | Debug path dependency | No longer used at runtime |

**What we keep:**
- `CLAUDE_CODE_ACP_PATH` env var — developers actively working on ACP TypeScript can point it at `node dist/index.mjs` manually for Node.js debugging
- `npx` / `bunx` / direct binary fallback chain — unchanged
- `build.mjs` — kept for anyone who still needs the Node.js bundle (tests, manual debugging)

---

## Implementation Plan

### Phase 1: Switch Debug Builds to Bun Binary

**Files to change:**
- `packages/desktop/src-tauri/src/acp/providers/claude_code.rs`

**Changes:**

1. **Remove the `#[cfg(not(debug_assertions))]` gate on `get_bundled_acp_path()`.** Both debug and release check for the bundled binary first. In debug it won't be at RESOURCE_DIR, so the check harmlessly falls through.

2. **Replace the debug static path resolution.** Change the 3 static paths and the traversal target from `dist/index.mjs` to `dist/claude-agent-acp`. Change the spawn from `command: "node", args: vec![path]` to `command: path, args: vec![]` (the binary is directly executable).

3. **Delete `set_cli_js_env()` entirely.** No caller remains.

4. **Keep `CLAUDE_CODE_ACP_PATH` with smart dispatch:**
   ```rust
   if local_path.ends_with(".mjs") || local_path.ends_with(".js") {
       // Developer explicitly wants Node.js path for debugging
       SpawnConfig { command: "node", args: vec![local_path], env }
   } else {
       // Binary path
       SpawnConfig { command: local_path, args: vec![], env }
   }
   ```

**Resulting `spawn_config()` flow:**

```
spawn_config():
  1. [any build] RESOURCE_DIR / "acps/claude/claude-agent-acp"  (release finds it, debug doesn't)
  2. CLAUDE_CODE_ACP_PATH env var  (smart: node if .mjs/.js, direct if binary)
  3. Static relative paths for dist/claude-agent-acp:
       ../acps/claude/dist/claude-agent-acp
       ../../acps/claude/dist/claude-agent-acp
       packages/acps/claude/dist/claude-agent-acp
  4. 5-level upward traversal for packages/acps/claude/dist/claude-agent-acp
  5. npx / bunx / claude-code-acp fallback
```

### Phase 2: Ensure Binary Exists During Dev Setup

**Problem:** `bun run build:binary` takes ~30-60 seconds. Developers need the binary before running `bun dev`.

**Files to change:**
- `packages/acps/claude/package.json`

**Change:** Add a `prepare` script so the binary is built automatically after `bun install`:

```json
"prepare": "bun run build:binary"
```

**Developer workflow:**
- `bun install` → binary is built (one-time ~30-60s cost, runs once)
- `bun dev` → Tauri finds `dist/claude-agent-acp`, spawns it directly
- Editing `packages/acps/claude/src/` → re-run `bun run build:binary` manually (same as today — rare)

### Phase 3: Clean Up Stale Artifacts

**Files to change:**
- `.gitignore` — add `packages/acps/claude/dist/` entries
- Remove `dist/index.mjs`, `dist/index.js`, `dist/index.cjs`, `dist/lib.cjs` from the repo

**Before deleting**, verify no other consumers:
- `package.json` has `"main": "dist/index.mjs"` — check if anything imports the package by name
- Test files that import from `dist/`
- CI scripts that reference `dist/index.mjs`

### Phase 4: CI Guard

Add a CI step that verifies the binary builds from current source:

```yaml
- name: Verify acps/claude binary builds
  run: |
    cd packages/acps/claude
    bun run build:binary
```

This catches TypeScript compilation failures before they reach users, without requiring a checked-in artifact.

---

## History Bridge (Future, Unchanged)

The history bridge discussion is orthogonal and remains blocked by:
- `unstable_` API stability in the upstream SDK
- Process lifecycle design (should piggyback on existing ACP JSON-RPC connection)
- Warm path guarantee (SQLite-first must never be bypassed)

The Rust JSONL parser is correct, fast, and has no replacement. No changes to the history path in this plan.

---

## Acceptance Criteria

- [x] `bun dev` + starting a Claude session spawns `dist/claude-agent-acp` (not `node dist/index.mjs`)
- [x] Release build behavior is unchanged
- [x] `CLAUDE_CODE_ACP_PATH=/path/to/index.mjs` still works for Node.js debugging
- [x] `set_cli_js_env()` and `CLAUDE_CODE_EXECUTABLE` injection are deleted
- [x] `bun install` in `packages/acps/claude/` produces a working binary automatically
- [x] `dist/index.mjs` was already gitignored and not tracked — no repo cleanup needed
- [ ] CI verifies the binary builds from source (N/A — no PR CI workflow exists yet)

## Risks

**Risk 1: Binary build time slows down `bun install`.**
~30-60s added to install via `prepare` script. Mitigation: runs once per install, not per `bun dev`. Can skip with `--ignore-scripts`.

**Risk 2: Binary doesn't exist on clone without install.**
If someone runs `bun dev` without `bun install`, the binary won't exist. Mitigation: fallback chain still has `npx`/`bunx`. Add a clear log message: "dist/claude-agent-acp not found — run bun install in packages/acps/claude/".

**Risk 3: `dist/index.mjs` is used by something we haven't found.**
Mitigation: grep the entire repo before deleting. Keep `build.mjs` so it can be regenerated on demand.

## Files To Change

| File | Change |
|---|---|
| `packages/desktop/src-tauri/src/acp/providers/claude_code.rs` | Switch debug to `dist/claude-agent-acp`; delete `set_cli_js_env()` |
| `packages/acps/claude/package.json` | Add `"prepare": "bun run build:binary"` |
| `.gitignore` | Add `packages/acps/claude/dist/` artifacts |
| `.github/workflows/*.yml` | Add binary build CI step |
| `packages/acps/claude/dist/index.mjs` | Delete from repo |

## References

- `packages/desktop/src-tauri/src/acp/providers/claude_code.rs:62-211` — current spawn_config()
- `packages/acps/claude/src/static-entry.ts` — --cli routing that makes CLAUDE_CODE_EXECUTABLE unnecessary
- `packages/acps/claude/build.mjs` — esbuild config (kept for manual Node.js debugging)
- `scripts/build/src/shared.ts` — buildACPs() release build step
- Memory: "Bun ACP Binary Silent Hang Fix (2026-02-25)" — the fix that made this plan possible
