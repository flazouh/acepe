# Fix Claude subagent text parent attribution

Date: 2026-07-07

## Problem

Claude Code subagent assistant text can leak into the parent assistant transcript row. The raw Claude messages carry `parent_tool_use_id`, but Acepe's canonical agent text update does not currently preserve that parent id for `AgentMessageChunk` or `AgentThoughtChunk`.

That makes this a canonical transcript bug, not a Svelte rendering bug.

Observed failure shape:

```text
Parent assistant row
  "This confirms the exact wiring..."
  + subagent report text  <-- wrong

Task tool row
  "Find new chat modal project trigger"
  collapsed task card     <-- should own/suppress subagent text
```

## GOD Check

The fix moves truth upstream:

```text
Claude raw message / stream event
  -> Rust cc_sdk bridge keeps parent_tool_use_id
  -> Rust SessionUpdate carries parent_tool_use_id on agent text/thought
  -> Rust transcript projection does not append subagent text to main transcript
  -> UI renders canonical rows only
```

No TypeScript fallback, provider-specific Svelte branch, or display-row repair is allowed.

## Scope

- Widen Rust `SessionUpdate::AgentMessageChunk` and `SessionUpdate::AgentThoughtChunk` with optional `parent_tool_use_id`.
- Preserve the field through:
  - Claude Code SDK assistant-message translation.
  - Claude Code SDK stream-event translation.
  - ACP session-update deserialization.
  - Projection journal serialization/replay.
- Key Claude SDK stream text/thinking-delta dedupe and streamed tool-input block state by parent lineage (`None` for top-level, `Some(parent_tool_use_id)` for subagents), so subagent deltas cannot suppress parent fallback text or collide on content block indexes.
- Update live transcript projection so assistant text/thought with a parent tool id does not create or append to the top-level assistant row.
- Update historical Claude JSONL materialization so assistant messages with `parent_tool_use_id` are not projected as top-level assistant transcript events.
- Bump the transcript-row ledger projection version so already-persisted bad viewport rows rebuild instead of being trusted.
- Rebuild stale row ledgers from provider-owned history before local journal fallback when the app can load provider history; old local journals may already be lossy.
- Sync generated TypeScript session-update types if the repo expects checked-in generated output.

## Tests

Red tests first:

- `cc_sdk_bridge` test: subagent assistant text emits `AgentMessageChunk { parent_tool_use_id: Some(task_id) }`.
- `cc_sdk_bridge` test: subagent stream `text_delta` emits `AgentMessageChunk { parent_tool_use_id: Some(task_id) }`.
- `cc_sdk_bridge` test: a subagent stream delta does not suppress the top-level assistant final text fallback.
- `transcript_projection` test: a parent assistant chunk, Task tool call, and subagent assistant chunk do not merge the subagent text into the parent assistant row.
- `session_converter::transcript_events` test: Claude historical assistant text with `parent_tool_use_id` is omitted from top-level canonical transcript events while the Task tool row remains.
- Journal round-trip test if adding the field to `ProjectionJournalUpdate`.
- Existing row-ledger stale/read tests should continue to prove that a version mismatch rebuilds the viewport rows.

## Verification

Run focused checks:

```bash
cd packages/desktop/src-tauri
cargo test cc_sdk_bridge transcript_projection session_converter --quiet

cd ../
bun run check
```

Because the bug is UI-visible, run the Acepe QA wrapper after the code change:

```bash
cd packages/desktop
bun run qa doctor
bun run qa observe
bun run qa inspect --selector=[data-testid="rust-transcript-viewport"]
bun run qa screenshot
```

If the exact JSONL session is not available in the running app, QA may only prove that the dev app renders canonical transcript rows without runtime errors; the Rust tests are the behavioral proof for the regression.

## Out Of Scope

- Redesigning task-card expansion or nested subagent report UI.
- Rendering subagent narration inside the collapsed Task row. This slice journals the attribution and suppresses it from the top-level transcript; task-row narration can be added later from canonical parent-linked chunks.
- Hiding empty assistant rows unless the new tests expose the same seam naturally.
- Reworking provider history identity beyond the parent attribution path.
