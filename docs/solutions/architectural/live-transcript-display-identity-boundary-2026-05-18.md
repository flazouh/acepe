---
module: acp-live-transcript-projection
last_updated: 2026-05-18
tags:
  - canonical-transcript
  - display-identity
  - provider-ids
  - compatibility-boundary
  - final-god
problem_type: architecture
---

# Live transcript display identity boundary

## Problem

Some providers can reuse the same assistant `message_id` across different content blocks. In a live stream that can look like:

1. assistant text,
2. tool call,
3. more assistant text with the same provider message id.

If Acepe uses that raw provider id as the visible assistant row id, the last assistant text can be appended above the tool call. The transcript order becomes wrong even though events arrived in the right order.

## Final invariant

Provider assistant message ids are metadata and grouping hints only. They are not display row identity.

Live assistant rows use Acepe-owned deterministic ids such as `assistant-event-{event_seq}`. A user row, tool row, turn completion, cancellation, or error closes the active assistant boundary. After that boundary, the same provider `message_id` must create a new assistant row.

Canonical transcript deltas may append to an existing canonical entry id. Raw provider updates may not rehydrate display lineage by guessing that `message_id == entry_id`.

This boundary rule applies to both inputs into the live projection:

- direct `SessionUpdate` events,
- replayed or externally applied `TranscriptDelta` operations.

If a canonical delta appends a user, tool, or error row, it must close any active live assistant boundary before later raw provider chunks are processed.

## Correct flow

```text
provider live update
  -> Rust transcript projection
  -> canonical transcript operation with Acepe-owned entry id
  -> TypeScript store applies snapshot/delta
  -> UI renders canonical entries
```

The UI must not fix transcript order. TypeScript must not decide whether repeated provider ids are one row or two rows. That decision belongs in Rust before display projection.

## Compatibility boundary

Legacy compatibility transcript writers may still exist for tests and old raw-lane coverage, but they must not be public product APIs.

Current rule:

- `SessionStore` exposes canonical snapshot/delta behavior and narrow selectors.
- `SessionEntryStore` compatibility writers are private.
- Tests that need compatibility behavior must go through explicit helpers in `entry-store-test-access.ts`.
- Production code should use `replaceTranscriptSnapshot(...)` and `applyTranscriptDelta(...)` for transcript truth.

The old TypeScript `MessageProcessor` raw-event converter is deleted. Do not rebuild a generic `SessionUpdate -> ThreadEntry` path in TypeScript. If compatibility tests need chunk merging, keep that helper narrowly named and scoped to compatibility behavior only.

`SessionStore` must not expose a public raw `handleSessionUpdate(...)` mutation method. The raw update subscription belongs to `SessionEventService`, and that service treats assistant/user/tool transcript-shaped raw events as diagnostic or coordination input only.

The old compatibility assistant/user chunk aggregation stack is deleted too. TypeScript must not keep provider-message-id assistant grouping state, message-id entry indexes, or helper names such as `ChunkAggregator`, `chunk-action-resolver`, or `aggregateCompatibilityAssistantChunk(...)`.

The old assistant streaming lifecycle hooks are deleted too. TypeScript must not expose or call `startNewAssistantTurn(...)` or `clearStreamingAssistantEntry(...)`; assistant row boundaries are canonical transcript facts, not frontend reset operations.

## Historical replay boundary

The Claude JSONL history parser may use provider `message.id` as a narrow merge hint only for compatible assistant text/thinking fragments. A tool-use block breaks that merge boundary, even when later assistant rows reuse the same `message.id` and `requestId`.

Historical canonical events must keep two ids separate:

- `provider_msg_id`: copied metadata from the provider row.
- `display_id`: Acepe-owned display identity from the parser row id, split assistant segment id, or `tool_use.id` for tool rows.

Provider ids may repeat. Display ids must represent the canonical visible row.

This applies to OpenCode too. OpenCode `msg.id` stays in `provider_row_id` and `provider_msg_id`; text rows use Acepe-owned order ids such as `opencode-event-1:assistant`, and tool rows use the promoted `tool_call_id` as display identity.

## Regression checks

When touching live transcript projection or compatibility writers, run:

```bash
cd packages/desktop/src-tauri && cargo test transcript_projection --quiet
cd packages/desktop && bun run check
cd packages/desktop && bun test ./src/lib/acp/store/__tests__/session-entry-store-streaming.vitest.ts ./src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts src/lib/acp/store/services/__tests__/session-messaging-service-stream-lifecycle.test.ts
```

Useful scan:

```bash
rg -n "return provider_key|insert\\(scoped_key, provider_key|stateReader\\.getHotState|\\.aggregateCompatibilityAssistantChunk\\(|\\.aggregateCompatibilityUserChunk\\(" packages/desktop/src packages/desktop/src-tauri/src
```

Expected result: no raw provider key fallback in live assistant display identity, no broad `stateReader.getHotState`, and no public production calls to compatibility chunk aggregation.

Raw-lane cleanup scan:

```bash
rg -n "MessageProcessor|processUpdate\\(|export \\{ MessageProcessor \\}|store\\.handleSessionUpdate\\(" packages/desktop/src/lib/acp -g '!**/__tests__/**' -g '!**/*.test.ts' -g '!**/*.vitest.ts'
```

Expected result: no matches.

Provider-message-id aggregation cleanup scan:

```bash
rg -n "ChunkAggregator|chunk-action-resolver|chunk-aggregation-types|aggregateCompatibilityAssistantChunk|aggregateCompatibilityUserChunk|getMessageIdIndex|addMessageId|deleteMessageId|rebuildMessageIdIndex" packages/desktop/src/lib/acp -g '!**/__tests__/**' -g '!**/*.test.ts' -g '!**/*.vitest.ts'
rg -n "startNewAssistantTurn|clearStreamingAssistantEntry" packages/desktop/src/lib/acp/store -g '*.ts' -g '*.svelte'
```

Expected result: no matches.

Historical replay cleanup scan:

```bash
rg -n "stable Claude message\\.id|same provider id means same display|provider_msg_id.*display_id" packages/desktop/src-tauri/src docs/solutions -g '!docs/solutions/architectural/live-transcript-display-identity-boundary-2026-05-18.md'
rg -n "opencode:\\{\\}:user|opencode:\\{\\}:assistant|display_id: String::new\\(\\)|opencode:.*:assistant|opencode:.*:user" packages/desktop/src-tauri/src/session_converter packages/desktop/src-tauri/src/acp -g '*.rs'
```

Expected result: no wording that promotes provider message ids to display identity.

## Related

- `docs/plans/2026-05-18-003-refactor-live-transcript-identity-boundary-plan.md`
- `docs/plans/2026-05-18-004-refactor-raw-session-update-diagnostic-boundary-plan.md`
- `docs/plans/2026-05-18-005-refactor-delete-compatibility-chunk-aggregation-plan.md`
- `docs/plans/2026-05-18-006-refactor-history-parser-provider-id-boundary-plan.md`
- `docs/plans/2026-05-18-007-refactor-opencode-canonical-display-identity-plan.md`
- `docs/plans/2026-05-18-008-refactor-delete-obsolete-assistant-streaming-hooks-plan.md`
- `docs/solutions/best-practices/canonical-ui-session-selector-boundary-2026-05-18.md`
- `docs/solutions/architectural/final-god-architecture-2026-04-25.md`
