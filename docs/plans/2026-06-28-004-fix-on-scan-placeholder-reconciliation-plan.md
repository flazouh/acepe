---
title: "fix: Self-heal stale session placeholder rows on scan"
type: fix
status: active
depth: standard
created: 2026-06-28
origin: re-diagnosis (see memory: session-placeholder-reconciliation)
---

# fix: Self-heal stale session placeholder rows on scan

## Problem Frame

Deferred Claude sessions can show `"Session <hex>"` in the sidebar instead of their real title. Root cause (verified): the `session_metadata` row stays a **registry placeholder** (`file_path = "__session_registry__/<id>"`, `file_mtime=0`, `file_size=0`, `display="Session <hex>"`, `is_acepe_managed=1`) even though a real Claude transcript exists at `~/.claude/projects/<slug>/<id>.jsonl`. Reconciliation (placeholder → real path/size/title) is performed correctly by the indexer's `ClaudeSource::fetch`, but that runs **only on Rust-process startup** (`incremental_scan`) or a manual `reindex_sessions` — there is **no filesystem watcher** on `~/.claude/projects` and no per-write trigger. So any session whose transcript lands after the last startup scan stays a placeholder until the next restart.

Empirical proof: the last startup scan ran at 15:49; every session that started before 15:49 reconciled, every one after (6 sessions) is a stale `"Session <hex>"` with a real 54k–254k JSONL on disk. Confirmed internal `sessionId` == filename == row id (no keying mismatch).

**This corrects an earlier WRONG diagnosis** (that these were empty orphans) and an abandoned plan to delete them, which would have destroyed real conversations.

---

## Summary

Make the session scan **self-healing**: in `scan_project_sessions_inner`, after reading the indexed rows, reconcile any `is_acepe_managed` plain `__session_registry__/<id>` placeholder that has a matching on-disk Claude JSONL — update `file_path`/`file_mtime`/`file_size`/`display` from disk by reusing the existing reconciliation primitives (`extract_thread_metadata` + `SessionMetadataRepository::upsert`), and reflect the reconciled values in the returned list. **Reconcile only — never delete**; a placeholder with no on-disk JSONL is a legitimately-pending session and is left untouched. Exclude `__worktree__/` and `__session_registry__/copilot_missing/` markers.

Targeted (only placeholder rows, which are rare/zero in steady state) so the common scan stays cheap; synchronous so the title appears in the same scan that surfaces the row.

---

## GOD Architecture Attestation (cleared)

- **Authority surface:** `session_metadata` — the Rust-owned canonical session **index**. The scan already owns building the canonical session list.
- The on-disk JSONL is **raw provider input**; reconciliation **normalizes it into canonical Rust-owned metadata** via the existing Rust adapter (`extract_thread_metadata`). Moves truth upstream — the Green Rule working for us, not a downstream patch.
- TS / `packages/ui` consume the reconciled canonical list **unchanged**. No `canonical ?? hot` fallback, no UI repair, no TS provider branching.
- Not touching `SessionStateGraph` hot-state (status/lifecycle/turn/activity). Not parsing transcript **order/display rows** — only index metadata (path/size/title).
- **Constraint honored:** reuse the existing canonical normalizer (`extract_thread_metadata`) + writer (`upsert`); one reconciliation implementation, an additional trigger.

---

## Key Technical Decisions

1. **Targeted, not full re-scan.** Reconcile only placeholder rows (cheap; zero cost when none exist) rather than triggering a full `incremental_scan` on every sidebar scan (which would re-stat all files and regress scan cheapness).
2. **Reconcile only, never delete.** Missing on-disk JSONL ⇒ leave the placeholder (pending session). This is the safe inverse of the abandoned sweep.
3. **Synchronous in `scan_inner`.** The reconciled title appears in the same scan result, not a later refresh.
4. **Reuse `extract_thread_metadata` + `upsert`.** Same primitives the indexer uses; no parallel reconciler.
5. **Operate on `lookup.entries: Vec<SessionMetadataRow>`** returned by `get_for_projects`, **before** the `indexed_session_rows_to_history_entries` conversion (scanning.rs:~422). The converted `HistoryEntry` lowers placeholder paths to `None` (`indexed_source_path`), so eligibility must be read off the raw `SessionMetadataRow`. This also bypasses the `project_paths_missing_from_index` file-scan gate (which only governs the fallback for *missing* projects).
6. **Key the upsert on `row.id`** (the canonical Acepe/display identity, == the JSONL filename we statted), passing the extracted `display`/timestamp + real path/mtime/size. Do **not** key on the content `sessionId` returned by `extract_thread_metadata` (a forked/resumed transcript can carry a different internal `sessionId`, which would target the wrong row).
7. **Title-finality guard.** Only reconcile when extraction yields a **confident, non-fallback** title (non-empty after artifact stripping, not a generated `"Session <hex>"`/`"Untitled"` fallback). Otherwise leave the placeholder and retry on a later scan. Rationale: once a row flips to non-placeholder nothing on the scan path re-corrects it (the indexer that would is startup-only), so a degraded/torn read must not be made terminal.
8. **Eligibility via public row methods.** `SessionMetadataRow::is_transcript_pending()` (pub) + `row.is_acepe_managed` + `row.file_path.starts_with("__session_registry__/")` with no inner slash (inline). The repository's `is_acepe_managed_file_path` / `is_explicit_missing_transcript_marker` are private — do not call them from `scanning.rs`.

---

## Implementation Units

### U1. Reconcile-one-placeholder-from-disk helper

**Goal:** Given a placeholder `SessionMetadataRow`, if a matching on-disk Claude JSONL exists, reconcile the row and return the reconciled metadata (else `None`, untouched).

**Requirements:** Reconcile placeholder→real; reconcile-only-never-delete; exclusions.

**Dependencies:** none.

**Files:**
- `packages/desktop/src-tauri/src/history/commands/scanning.rs` (new helper, e.g. `reconcile_placeholder_row(db, row) -> Result<Option<HistoryEntry>>`) — or `history/indexer.rs` if a shared home fits better.
- Tests: inline `#[cfg(test)]` in the same file.

**Approach:**
- Eligibility (pure, no I/O): `row.is_acepe_managed` && `row.is_transcript_pending()` && `row.file_path.starts_with("__session_registry__/")` && no inner slash after the prefix (excludes both `copilot_missing/` and any nested marker). `__worktree__/` fails the prefix check. Use `SessionMetadataRow::is_transcript_pending()` (pub); do **not** call the private repository predicates.
- Compute the expected JSONL path: `get_session_jsonl_root()/projects/<path_to_slug(row.project_path)>/<row.id>.jsonl` (reuse `path_to_slug`, `get_session_jsonl_root`). `stat` it.
- **Negative cache:** keep a process-local `HashSet`/map of `(row.id, mtime, size)` that previously failed extraction; if the current stat matches a cached failure, skip without re-reading (bounds re-parse of present-but-unparseable files to once per file mutation).
- If present with `size > 0` and not negatively-cached: `extract_thread_metadata(path)`.
  - If it returns a **confident title** (non-empty after artifact stripping, not a `"Session <hex>"`/`"Untitled"` fallback): `SessionMetadataRepository::upsert(db, row.id, display, timestamp, row.project_path, agent_id, real_relative_path, real_mtime, real_size)` — **keyed on `row.id`**. Only on `Ok(true)` return the reconciled `HistoryEntry`.
  - If it returns `None` or a non-confident/fallback title: record `(id, mtime, size)` in the negative cache and return `None` (leave the placeholder; retry when the file changes).
- If absent / unreadable / upsert error: return `None` (leave the placeholder; **never delete**).

**Patterns to follow:** `ClaudeSource::fetch` per-file body in `history/indexer.rs` (the extract→record→upsert sequence); `is_transcript_pending`/`lifecycle_state` on `SessionMetadataRow`; title-fallback detection mirrors `history/title_utils.rs` / `is_fallback`-style checks.

**Execution note:** Test-first against a temp `~/.claude` (HomeGuard pattern used in indexer tests) + in-memory DB.

**Test scenarios:**
- **Reconciles:** placeholder row + real on-disk JSONL (with a real first user message) ⇒ row updated (real path, `file_size>0`, derived title) keyed on `row.id`; helper returns the reconciled entry; DB row no longer a placeholder.
- **Id keyed on row.id:** JSONL whose internal content `sessionId` ≠ filename/`row.id` ⇒ the **`row.id`** row is reconciled (not a new/other row); no duplicate created.
- **No JSONL ⇒ untouched:** placeholder with no on-disk file ⇒ returns `None`, row unchanged, **not deleted**.
- **Present-but-no-confident-title ⇒ untouched + negatively cached:** JSONL exists but first user message yields an empty/fallback/slash-command title ⇒ returns `None`, row left as placeholder, and a second call with the same `(mtime,size)` does **not** re-read the file (negative cache hit).
- **Worktree excluded:** `__worktree__/<id>` row ⇒ ineligible, returns `None`, untouched.
- **Copilot-missing excluded:** `__session_registry__/copilot_missing/<id>` (inner slash) ⇒ ineligible, returns `None`, untouched.
- **Already-real ⇒ untouched:** a row with a real path / `file_size>0` is not `is_transcript_pending()` ⇒ ineligible, returns `None`.
- **Upsert error ⇒ untouched:** simulated upsert failure ⇒ returns `None`, no optimistic entry.

**Verification:** Only eligible placeholders with a real transcript AND a confident title are reconciled (keyed on `row.id`); everything else is left intact and re-parse is bounded.

---

### U2. Wire self-heal into `scan_project_sessions_inner`

**Goal:** Run the reconcile over indexed placeholder rows during the scan and reflect reconciled values in the returned list.

**Requirements:** Self-heal on scan; canonical list returned already reconciled.

**Dependencies:** U1.

**Files:**
- `packages/desktop/src-tauri/src/history/commands/scanning.rs` (`scan_project_sessions_inner`)
- Tests: inline integration test in the same file.

**Approach:** Operate on `lookup.entries: Vec<SessionMetadataRow>` **before** `indexed_session_rows_to_history_entries` (scanning.rs:~422). For each eligible placeholder row, call U1's helper; on a successful reconcile, substitute the reconciled `SessionMetadataRow` (or the helper's returned `HistoryEntry`) so the subsequent conversion produces the real title/path. Reconcile runs inside `scan_project_sessions_inner`, which is wrapped by `SCAN_CACHE.get_or_fetch` — so the 5s-cached result is already reconciled. Only entries with a **successful** upsert are substituted; failed/declined ones keep their placeholder entry (still listed, never dropped). Non-placeholder rows and the file-scan fallback path are unchanged.

**Patterns to follow:** `indexed_session_rows_to_history_entries` / `derive_indexed_session_title` in `scanning.rs`; the existing cache-by-sorted-project-paths flow.

**Execution note:** Integration test driving `scan_project_sessions_inner`.

**Test scenarios:**
- **End-to-end:** seed a placeholder row + its real on-disk JSONL; run the scan ⇒ returned list shows the **derived title** (not `"Session <hex>"`); DB row reconciled.
- **Mixed:** placeholder-with-JSONL reconciles; placeholder-without-JSONL stays `"Session <hex>"` and remains in the list (not dropped, not deleted).
- **Cache:** the cached scan result reflects the reconciled title (second scan within TTL still shows it).
- **No placeholders ⇒ no-op:** scan with only real rows does no extra file I/O for non-placeholder rows and returns the same list.

**Verification:** A scan surfaces reconciled titles for placeholders that have transcripts, leaves transcript-less placeholders intact, and stays cheap when there are no placeholders.

---

### U3. Verify (Rust tests + clippy + live)

**Goal:** Prove the fix end-to-end without regressions.

**Dependencies:** U1, U2.

**Files:** test runs only.

**Approach / Verification:**
- `cargo nextest`/`cargo test` green for U1–U2; `cargo clippy` clean in `src-tauri/`.
- Live: with the dev DB's 6 known stale rows (107–112) and their on-disk JSONLs present, a scan (sidebar refresh) reconciles them — titles change from `"Session <hex>"` to `"Reply with only the word hello"` — verified via the QA CLI / DB re-query. No other rows change.
- Confirm the shipped optimistic-header behavior and the startup `incremental_scan` path are unaffected (this is an additive trigger).

**Test expectation:** covered by U1/U2 automated tests + manual live confirmation.

---

## Scope Boundaries

**In scope:** synchronous, targeted on-scan reconciliation of Acepe-managed plain registry placeholders that have a real on-disk Claude JSONL.

**Non-goals / Deferred to Follow-Up Work:**
- A filesystem watcher on `~/.claude/projects` (more proactive; the indexer infra `index_file`/`index_file_nowait` exists but is unwired). On-scan self-heal is sufficient for the sidebar; a watcher can be a later enhancement.
- Reconcile-on-turn-completion trigger.
- Any deletion/sweep of sessions (explicitly abandoned — would destroy real transcripts).
- Cursor/Codex/OpenCode/Copilot placeholder reconciliation (Claude-specific here; generalize later if needed).

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Mitigation |
|---|---|---|
| Reconcile deletes/loses data | None | Reconcile-only; never deletes. U1 "no JSONL ⇒ untouched" test. |
| **Frozen degraded title** (a row flips to non-placeholder with a bad first-read title; nothing on the scan path re-corrects it) | Low | **Title-finality guard** (Decision 7): only reconcile on a confident, non-fallback title; a degraded/empty/torn read leaves the placeholder to retry. |
| **Re-parse every scan** for a present-but-unparseable JSONL | Low | **Negative cache** by `(id, mtime, size)` (Decision/U1): unparseable files read at most once per file mutation, not once per 5s scan. |
| Reconcile races the active/live session writer | Low | First user message is written at turn start and is stable thereafter; nothing else writes `display` live. Title-finality guard rejects torn/empty reads. (A live-session gate via the runtime registry is a deferred follow-up if this proves insufficient.) |
| Wrong row updated (content `sessionId` ≠ filename for forked/resumed sessions) | Low | **Upsert keyed on `row.id`** (Decision 6), not the extracted content id. U1 "id keyed on row.id" test. |
| Cached title reverts (upsert failed but entry was patched) | Low | Patch the returned entry **only on `Ok(true)`** (U2). U1 "upsert error ⇒ untouched" test. |

---

## System-Wide Impact

- **Rust:** `history/commands/scanning.rs` (+ reuse of `extract_thread_metadata`, `path_to_slug`, `get_session_jsonl_root`, predicate helpers). No schema change.
- **TypeScript / UI:** none — consumes the reconciled canonical list.

---

## Next Step

Mandatory `/document-review` gate, then TDD per unit (U1 → U2 → U3).
