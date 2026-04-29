# Cursor session rebind — requirements

**Status:** Diagnosis complete, design pending
**Owner:** unassigned
**Trigger:** Acepe-created Cursor sessions persist as `__session_registry__/<acepe_id>` placeholders forever; on-disk Cursor transcripts exist under different (cursor-internal) IDs and are never linked back. Result: empty agent panels with "Session <8 char>" titles for any cursor session created from Acepe.

## Problem

When Acepe mints a new session for the Cursor agent:

1. We persist `session_metadata` with `file_path = __session_registry__/<acepe_id>` as a placeholder.
2. We launch the Cursor ACP agent, which accepts our `acepe_id` for the duration of the ACP session.
3. The user chats; turns are recorded in `session_journal_event` (we observed `turn_complete` events for turns 4–7 in sessions 15/16).
4. Cursor independently writes its own on-disk transcript — but **under a cursor-internal session UUID**, not our acepe id.
5. When Cursor exits / Acepe restarts, our `session_metadata.file_path` is still the placeholder. The discovery scan over `~/.cursor/projects/.../agent-transcripts/<id>.jsonl` and `~/.cursor/chats/<hash>/<id>/store.db` cannot find anything keyed by `acepe_id`. `source_path` stays None, the frontend treats the session as `created` with no source, skips provider history, panels render empty with the placeholder display name.

This is **not a regression**. Every `relationship='created'` Cursor session ever made is in this state — currently 10 stranded sessions in the dev DB (sequence_ids 2, 6, 8, 9, 10, 11, 13, 14, 15, 16).

Verified evidence:

- Sessions 15/16 (`7007450f…`, `016083e1…`) journal has projection_update `turn_complete` for turns 4–7. User chatted.
- `~/.cursor/projects/Users-alex-Documents-acepe/agent-transcripts/` has no directory matching either acepe id.
- `~/.cursor/chats/*/{7007450f…,016083e1…}/store.db` does not exist.
- The only Cursor jsonl modified during the chat window (Apr 29 01:09–01:24) is `29b18cae-…` (modified 04:23), and its content references different prompts (copilot/vite imports), not ours.

## Goal

Acepe-created Cursor sessions should hydrate from on-disk Cursor data on next open — same as `relationship='discovered'` sessions do today.

## Open design questions (need decisions before planning)

### Q1 — How do we learn Cursor's internal session ID?

**RESOLVED via direct probing of `cursor-agent acp`:**

- Cursor's ACP server **ignores any `sessionId` the client sends in `session/new`** and mints its own. Verified by sending `{"method":"session/new","params":{"sessionId":"7007450f-a4b6-..."}}` and receiving `{"result":{"sessionId":"33e32f56-9ff1-..."}}` — a totally different id.
- The minted id is returned in **`session/new` `result.sessionId`** (and presumably `session/load` likewise). No extension sniffing required, no workspace-storage probing, no content fingerprinting needed for online capture.
- Cursor's ACP server declares `agentCapabilities.loadSession: true` and `sessionCapabilities.list: {}`, so once we have the cursor id we can resume by it later.
- The CLI command `cursor-agent create-chat` returns its own id (`6ea66f5d-...`) but that id is **not loadable** through the ACP server (`session/load` returns `-32602 Session not found`) — the CLI store and the ACP server appear to be separate. Don't go that route.

So online capture is trivial: read `result.sessionId` from `session/new` / `session/load` ACP responses. The only remaining decisions are Q2 (when), Q3 (where), Q4 (backfill).

(Original candidates kept below for historical reference.)

Candidates considered:

- **(a) ACP response capture.** ✅ **Chosen.** Cursor returns its id in the standard `session/new` response. No extension sniffing needed.
- **(b) Workspace-storage probe.** Reliable but heuristic. Useful only as a Q4 backfill primitive for already-stranded sessions.
- **(c) Content fingerprint.** Universal backfill primitive. Useful only for Q4.
- **(d) Force the id.** ❌ Confirmed impossible — cursor ignores our `sessionId`.

### Q2 — When does the rebind happen?

- On session close (cursor agent exit)?
- On every session update (continuously update file_path as we learn more)?
- On next open (lazy scan)?
- One-shot post-startup background sweep over all `__session_registry__` rows?

Likely answer: a combination. Online rebind via Q1(a) when available, plus a lazy post-startup sweep using Q1(b)/(c) for older stranded sessions.

### Q3 — Where do we store the mapping?

- Update `session_metadata.file_path` in place (current shape — only one path per session).
- Add a `provider_session_id` column / `session_provider_alias` table for explicit acepe_id ↔ cursor_internal_id pairing.

The latter is more honest about what's happening but a bigger schema change. The former works if we treat `file_path` as the authoritative pointer.

### Q4 — Backfill for the 10 stranded sessions?

- Skip backfill, declare them lost? (Simplest, user loses real history.)
- Best-effort match by project_path + time-window + first-user-prompt content from journal? (Recovers most.)
- One-shot migration that runs on startup, then never again?

### Q5 — UX while rebind is unresolved

- Hide stranded sessions from the sidebar entirely?
- Show them but render an explicit "transcript not yet linked" state instead of the silent empty panel?
- Auto-rebind on click and reload?

Today they render as empty connected panels with no title, which is the worst of all worlds.

## Non-goals

- Changing how `discovered` Cursor sessions work — they already hydrate correctly.
- Same-class fix for Claude Code, Codex, Copilot — they don't have this bug (see scope evidence below).

## Scope confirmation (DB evidence, dev environment)

| Provider | Total | Real path | Bare `__session_registry__/<id>` | `__session_registry__/copilot_missing/<id>` |
|---|---|---|---|---|
| claude-code | 100 | 100 | 0 | 0 |
| codex | 50 | 50 | 0 | 0 |
| copilot | 50 | 30 | 0 | 20 |
| cursor | 87 | 77 | **10** | 0 |

- Claude Code & Codex persist under the ACP-supplied session id → no rebind needed.
- Copilot already explicitly namespaces unrecoverable transcripts under `copilot_missing/` (`copilot_history/parser.rs::FALLBACK_MARKER_PREFIX`) — different problem, already solved.
- **Cursor is the only provider with bare placeholders that should-but-don't have transcripts.**

The `copilot_missing/` pattern is a useful precedent if Q1 (capturing cursor's internal id online) turns out to be infeasible: a `cursor_unbound/<id>` sub-namespace + an explicit "transcript not yet linked" UI state would at least make the failure mode honest instead of silently empty.

## Investigation needed before planning

1. Read `acp/providers/cursor_session_update_enrichment.rs` and any ACP extension messages cursor emits to confirm/deny Q1(a).
2. Spike: launch a fresh acepe→cursor session, chat one turn, then `find ~/.cursor -newer <start_time> -type f` to identify exactly what cursor writes and where, keyed by what id.
3. Read `db/migrations/m20260427_000002_migrate_legacy_provider_aliases.rs` — already does a one-shot rebind for copilot legacy ids; same pattern may apply.
4. Inspect `repository.rs` `is_acepe_managed_file_path` and `created_session_file_path` to understand where the placeholder is written and where it's expected to be replaced.

## Frontend symptom (already partially mitigated)

- Loading-state branch added in `agent-panel-content.svelte` now uses `LoadingIcon` (dot-triangle 17 spinner) centered on both axes (commit pending).
- The empty-with-no-title state for stranded sessions is *not yet* explicitly handled — they currently fall through to "Ready to assist" or the local-created branch. Q5 above.
