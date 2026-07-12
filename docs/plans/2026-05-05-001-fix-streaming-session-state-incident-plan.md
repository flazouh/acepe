---
title: fix: Repair streaming transcript state and reveal continuity
type: fix
status: active
date: 2026-05-05
origin: .planning/debug/streaming-session-state-incident.md
---

# fix: Repair streaming transcript state and reveal continuity

## Overview

Fix the streaming incident found during QA where raw provider logs contain the full assistant answer, but Acepe can show only the first chunk such as `Ra`, and created sessions cannot reliably rebuild assistant text from local durable state.

This plan covers two related but separate failures:

- **Live render failure:** no-message-id streams can create adjacent assistant entries that merge into one visual row, while reveal state stays pinned to the first assistant entry.
- **Durable state failure:** assistant chunks are live runtime transcript state but not durable journal state, so created provider-owned sessions can lose transcript recoverability after runtime memory is gone or after a snapshot refresh cannot replay provider history.

Related QA findings about title persistence and confusing empty session shells are tracked as follow-up work below. They are real issues, but they are not required to close the streaming transcript incident.

Execution should be TDD-first. Write the failing characterization tests before changing behavior.

## Problem Frame

The raw streaming logs prove providers sent complete text. For example, `86780b10-df6f-45cb-92e3-413ae4efb691` starts with `Ra`, then sends the rest of a 941-character answer. The observed UI stuck at `Ra` is therefore an Acepe state/render bug, not a provider output bug.

The DB tells a second story: affected created sessions exist in `session_metadata` and `acepe_session_state`, but their `session_journal_event` rows contain only materialization barriers and `turn_complete` projection updates. Assistant chunks are not journaled by current design. Live streaming can still work through in-memory transcript deltas, but resume/refresh can fall back to empty or incomplete transcript snapshots.

## Requirements Trace

- R1. Live streaming rows must keep growing when chunks arrive, even when chunks have no stable provider `message_id`.
- R2. A row that already showed non-empty assistant text must not collapse to blank or a tiny old first chunk while canonical text has advanced.
- R3. Adjacent assistant entries created by chunk streams must have reveal state that represents the merged visible row, not only the first member.
- R4. Created sessions must have a durable transcript source that can rebuild assistant text after runtime memory is gone.
- R5. Session-state snapshot refresh must not replace a healthy visible transcript with an empty or older transcript.
- R6. Raw streaming logs remain debug evidence only; product state should not depend on reading debug JSONL files.
- R7. Debug streaming JSONL must stay outside product replay. If it remains enabled in debug builds, it must be local-only and must not become the recovery path.

Follow-up requirements, not incident-blocking:

- F1. Provider title updates should persist to session metadata/state when available.
- F2. Failed or cancelled first-send/session-creation attempts should not leave confusing empty created sessions.

## Scope Boundaries

- No live webview QA automation in this implementation plan. Tauri MCP interaction currently steals focus; use unit/integration tests and disk evidence first.
- No fallback that lets raw frontend chunks become a second product authority. Raw chunks can be diagnostic, but canonical/session-state must remain the product path.
- No broad rewrite of provider adapters.
- No UI redesign.
- No title persistence or failed-session cleanup in this incident slice. Those need their own reviewed plan unless implementation proves they directly block transcript recovery.
- No accepting partial implementation as done. The incident fix is complete only when live streaming, refresh/reopen, and durable rebuild behavior all have tests and a short human QA check.

## Context And Evidence

Origin documents:

- `.planning/debug/streaming-session-state-incident.md`
- `docs/reports/2026-05-05-streaming-qa-incident-report.md`

Important files:

- `packages/desktop/src/lib/acp/components/agent-panel/logic/assistant-reveal-coordinator.svelte.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/logic/virtualized-entry-display.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/assistant-reveal-coordinator.test.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/virtualized-entry-display.test.ts`
- `packages/desktop/src/lib/acp/store/session-event-service.svelte.ts`
- `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
- `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts`
- `packages/desktop/src/lib/acp/session-state/session-state-query-service.ts`
- `packages/desktop/src-tauri/src/acp/projections/mod.rs`
- `packages/desktop/src-tauri/src/acp/session_journal.rs`
- `packages/desktop/src-tauri/src/acp/transcript_projection/runtime.rs`
- `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs`
- `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
- `packages/desktop/src-tauri/src/db/repository.rs`

Useful facts:

- `ProjectionJournalUpdate::from_session_update` excludes assistant/user chunks.
- Frontend `SessionEventService` records raw assistant chunks and then returns early; visible transcript depends on session-state envelopes.
- `projections/mod.rs` only sets `last_agent_message_id` when an assistant chunk has `message_id`.
- Temporary repro showed the no-message-id sequence `[user] -> [user, "Ra"] -> [user, "Ra", "incoats..."]` keeps merged reveal state at `"Ra"`.

## Key Decisions

- **Fix no-message-id reveal in the display/reveal layer.** When adjacent assistant scene entries merge, active reveal state must track the latest merged assistant content, not stay pinned to the first assistant member.
- **Prove the backend/frontend contract before changing reveal logic.** First verify what `message_id`, synthetic identity, and `lastAgentMessageId` values reach the frontend for the affected provider path. If Rust normalization should prevent no-message-id frontend rows, fix or test that boundary before adding frontend-only handling.
- **Keep canonical/session-state as product authority.** Do not make frontend raw chunks update visible transcript directly. That would create another split-brain path.
- **Make assistant transcript durable in Acepe's journal with explicit completeness.** Persist transcript-bearing user/assistant updates as local journal payloads. Local transcript replay is authoritative only for turns that have a matching local terminal marker, such as `turn_complete` or `turn_error`, and a journal high-watermark proving coverage. Partial local transcript state must merge with provider-owned history instead of suppressing it.
- **Make durable replay deterministic.** Transcript journal payloads must include stable ordering and idempotency fields: session id, turn or attempt id, role, optional provider event id, optional provider `message_id`, local monotonic chunk sequence, append/content mode, and enough information to deduplicate replayed chunks.
- **Guard snapshot refresh with a trust contract, not only text richness.** Preserve current transcript only when the incoming snapshot is older, incomplete, or explicitly marked fallback. A newer durable snapshot may be shorter and still correct.

## Review Gate Resolution

The plan review found three blocking issues and the plan has been revised to resolve them before implementation:

- The incident scope is narrowed to Units 1-4. Title persistence and failed-session cleanup moved to follow-up work.
- Durable transcript replay now requires per-turn completeness markers, deterministic ordering, idempotency rules, and tests for partial crash recovery.
- Snapshot refresh protection now requires source-aware revision rules and a follow-up-delta test after a mixed graph/transcript state.

No auto-fixes were applied by the review tool. These changes are manual resolutions of the reviewer findings.

## Implementation Units

### Unit 1: Prove the chunk identity boundary, then fix no-message-id reveal pinning

Goal: Live rows keep growing when assistant chunks do not have stable `message_id`.

Files:

- Modify tests in `packages/desktop/src-tauri/src/acp/ui_event_dispatcher.rs`
- Modify tests in `packages/desktop/src-tauri/src/acp/projections/mod.rs`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/assistant-reveal-coordinator.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/virtualized-entry-display.ts` if merge-level state needs adjustment.
- Test: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/assistant-reveal-coordinator.test.ts`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/virtualized-entry-display.test.ts`

Test-first scenarios:

- Add a Rust boundary test that proves what identity values reach transcript projection and session-state envelopes when the provider chunk has no `message_id`.
- If Rust should synthesize stable IDs, assert no no-message-id frontend path remains and fix the Rust path first.
- If no-message-id frontend chunks are valid by design, name that path in the test and continue with the frontend reveal fix.
- Reproduce `[user] -> first no-message-id assistant chunk -> second no-message-id assistant chunk` and assert merged visible text grows beyond `Ra`.
- Assert `instant` mode shows the merged current target for no-message-id chunks.
- Assert `smooth` mode stays non-empty and advances from the first chunk toward the merged target.
- Assert stable `message_id` streams still use the existing single-assistant-key path.
- Assert a new user turn after a no-message-id stream does not keep revealing stale prior assistant text.

Likely approach:

- Teach the coordinator or display merge layer to treat adjacent assistant entries after the pending user as one live reveal target when `lastAgentMessageId` is null.
- Use the merged assistant row's semantic key as the reveal key, or explicitly move the active target to the newest assistant member represented by the merged row.
- Keep the rule that cold completed history renders final text immediately.

Verification:

- Targeted Rust boundary test passes.
- Focused Bun tests for assistant reveal and virtualized display pass.

### Unit 2: Characterize live session-state deltas independently of journal durability

Goal: Prove the Rust live path emits transcript-bearing session-state envelopes for assistant chunks, independent of whether those chunks are also persisted later.

Files:

- Modify tests in `packages/desktop/src-tauri/src/acp/ui_event_dispatcher.rs`
- Modify tests in `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs` if needed.

Test-first scenarios:

- For two assistant chunks with no `message_id`, `persist_dispatch_event` emits transcript operations that append/grow assistant transcript state in order.
- For two assistant chunks with the same `message_id`, transcript operations append segments to one assistant entry.
- `turn_complete` after pending batch flush must not be the only product-state event visible to frontend.
- Live transcript deltas must not inflate graph revision. Transcript revision and graph revision remain separate.

Likely approach:

- Keep the current synthetic live delta path if it is correct.
- Add missing tests to lock it down.
- If tests show envelopes are missing for any chunk shape, fix the Rust envelope construction or batching path.

Verification:

- Targeted `cargo test` for dispatcher/runtime registry passes.

### Unit 3: Add durable transcript authority for created sessions

Goal: Created sessions can rebuild assistant text from local durable state after runtime memory is gone.

Files:

- Modify: `packages/desktop/src-tauri/src/acp/session_journal.rs`
- Modify: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
- Modify: `packages/desktop/src-tauri/src/db/repository.rs`
- Possibly modify: `packages/desktop/src-tauri/src/acp/transcript_projection/runtime.rs`
- Test: existing Rust tests near journal replay/resume/session state.

Test-first scenarios:

- A created session with assistant chunks can rebuild a transcript from DB after creating a fresh runtime registry.
- Rebuild preserves assistant text order for many chunks.
- Rebuild handles no-message-id chunks without creating one unusable row per token in final completed history.
- Rebuild handles stable `message_id` chunks as one assistant message.
- Replay is idempotent when the same chunk payload is persisted or replayed twice.
- Crash-before-`turn_complete` does not make a partial local transcript suppress provider-owned history.
- Journal replay does not duplicate assistant text after provider-owned history is also available.
- Old barrier-only sessions still load without corrupting transcript state.
- Transcript revision values are deterministic after replay and remain separate from graph revision values.

Likely approach:

- Add a durable transcript-bearing journal payload for user and assistant text chunks. Do not use raw streaming JSONL as product data.
- Define the payload before coding: session id, turn or attempt id, role, optional provider event id, optional provider `message_id`, local monotonic chunk sequence, append/content mode, and content.
- Rebuild transcript projection from local transcript journal payloads up to the last locally complete turn.
- A local turn is complete only when transcript payloads and a terminal marker agree for that turn or attempt.
- If local coverage is partial, merge provider-owned history with local rows using stable dedupe keys instead of skipping provider history.
- Keep projection journal payloads for permission/question/turn terminal events separate from transcript payloads unless implementation finds a cleaner type-safe combined representation.
- Consider a later compaction task for very long transcripts; do not make compaction part of the first correctness fix.

Verification:

- Rust replay/resume tests prove transcript survives runtime restart.

### Unit 4: Protect frontend snapshot refresh from transcript regression

Goal: A late or fallback snapshot cannot replace current visible transcript with empty/older transcript.

Files:

- Modify: `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/session-state/session-state-query-service.ts` if routing should detect this earlier.
- Test: `packages/desktop/src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts`
- Test: `packages/desktop/src/lib/acp/session-state/session-state-query-service.test.ts`

Test-first scenarios:

- Current transcript revision with entries is preserved when an incoming snapshot has the same or lower transcript revision.
- Current transcript is preserved when incoming snapshot has higher graph revision but empty or incomplete transcript from fallback refresh.
- A genuinely newer transcript snapshot still replaces current entries.
- After preserving current transcript across a fallback graph refresh, the next valid transcript delta or full transcript snapshot is accepted.
- Refresh mismatch logs a useful warning with session ID and revisions.

Likely approach:

- Strengthen existing `shouldReplaceTranscriptSnapshot` checks to protect against fallback snapshots when current transcript has a trusted newer transcript revision or higher journal high-watermark.
- Preserve graph/lifecycle updates while carrying forward the current transcript snapshot, matching the existing `graphWithTranscriptSnapshot` pattern.
- Record the invariant in tests: graph revision can advance while transcript revision is carried forward, and future transcript updates compare against the carried-forward transcript revision.

Verification:

- Focused Vitest/Bun tests pass.

## Follow-Up Work

These are not part of the incident-blocking implementation. They should get separate reviewed plans if we decide to ship them.

### Follow-up 1: Persist session title updates

Provider `session_info_update` titles should update visible session metadata. A follow-up plan must name the title source of truth, the parser/update type, the Rust persistence hook, the frontend reload path, and conflict rules between provider titles, local titles, and user-edited titles.

### Follow-up 2: Clean up failed created-session shells

Failed or blocked first-send attempts should not leave confusing empty created sessions. A follow-up plan must split local preflight failures from provider-created failures and define when cleanup means hard delete versus a failed tombstone that preserves provider session identity.

### Follow-up 3: Raw streaming debug log retention

Raw streaming JSONL files contain transcript text and must remain debug-only. A follow-up plan should define whether they are enabled outside debug mode, local file permissions, retention cleanup, and redaction expectations.

### Follow-up 4: Transcript journal compaction

Very long sessions may need transcript journal compaction later. This incident fix prioritizes correctness and deterministic replay first.

## QA Plan

Automated:

- `cd packages/desktop && bun test src/lib/acp/components/agent-panel/logic/__tests__/assistant-reveal-coordinator.test.ts src/lib/acp/components/agent-panel/logic/__tests__/virtualized-entry-display.test.ts`
- `cd packages/desktop && bun run check`
- Targeted Rust tests for dispatcher, journal, resume, and session-state engine.
- Full `cd packages/desktop && bun test` after TypeScript changes.

Manual, only after automated tests pass:

- Use existing app manually, not MCP screenshot loops, to avoid focus stealing.
- Send a no-message-id-capable provider prompt that streams raincoat text slowly.
- Confirm exactly one assistant row grows past the first chunk and does not duplicate nearby rows.
- Confirm smooth reveal never collapses to blank or back to the first chunk after non-empty text is visible.
- Confirm instant reveal mode shows the current merged target text.
- Confirm final answer remains after switching sessions and reopening/restarting.
- Check DB/session state can rebuild transcript after restart or simulated runtime registry reset.

Incident-blocking acceptance criteria:

- Unit 1 proves the backend/frontend identity contract and fixes the original `Ra` live reveal failure.
- Unit 2 proves live transcript envelopes are emitted before terminal turn events.
- Unit 3 proves DB-backed transcript replay after runtime restart, including partial-crash and idempotency cases.
- Unit 4 proves fallback snapshot refresh cannot erase or permanently desync transcript state.
- Focused and full verification commands pass.
- Human desktop QA confirms the visible app no longer gets stuck at the first chunk.

## Open Questions

- For no-message-id streams, should canonical transcript projection also coalesce chunks earlier in Rust after the frontend reveal fix? This is deferred unless tests show frontend merge-level handling is not enough.
- Should durable transcript journal rows later be compacted into snapshots for very long sessions? Deferred; correctness comes first.
- What is the long-term provider-history contract for `__session_registry__/<id>` created sessions? For this fix, local transcript journal state is authoritative only for locally complete turns.

## Done Criteria

- No-message-id streaming cannot get stuck at the first chunk.
- Same-key rewrites cannot blank or shrink visible text backwards.
- Created sessions can recover assistant transcript from local durable state after runtime restart.
- Partial local transcript state does not suppress provider replay.
- Snapshot refresh cannot erase or permanently desync trusted current transcript state.
- Focused and full verification commands pass.
- Human desktop QA confirms the visible app no longer gets stuck at the first chunk.
