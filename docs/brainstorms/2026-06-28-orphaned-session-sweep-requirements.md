# Orphaned Transcript-less Session Sweep — Requirements

**Date:** 2026-06-28
**Status:** Requirements (pre-plan)
**Scope:** Standard (session lifecycle / persistence — GOD-relevant)

## Problem

Deferred Claude sessions whose **first turn is interrupted before the agent writes a transcript** are left as orphaned shells: a `session_metadata` row with `file_path = "__session_registry__/<id>"` and `file_size = 0`, and no JSONL transcript. Because the sidebar title (`display`) is derived by the backend from the first user message in the transcript (`history/title_utils.rs`, which returns `None` for empty text), these fall back to `"Session <hex>"` and clutter session history after a reload.

### Evidence (live dev DB, `acepe_dev.db`)

- **100% correlation:** all 12 untitled `"Session <hex>"` Claude sessions are 0-byte `__session_registry__` placeholders; all 111 titled sessions have real transcripts. No exceptions either direction.
- Root cause observed during heavy QA: the app reloaded mid-first-turn (HMR/rebuild churn from a concurrent session) plus a disk-full episode, killing the Claude turn before the CLI wrote its transcript.

### Not caused by the optimistic-header work

The just-shipped optimistic header (title + working spark from t=0) is a **live-only projection** that intentionally persists nothing. Persistence depends on the turn writing a transcript, which the backend later scans for the title. This requirement is a **separate, pre-existing robustness gap** and must not regress the live optimistic behavior.

## Decision

**Sweep dead orphans.** On scan, a registry-placeholder session that is dead is removed from history.

- **Orphan signal (safe, no timer):** a session is a dead orphan when ALL hold:
  1. it is a registry placeholder (`file_path` starts with `__session_registry__/`, per the existing `is_registry` concept in `src-tauri/src/db/repository/session_metadata.rs`), and
  2. it has **no transcript** (no backing JSONL / `file_size = 0`), and
  3. it has **no live/active runtime** (no in-memory session being created/streamed for that id).
- **Action:** **hard-delete** the orphan's `session_metadata` row. A 0-byte placeholder carries no transcript or data to lose, and deletion prevents invisible DB bloat. Deletion is a clean Rust-side operation on the canonical store.
- **When:** evaluated during the session scan (startup / refresh) — the moment orphans become visible. After a reload there are no live runtimes from the previous process, so every transcript-less placeholder is by definition dead.

### Why not the alternatives

- **Defer persistence** (don't write the row until first transcript bytes): risks crash-recovery / in-flight tracking, fights the registry placeholder's purpose. Rejected.
- **Persist the optimistic title as `display`:** fixes only the symptom and makes empty dead sessions *look like real conversations* — arguably worse. Rejected as the primary fix.

## Success Criteria

- After a reload, no `"Session <hex>"` rows remain for sessions that never produced a transcript.
- A session that is genuinely **mid-creation** (live runtime present, transcript imminent) is **never** swept.
- A session that produced **any** transcript content keeps its real derived title and is never swept.
- The live optimistic header (title + spark from send) is unchanged.
- Sweep is a Rust-owned canonical operation; TypeScript / `packages/ui` consume the resulting list without repair.

## Edge Cases

| Case | Expected behavior |
|------|-------------------|
| In-flight creation racing a scan (same process) | Live runtime present → **not** swept. Planning must confirm the sweep reads live-runtime state, not just DB rows. |
| Crash mid-first-turn, no transcript | Nothing to recover (no transcript) → swept. Correct. |
| Crash **after** transcript written | Real JSONL → not a registry placeholder → never swept. |
| Async session resume reconnecting a placeholder | A transcript-less placeholder has nothing for resume to attach to. Planning must verify the resume path (`docs/brainstorms/2026-04-12-async-session-resume-requirements.md`) does not depend on transcript-less placeholders. |
| Multi-agent | Signal is per-session (transcript + runtime); unaffected. |
| Worktree / copilot-missing markers (`__worktree__/`, `__session_registry__/copilot_missing/`) | Out of scope — only plain `__session_registry__/<id>` transcript-less rows are swept. Planning must not catch these other markers. |

## Non-Goals

- Persisting the optimistic first-message title to `display`.
- Deferring `session_metadata` persistence until first transcript write.
- Any change to the live optimistic header (title / agent icon / working spark).
- A two-stage hide-then-delete lifecycle (decided against — direct hard-delete).
- Auto-closing the *previous* session on new-thread (explicitly out — earlier confirmed as QA hygiene, not product behavior).

## Assumptions to Verify in Planning

- The Rust session scan has access to live-runtime state to distinguish dead vs mid-creation (the `is_registry` + transcript-absence checks already exist in `src-tauri/src/db/repository/session_metadata.rs`).
- No other subsystem relies on transcript-less registry rows persisting (resume, kanban, PR-link, sequence-id allocation).
- Hard-deleting a `session_metadata` row cascades cleanly (journal events, review state, config selection rows keyed by session id).

## GOD Note

Session lifecycle and the canonical session list are Rust-owned. The sweep belongs in the Rust scan / metadata layer; TypeScript and `packages/ui` must consume the canonical (already-swept) list, not filter orphans downstream.
