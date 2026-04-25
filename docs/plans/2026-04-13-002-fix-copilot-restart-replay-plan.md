---
title: fix: Restore Copilot restart titles and replay hygiene
type: fix
status: active
date: 2026-04-13
origin: docs/brainstorms/2026-03-30-github-copilot-cli-agent-requirements.md
---

# fix: Restore Copilot restart titles and replay hygiene

## Overview

Fix the Copilot restart path so previously named sessions keep their real titles after app restart, and reconstructed history stops surfacing internal Copilot parser artifacts as if they were ordinary assistant conversation. The change should make title hydration and transcript reconstruction converge across filesystem discovery, journal replay, and ACP fallback instead of each path applying different rules.

## Problem Frame

Two regressions are interacting in the current Copilot history stack.

First, Acepe creates placeholder Copilot metadata rows with `display = "Session <id>"` at session creation/resume time. On restart, startup hydration reads that row before any richer refresh runs. The Copilot indexer can discover a real title from `workspace.yaml.summary`, but its unchanged check only compares transcript path + mtime + size, so a better title is skipped whenever the underlying `events.jsonl` file metadata has not changed. That makes restart fall back to the placeholder title even though Copilot state already knows the real session summary.

Second, Copilot session reconstruction currently replays journaled/provider-owned updates too literally. The result includes internal reasoning/preamble style chunks and other transport-level noise that are useful for live runtime/projection state, but make the restored thread read like a debug trace rather than a clean session transcript. The artifact pattern in the provided streaming log and reconstructed output suggests we need an explicit boundary between **projection completeness** and **history-visible transcript content**.

## Requirements Trace

- R1. Copilot sessions reopened after restart must keep the best known title instead of reverting to `Session <id>`.
- R2. Copilot title refresh must work even when `events.jsonl` mtime/size are unchanged but `workspace.yaml.summary` (the Copilot-derived title source in scope for this fix) is better than the stored placeholder.
- R3. Reconstructed Copilot history must exclude internal parser/runtime artifacts that should not appear as normal assistant transcript content.
- R4. The filtering rule must apply consistently across journal replay, direct transcript parsing, and ACP replay fallback so restart behavior does not vary by load path.
- R5. Existing session metadata identity guarantees must remain intact: local session ID, provider session ID, project/worktree path, and replay fallback behavior cannot regress.
- R6. The fix should be characterization-first because the current behavior sits at the boundary between runtime projections, persisted metadata, and provider-owned history.

## Scope Boundaries

- No redesign of the live agent panel, tool rendering, or thought-block UI for active sessions.
- No changes to Copilot ACP transport itself or to the debug streaming-log format. ACP-layer call-site wiring may change only where needed to consume the shared metadata/replay behavior defined in this plan.
- No broad provider-agnostic rewrite of journal semantics in the same patch; this fix is scoped to Copilot restart/history correctness.
- No manual title-edit UX changes beyond preserving and preferring the already-supported override path.

### Deferred to Separate Tasks

- A broader policy for how every provider should expose or hide reasoning/thought chunks in restored history.
- Any future work to visualize debug streaming logs directly as a separate developer tool.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src-tauri/src/db/repository.rs` stores session metadata. `ensure_exists*` seeds placeholder Copilot display titles, while `batch_upsert` / `upsert` handle later scanner refreshes.
- `packages/desktop/src-tauri/src/history/indexer.rs` `CopilotSource::fetch()` already reads `workspace.yaml.summary` via `copilot_history::list_workspace_sessions(...)`, but currently skips updates when transcript file metadata is unchanged.
- `packages/desktop/src-tauri/src/history/commands/scanning.rs` and `packages/desktop/src-tauri/src/history/commands/session_loading.rs` already separate metadata display derivation from actual session loading; the restart fix should preserve that separation.
- `packages/desktop/src-tauri/src/copilot_history/mod.rs` owns provider-owned session loading and converts replay updates into `ConvertedSession`.
- `packages/desktop/src-tauri/src/copilot_history/parser.rs` discovers Copilot sessions from `workspace.yaml` and maps provider events into `SessionUpdate`s, so it is the right place to define which replay events are transcript-visible.
- `packages/desktop/src-tauri/src/acp/session_journal.rs` persists projection updates for restart replay. That layer should remain projection-complete, but Copilot history reconstruction may need a narrower visibility filter before building `ConvertedSession`.
- `docs/solutions/logic-errors/worktree-session-restore-2026-03-27.md` is the closest local precedent: restart correctness bugs are best fixed at the earliest persisted metadata boundary, not by hoping a later scan repairs missing state.

### Institutional Learnings

- `docs/solutions/logic-errors/worktree-session-restore-2026-03-27.md` reinforces that restart metadata must be complete before preload/hydration paths consume it.
- `docs/solutions/logic-errors/operation-interaction-association-2026-04-07.md` reinforces that canonical/projection ownership should stay in backend boundaries, not be patched ad hoc in UI consumers.

### External References

- None. The repository and the supplied Copilot log provide enough evidence for this bounded fix.

## Key Technical Decisions

- **Treat placeholder titles as provisional, not authoritative**: the Acepe-seeded `Session <id>` placeholder format(s) are fallback only. For this fix, only `workspace.yaml.summary` and existing manual overrides participate in title upgrades.
- **Placeholder detection must use Acepe-owned provenance, not heuristics**: for this fix, a “placeholder” means the exact Acepe-generated `Session <id>` placeholder format(s) seeded by the metadata creation paths, not an arbitrary provider/user title that happens to look similar.
- **Keep title override precedence unchanged**: explicit user overrides still win; the new logic only upgrades non-overridden placeholder/default titles.
- **Separate projection replay from transcript reconstruction**: journaled Copilot updates may remain rich for runtime projection correctness, but `ConvertedSession` should only include the subset of updates that constitute clean history-visible conversation/tool activity.
- **Use one Copilot replay-visibility policy across all restore paths**: direct transcript parsing, journal replay, and ACP replay must all normalize into the same `Vec<(u64, SessionUpdate)>` seam, then apply the visibility filter immediately before `convert_replay_updates_to_session` / `ReplayAccumulator` so restart output stays stable regardless of which path wins.
- **Keep replay consistency work bounded to existing seams**: achieve consistency by inserting a Copilot-only visibility helper at the existing restore seams, not by re-architecting restore-path ownership or broadening the fix into a provider-agnostic replay refactor.
- **Prefer repo-grounded refresh over UI fallback**: title freshness should be fixed in metadata/indexing and provider-owned load paths, not papered over in frontend session-list rendering.

## Open Questions

### Resolved During Planning

- **Should this be solved by changing session-list rendering only?** No. The bug is persisted metadata and replay-shaping drift, not just display logic.
- **Should the journal stop storing thought chunks entirely?** No for this fix. The journal may still need projection-complete data; the history reconstruction path should decide what becomes transcript-visible.
- **Should title refresh depend solely on transcript parsing?** No. Copilot already exposes `workspace.yaml.summary`, and restart hydration needs that metadata even when transcript content is unchanged or unavailable.

### Deferred to Implementation

- Exact helper naming for “placeholder/default title” detection and Copilot replay visibility filtering.
- The exact list of Copilot replay update kinds that remain visible versus projection-only after characterization tests capture the current artifact pattern.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
Copilot session start/resume
        |
        v
metadata row created with provisional fallback title
        |
        +--> startup/session list reads DB
        |
        +--> Copilot scanner reads workspace.yaml.summary + transcript state
                |
                v
      metadata refresh policy
      - detect placeholder/default title
      - allow summary/title upgrades even when file mtime/size are unchanged
      - preserve title overrides
                |
                v
      stable restart title

provider-owned history load
        |
        +--> direct transcript parser
        +--> journal replay
        +--> ACP replay fallback
                |
                v
      shared Copilot history-visibility filter
      - keep user messages
      - keep visible assistant/tool activity
      - drop projection-only/internal artifact updates
                |
                v
      ConvertedSession with clean transcript parity
```

## Implementation Units

- [ ] **Unit 1: Capture the restart title-loss and artifact regressions with characterization tests**

**Goal:** Lock the current Copilot restart failures into focused tests before changing metadata refresh or replay shaping.

**Requirements:** R1, R2, R3, R6

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src-tauri/src/copilot_history/mod.rs`
- Modify: `packages/desktop/src-tauri/src/copilot_history/parser.rs`
- Modify: `packages/desktop/src-tauri/src/db/repository_test.rs`
- Modify: `packages/desktop/src-tauri/src/history/indexer.rs`
- Test: `packages/desktop/src-tauri/src/copilot_history/mod.rs`
- Test: `packages/desktop/src-tauri/src/copilot_history/parser.rs`
- Test: `packages/desktop/src-tauri/src/db/repository_test.rs`

**Approach:**
- Add one characterization test for restart title persistence:
  - seed a Copilot metadata row through the `ensure_exists*` path so it gets the fallback `Session <id>` title
  - run the Copilot indexing/update path with a richer `workspace.yaml.summary`
  - prove the current unchanged-file shortcut wrongly preserves the placeholder title
- Add one transcript characterization test that reconstructs a Copilot session from replay/journal-style updates resembling the provided artifact sequence and proves the current output contains internal artifact content that should be filtered.
- Add one shared characterization assertion that exercises the same artifact class through direct transcript parsing, journal replay, and ACP fallback conversion so the pre-fix inconsistency is captured before Unit 3 changes the filter.
- Keep the fixtures minimal and grounded in the observed Copilot log shape so later units can go red/green without inventing a broader policy.

**Execution note:** Start with failing characterization coverage before changing refresh/filter logic.

**Patterns to follow:**
- `packages/desktop/src-tauri/src/history/session_context.rs` restart-focused tests
- `packages/desktop/src-tauri/src/copilot_history/mod.rs` replay conversion tests
- `docs/solutions/logic-errors/worktree-session-restore-2026-03-27.md`

**Test scenarios:**
- Error path — a non-overridden placeholder Copilot metadata row remains stuck at `Session <id>` because the current unchanged-file shortcut skips the richer `workspace.yaml.summary`.
- Error path — startup/session-list hydration still reads the stale placeholder row because no earlier persistence path upgrades it.
- Error path — replay input containing internal Copilot artifact updates currently leaks them into transcript reconstruction, proving the bug before the fix.

**Verification:**
- The failure mode is reproducible in tests without depending on a live Copilot process.

- [ ] **Unit 2: Refresh Copilot metadata titles even when transcript file metadata is unchanged**

**Goal:** Ensure Copilot restart/session-list metadata keeps the best known title instead of freezing the initial placeholder/default display.

**Requirements:** R1, R2, R5

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src-tauri/src/history/indexer.rs`
- Modify: `packages/desktop/src-tauri/src/db/repository.rs`
- Modify: `packages/desktop/src-tauri/src/history/commands/scanning.rs`
- Test: `packages/desktop/src-tauri/src/history/indexer.rs`
- Test: `packages/desktop/src-tauri/src/db/repository_test.rs`

**Approach:**
- Introduce an explicit “placeholder/default display” rule for session metadata so `Session <id>` is treated as provisional.
- Update the Copilot indexer refresh path so unchanged transcript file metadata does not automatically skip a better title. The refresh decision should consider display/title improvement from `workspace.yaml.summary` separately from transcript file mtime/size.
- Preserve the existing override precedence in `compose_session_metadata_row(...)` and `resolve_indexed_session_title(...)`.
- Keep identity fields (`id` / local session ID, `provider_session_id`, `project_path`, `worktree_path`, lifecycle state) untouched while allowing non-destructive display upgrades.

**Patterns to follow:**
- `packages/desktop/src-tauri/src/history/commands/scanning.rs` title derivation helpers
- `packages/desktop/src-tauri/src/db/repository.rs` metadata upsert/compose flow

**Test scenarios:**
- Happy path — `workspace.yaml.summary` upgrades a placeholder `Session <id>` display even when `events.jsonl` path/mtime/size are unchanged.
- Happy path — Copilot restart startup metadata returns the upgraded title through `get_for_session_ids()`.
- Edge case — manual title overrides still win over Copilot summary refresh.
- Edge case — if Copilot provides an empty/whitespace summary, the existing stored display remains unchanged.
- Edge case — a non-placeholder stored title is not clobbered by a weaker fallback title.
- Integration — Copilot index refresh updates title without regressing local session ID, provider session ID, project path, or worktree path.

**Verification:**
- Metadata refresh persists the upgraded title without changing local/provider identity fields or depending on a later transcript-file metadata change.

- [ ] **Unit 3: Define a Copilot history-visible replay filter**

**Goal:** Keep Copilot transcript reconstruction limited to user-visible conversation/tool activity and exclude internal artifact updates from restored history entries.

**Requirements:** R3, R4, R6

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src-tauri/src/copilot_history/mod.rs`
- Modify: `packages/desktop/src-tauri/src/copilot_history/parser.rs`
- Test: `packages/desktop/src-tauri/src/copilot_history/mod.rs`
- Test: `packages/desktop/src-tauri/src/copilot_history/parser.rs`

**Approach:**
- Normalize all Copilot restore sources into the same `Vec<(u64, SessionUpdate)>` seam, then add a shared Copilot-specific visibility decision before `ReplayAccumulator` produces `ConvertedSession`.
- Keep user messages, visible assistant content, and canonical tool activity.
- Exclude the replay/update categories proven by Unit 1 to be projection-only/internal artifacts for restored history.
- Apply the same visibility policy to:
  1. direct transcript parsing (`parse_events_from_reader` → replay updates)
  2. journal replay (`load_session_from_journal`)
  3. ACP replay fallback (`collect_replay_updates` / conversion)
- Keep projection/journal data available for session projection/state rebuilding; only transcript reconstruction should narrow the set.

**Patterns to follow:**
- `packages/desktop/src-tauri/src/acp/session_journal.rs` for projection completeness
- `packages/desktop/src-tauri/src/history/commands/session_loading.rs` for session-title/session-load shaping after provider load

**Test scenarios:**
- Happy path — clean user + assistant + tool replay remains intact after filtering.
- Happy path — ordinary Copilot user/assistant/tool replay remains intact after filtering.
- Edge case — artifact-bearing replay input drops the internal chunks/events identified in Unit 1 while preserving the surrounding visible conversation.
- Edge case — transcript reconstruction remains stable whether the source path is direct transcript, journal replay, or ACP replay fallback.
- Edge case — the shared filter keys off normalized update kinds/fields rather than a single observed event ordering, so equivalent artifact classes are removed even if replay order varies slightly.
- Integration — filtered Copilot replay still produces correct tool entry ordering and completion state.

**Verification:**
- Restored Copilot sessions read like the original thread instead of a parser/debug trace.

- [ ] **Unit 4: Thread title and replay hygiene through the unified load path**

**Goal:** Ensure the unified session load/startup/projection paths all consume the same improved Copilot metadata and replay behavior.

**Requirements:** R1, R3, R4, R5

**Dependencies:** Unit 2, Unit 3

**Files:**
- Modify: `packages/desktop/src-tauri/src/copilot_history/mod.rs`
- Modify: `packages/desktop/src-tauri/src/acp/providers/copilot.rs`
- Modify: `packages/desktop/src-tauri/src/history/commands/session_loading.rs`
- Modify: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
- Test: `packages/desktop/src-tauri/src/copilot_history/mod.rs`
- Test: `packages/desktop/src-tauri/src/history/commands/session_loading.rs`
- Test: `packages/desktop/src-tauri/src/acp/commands/tests.rs`

**Approach:**
- Audit the provider-owned Copilot load path so it always asks for the best available display title from metadata before building `ConvertedSession`.
- Ensure session creation/resume and startup hydration paths persist an upgraded title before returning the next startup/opened-session payload when the stored title is still an Acepe placeholder and `workspace.yaml.summary` is already available in the same load path.
- Verify startup history hydration, reopened session loading, and provider-owned projection import all converge on the same title/filter behavior instead of each path having its own fallback.

**Patterns to follow:**
- `packages/desktop/src-tauri/src/history/commands/session_loading.rs`
- `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`

**Test scenarios:**
- Happy path — reopening a Copilot session after restart keeps the upgraded title through the unified load path.
- Happy path — provider-owned load returns a `ConvertedSession` whose title matches the refreshed metadata row.
- Edge case — sessions without transcript files still use ACP fallback without regressing the title or reintroducing artifact spam.
- Integration — missing-transcript ACP fallback coverage exercises `copilot_history` replay conversion and still preserves the upgraded title/clean transcript result.
- Integration — session projection import and unified session load can coexist without title drift between the sidebar/startup view and opened session view.

**Verification:**
- Session list, startup hydration, and opened-session load all agree on the same Copilot title and transcript shape, and the upgraded title is persisted before a later broad rescan would be needed to repair it.

## System-Wide Impact

- **Interaction graph:** Copilot scanner/indexer, metadata repository, provider-owned load, unified session load, and Copilot replay conversion all participate in the fix.
- **Error propagation:** Missing `workspace.yaml` or missing transcript files should continue to degrade gracefully to existing fallback behavior; the fix should not convert title/artifact cleanup into a hard failure.
- **State lifecycle risks:** Metadata refresh must not overwrite title overrides or destabilize provider-session identity. Replay filtering must not remove tool-call updates required for correct completion state.
- **API surface parity:** The fix is Copilot-specific in behavior, but it should preserve the existing provider-owned session-loading contract consumed by shared history commands.
- **Integration coverage:** Restart hydration, sidebar scanning, unified session loading, and projection-backed replay all need end-to-end regression coverage because the bug appears only when these layers interact.
- **Unchanged invariants:** Copilot remains provider-owned for history loading; Acepe still preserves local session IDs, provider session IDs, worktree paths, and ACP fallback semantics.

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| Filtering replay updates removes data needed for correct tool completion/order | Characterization tests must assert both artifact removal and preserved tool/tool-update correctness before the filter ships. |
| Title refresh logic accidentally overwrites explicit user renames | Keep override precedence unchanged and add a regression test that overridden titles never auto-refresh. |
| Fix only patches the indexer, leaving startup/provider load on the placeholder path | Add unified-load coverage so startup metadata, provider load, and reopened sessions all verify the same title outcome. |
| Copilot sessions without `events.jsonl` regress because the change assumes transcript-backed discovery | Preserve the existing missing-transcript marker + ACP replay fallback path and test it explicitly. |

## Documentation / Operational Notes

- If implementation confirms a clean root cause and fix, add a solution doc in `docs/solutions/logic-errors/` after the code lands because this is another restart-persistence boundary bug with durable lessons.
- The debug streaming log remains a diagnostic artifact only; this fix should not depend on debug logging being enabled.

## Sources & References

- **Origin document:** `docs/brainstorms/2026-03-30-github-copilot-cli-agent-requirements.md`
- Related requirements: `docs/brainstorms/2026-04-12-async-session-resume-requirements.md`
- Related code:
  - `packages/desktop/src-tauri/src/history/indexer.rs`
  - `packages/desktop/src-tauri/src/db/repository.rs`
  - `packages/desktop/src-tauri/src/copilot_history/mod.rs`
  - `packages/desktop/src-tauri/src/copilot_history/parser.rs`
  - `packages/desktop/src-tauri/src/history/commands/scanning.rs`
  - `packages/desktop/src-tauri/src/history/commands/session_loading.rs`
- Relevant solution doc: `docs/solutions/logic-errors/worktree-session-restore-2026-03-27.md`
