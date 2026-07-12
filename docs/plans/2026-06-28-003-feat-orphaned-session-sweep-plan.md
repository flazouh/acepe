---
title: "feat: Sweep orphaned transcript-less sessions on scan"
type: feat
status: active
depth: deep
created: 2026-06-28
origin: docs/brainstorms/2026-06-28-orphaned-session-sweep-requirements.md
---

# feat: Sweep orphaned transcript-less sessions on scan

## Problem Frame

Deferred Claude sessions whose **first turn is interrupted before the agent writes a transcript** persist as orphaned shells: a `session_metadata` row with `file_path = "__session_registry__/<id>"`, `file_mtime = 0`, `file_size = 0`, and no backing JSONL. Because the sidebar title (`display`) is derived from the first user message in the transcript, these fall back to `"Session <hex>"` and accumulate in history after a reload.

Confirmed empirically against the live dev DB: 100% correlation — all untitled `"Session <hex>"` Claude sessions are 0-byte `__session_registry__` placeholders; all titled sessions have real transcripts (see origin: `docs/brainstorms/2026-06-28-orphaned-session-sweep-requirements.md`).

This is **separate from** the just-shipped optimistic header (a live-only projection that correctly persists nothing) and must not regress it.

---

## Summary

On the Rust-side session scan, **hard-delete dead orphan sessions** — rows that are (a) plain `__session_registry__/<id>` registry placeholders, (b) transcript-pending (no JSONL), (c) Acepe-managed, (d) not `__worktree__/` or `__session_registry__/copilot_missing/` markers, and (e) **not currently live** in the process's session supervisor. Deletion cascades cleanly via existing `ON DELETE CASCADE` foreign keys. The scan returns an already-swept canonical list; TypeScript / `packages/ui` consume it unchanged (no downstream filtering).

Confirmed by Phase 1 research:
- Predicates already exist in `packages/desktop/src-tauri/src/db/repository/session_metadata.rs`: `is_transcript_pending()` / `lifecycle_state()` (`file_mtime==0 && file_size==0 && normalized_source_path()==None`), `is_acepe_managed_file_path()` (plain `__session_registry__/<id>`), `is_explicit_missing_transcript_marker()` (copilot_missing exclusion).
- All child tables (`session_journal_event`, `session_review_state`, `acepe_session_state`, `session_config_selection`, `session_projection_snapshots`, `checkpoints`) have `ON DELETE CASCADE` on `session_metadata.id` — a single `SessionMetadataRepository::delete` cascades fully.
- Liveness is queryable: `SessionGraphRuntimeRegistry::supervisor().snapshot_for_session(id)`; the registry is managed State (registered in `packages/desktop/src-tauri/src/lib.rs`). Precedent: `delete_by_agent_for_projects_excluding_ids(..., live_session_ids)`.

---

## Requirements Traceability

| Requirement (origin) | Where addressed |
|---|---|
| Sweep dead orphans (registry placeholder + no transcript + no live runtime), on scan | U2, U3 |
| Hard-delete the row (cascade-clean) | U2 |
| Never sweep a mid-creation session (live runtime) | U2 (live-id exclusion), U3 (scan gathers live set) |
| Never sweep a session with any transcript | U2 (transcript-pending predicate) |
| Exclude `__worktree__/` and `__session_registry__/copilot_missing/` | U2 |
| Rust-owned; TS consumes swept list, no repair | U3 |
| No regression to optimistic header (live-only) | Scope Boundaries; U4 verification |
| No regression to async session resume | U4 |

---

## Key Technical Decisions

1. **Sweep folded into the scan path**, not a separate frontend-triggered command. The scan is the natural point where orphans become visible; folding keeps the returned list canonical and avoids a new frontend round-trip. (Confirmed with user.)
2. **Liveness gate, not a timer.** A transcript-less placeholder that is *not* in the session supervisor is dead by definition — a genuinely mid-creation session is reserved in the supervisor (`reserve()` inserts into the live map) or already has transcript bytes. Avoids both the mid-creation race and arbitrary age thresholds.
3. **Reuse cascade-delete.** Rely on the existing `ON DELETE CASCADE` FKs; do not hand-delete child rows. The sweep mirrors the existing `delete_by_agent_for_projects_excluding_ids` liveness-exclusion pattern.
4. **Scope to Acepe-managed plain registry placeholders.** Exclude `__worktree__/` (deferred worktree sessions — may be legitimately pending worktree init) and `__session_registry__/copilot_missing/` (Copilot-specific pending marker). The mechanism is agent-agnostic but only these placeholders qualify.
5. **Sweep before cache + list build.** `scan_project_sessions` caches by project paths; the sweep runs before the list is read/cached so the cached result is already clean.

---

## GOD Architecture Attestation

- **Authority surface:** canonical session list / session lifecycle — **Rust-owned**. This change *moves truth upstream*: it removes non-canonical placeholder cruft from the Rust store so the canonical scan result is correct, rather than filtering orphans downstream in TS/UI.
- **No dual-read / no UI repair:** TypeScript and `packages/ui` consume the swept canonical list unchanged. No `canonical ?? hot` fallback, no provider branching, no downstream order/identity repair.
- **No forbidden hot-state writes.** The sweep is a canonical DB operation, not a transient projection write.
- **Liveness source is canonical runtime state** (`SessionSupervisor`), not a guessed signal.
- **Verdict:** GOD-clean by construction. The only caution (U2/U3) is that the liveness set must be read from the live supervisor at sweep time so an in-flight same-process creation is never deleted.

---

## High-Level Technical Design

*Directional guidance for review, not implementation specification.*

```
scan_project_sessions(project_paths, db, runtime_registry: State<…>)
        │
        ▼
scan_project_sessions_inner
        │  1. live_ids ← runtime_registry.supervisor().live_session_ids()
        │  2. SessionMetadataRepository::sweep_orphaned_registry_sessions(
        │         db, project_paths, &live_ids)         ← hard-delete, cascade
        │  3. get_for_projects(...) / file-scan fallback ← now returns clean list
        ▼
HistoryEntry[]  (no "Session <hex>" orphans)
```

Sweep predicate (conceptual SQL, validate against the ORM layer at implementation time):

```
DELETE rows WHERE
      is_acepe_managed = 1
  AND file_path LIKE '__session_registry__/%'
  AND file_path NOT LIKE '__session_registry__/%/%'      -- plain placeholder, no inner slash
  AND file_mtime = 0 AND file_size = 0                    -- transcript-pending
  AND id NOT IN (live_ids)                                -- not live in this process
  AND project_path IN (project_paths)                     -- scoped to scanned projects
-- worktree (__worktree__/) and copilot_missing (__session_registry__/copilot_missing/)
-- are already excluded by the two LIKE clauses above.
```

---

## Implementation Units

### U1. Live-session-id accessor on the runtime registry

**Goal:** Expose the set of session ids currently live in the supervisor so the sweep can exclude them.

**Requirements:** Never sweep a mid-creation session.

**Dependencies:** none.

**Files:**
- `packages/desktop/src-tauri/src/acp/lifecycle/supervisor.rs` (add a method returning all live session ids, or expose the keys of the live `DashMap`)
- `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs` (thin pass-through accessor, mirroring `supervisor()` / `remove_session()`)
- Tests: `packages/desktop/src-tauri/src/acp/lifecycle/supervisor.rs` (inline `#[cfg(test)]` module, following existing supervisor tests)

**Approach:** Add `live_session_ids() -> HashSet<String>` (or `&` iterator collected by callers) on `SessionSupervisor`, reading the `sessions` `DashMap` keys. Add a pass-through on `SessionGraphRuntimeRegistry`. No behavior change to reservation/removal.

**Patterns to follow:** existing `snapshot_for_session`, `remove_session`, and the `reserve()` `contains_key` check in `supervisor.rs`.

**Execution note:** Test-first — assert reserved sessions appear and removed sessions disappear.

**Test scenarios:**
- Reserving a session id makes it appear in `live_session_ids()`.
- Removing it (via `remove_session`) drops it from the set.
- Empty supervisor returns an empty set.

**Verification:** `live_session_ids()` reflects exactly the currently reserved sessions.

---

### U2. Orphan sweep repository method

**Goal:** Hard-delete dead orphan registry placeholders for the given projects, excluding live ids, cascading cleanly.

**Requirements:** Sweep dead orphans; hard-delete (cascade); exclude transcript-bearing, worktree, copilot-missing, and live sessions.

**Dependencies:** U1.

**Files:**
- `packages/desktop/src-tauri/src/db/repository/session_metadata.rs` (new `sweep_orphaned_registry_sessions(db, project_paths, live_session_ids) -> Result<u64>`)
- Tests: `packages/desktop/src-tauri/src/db/repository/session_metadata.rs` (inline `#[cfg(test)]`, following existing repository tests in `db/repository_test.rs` / module tests)

**Approach:** Mirror `delete_by_agent_for_projects_excluding_ids`: build a filtered `delete_many` over `session_metadata` using the predicate in the High-Level Design (plain `__session_registry__/<id>`, `file_mtime==0 && file_size==0`, `is_acepe_managed`, project scope, `id NOT IN live_ids`). Rely on `ON DELETE CASCADE` for child rows — do not hand-delete. Return the count swept (for logging/telemetry). Reuse the existing predicate helpers (`is_acepe_managed_file_path`, `is_explicit_missing_transcript_marker`, `is_transcript_pending`) for the in-Rust safety re-check where a raw SQL `LIKE` is insufficient.

**Patterns to follow:** `delete_by_agent_for_projects_excluding_ids` (line ~1905), `delete` (line ~1881), the lifecycle predicate helpers (lines ~761, ~863, ~867, ~141).

**Execution note:** Test-first against an in-memory/temp SQLite DB with the real migrations.

**Test scenarios:**
- **Orphan swept:** plain `__session_registry__/<id>` placeholder, `file_size==0`, acepe-managed, not live, in a scanned project → deleted; `delete` returns count 1.
- **Cascade:** a swept orphan with rows in `session_journal_event` / `acepe_session_state` / `session_config_selection` leaves **no** dangling child rows (assert child tables empty for that id).
- **Safety — has transcript:** a `__session_registry__` row that has gained a real `file_path`/`file_size>0` → **not** swept.
- **Safety — live:** an orphan whose id IS in `live_session_ids` → **not** swept.
- **Safety — worktree:** a `__worktree__/<id>` placeholder → **not** swept.
- **Safety — copilot-missing:** a `__session_registry__/copilot_missing/<id>` marker → **not** swept.
- **Safety — different project:** an orphan whose `project_path` is not in `project_paths` → **not** swept.
- **Idempotent:** running the sweep twice deletes 0 the second time.

**Verification:** Only the targeted orphans are removed; all safety cases survive; child rows are gone for swept ids.

---

### U3. Wire the sweep into the scan path

**Goal:** Run the sweep transparently during `scan_project_sessions`, returning an already-clean canonical list.

**Requirements:** Sweep on scan; Rust-owned; TS consumes swept list.

**Dependencies:** U1, U2.

**Files:**
- `packages/desktop/src-tauri/src/history/commands/scanning.rs` (`scan_project_sessions` command signature + `scan_project_sessions_inner`)
- `packages/desktop/src-tauri/src/lib.rs` (confirm `SessionGraphRuntimeRegistry` managed State is injectable into the command; no new registration expected)
- Tests: `packages/desktop/src-tauri/src/history/commands/scanning.rs` (inline integration test) or the existing scanning test module

**Approach:** Add `runtime_registry: State<Arc<SessionGraphRuntimeRegistry>>` to `scan_project_sessions`. In `scan_project_sessions_inner`, before reading/caching the indexed list: gather `live_ids` (U1), call `sweep_orphaned_registry_sessions` (U2) for the scanned projects, then proceed. Ensure the sweep runs **before** the result cache is populated so cached scans are clean. Keep the file-scan fallback path unaffected (orphans only exist as index rows).

**Patterns to follow:** existing State injection in other `scanning.rs` commands; the cache-by-sorted-project-paths logic already in `scan_project_sessions`.

**Execution note:** Integration test driving `scan_project_sessions_inner` end-to-end.

**Test scenarios:**
- **End-to-end orphan removal:** seed an orphan + a titled (transcript-bearing) session; scan → returned `HistoryEntry[]` excludes the orphan, includes the titled session, and the orphan row is gone from the DB.
- **End-to-end live preservation:** seed an orphan whose id is reserved in the supervisor; scan → orphan **preserved** (live), still present after scan.
- **Cache reflects sweep:** a second scan (cache hit) does not resurrect the orphan.
- **No-op when none:** scan with no orphans deletes nothing and returns the same list.

**Verification:** `scan_project_sessions` returns a list with no transcript-less `"Session <hex>"` orphans for dead sessions, while live and transcript-bearing sessions remain.

---

### U4. Regression guard: optimistic header + async resume unaffected

**Goal:** Prove the sweep does not regress the live optimistic header or the async session-resume path.

**Requirements:** No regression to optimistic header; no regression to async resume.

**Dependencies:** U3.

**Files:**
- Tests: `packages/desktop/src-tauri/src/history/commands/scanning.rs` (resume-safety case) and a TS-side note/check if needed
- Read-only verification against `docs/brainstorms/2026-04-12-async-session-resume-requirements.md`

**Approach:** Verify (a) the optimistic header is a live-only TS projection with no dependency on persisted orphan rows (no code change — assert via existing optimistic tests still green), and (b) the async-resume path does not attach to transcript-less placeholders. Add a test: a session being resumed/reconnected is live in the supervisor → not swept; a transcript-less placeholder with no live runtime and no resume claim → swept.

**Patterns to follow:** the resume/reconnect path identified in research (`src/acp/commands/session_commands::resume`).

**Test scenarios:**
- A session mid-resume (live in supervisor) → **not** swept.
- The shipped optimistic-header tests (`pre-session-optimistic-identity.test.ts`) remain green (no behavioral coupling).

**Verification:** Resume and optimistic-header behavior are unchanged; only dead transcript-less orphans are swept.

---

## Scope Boundaries

**In scope:** Rust-side sweep of dead Acepe-managed plain `__session_registry__/<id>` orphans on scan, cascade-delete, liveness gate, exclusions, TDD coverage.

**Non-goals:**
- Persisting the optimistic first-message title to `display`.
- Deferring `session_metadata` persistence until first transcript write.
- Any change to the live optimistic header (title / icon / spark).
- A hide-then-delete two-stage lifecycle (decided against — direct hard-delete).
- Sweeping `__worktree__/` or `__session_registry__/copilot_missing/` markers.
- Auto-closing the previous session on new-thread (confirmed QA hygiene, not product behavior).

**Deferred to Follow-Up Work:**
- Telemetry/logging dashboard for sweep counts (the method returns a count; wiring it to telemetry is optional follow-up).
- A periodic background sweep independent of scan (scan-time sweep is sufficient for the observed problem).

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Mitigation |
|---|---|---|
| Sweeping a genuinely mid-creation session (same process) | Low | Liveness gate reads the live supervisor at sweep time (U1); covered by U2/U3 live-preservation tests. |
| Cascade misses a table → dangling rows | Low | All child tables verified `ON DELETE CASCADE` in research; U2 cascade test asserts no dangling rows. New future child tables must add the FK — note in U2. |
| Worktree/copilot placeholders wrongly swept | Low | Predicate excludes inner-slash paths; U2 worktree + copilot-missing tests. |
| Scan becomes mutating (surprising) | Low | Intentional and documented; sweep is scoped + idempotent; returns clean canonical list. |
| Resume path depends on transcript-less placeholder | Low | U4 verifies; transcript-less placeholder has nothing to resume. |

---

## System-Wide Impact

- **Rust:** `supervisor.rs`, `runtime_registry.rs`, `session_metadata.rs`, `scanning.rs`, command signature in `lib.rs` registration.
- **TypeScript / UI:** none — consumes the already-clean scan result. No frontend change.
- **DB:** rows deleted (cascade); no schema change.

---

## Verification Strategy

- `cargo nextest` (or `cargo test`) green for U1–U4 Rust tests, including all safety cases.
- `cargo clippy` clean in `src-tauri/`.
- Manual: with the dev DB containing the 12 known orphans, a scan removes the transcript-less `"Session <hex>"` rows while titled sessions remain (live-verify via the sidebar after a reload).
- Shipped optimistic-header tests remain green.

---

## Next Step

**Mandatory `` gate** before `/ce:work`. Then TDD per unit (U1 → U2 → U3 → U4).
