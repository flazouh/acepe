---
title: "refactor: Canonical transcript event materialization"
type: refactor
status: reviewed
date: 2026-05-17
origin: "/Users/alex/Library/Application Support/Acepe/logs/streaming/b859c458-ca4f-4c31-a3aa-6c606a1c065f.jsonl"
depends_on:
  - docs/plans/2026-05-17-001-refactor-single-session-materialization-engine-plan.md
  - docs/plans/2026-05-06-002-refactor-canonical-transcript-event-authority-plan.md
  - docs/solutions/architectural/final-god-architecture-2026-04-25.md
---

# Refactor: Canonical Transcript Event Materialization

## Goal

Fix the Claude Code reused assistant `message.id` ordering bug by making transcript order and identity come from Acepe-owned canonical events, not raw provider message ids.

For the same provider history, Acepe must always produce the same canonical transcript:

```text
user -> tool_call -> tool_call -> assistant
```

when the provider evidence says that is the real order. The UI must receive that order already correct.

## Bug

The failing fixture comes from:

```text
/Users/alex/Library/Application Support/Acepe/logs/streaming/b859c458-ca4f-4c31-a3aa-6c606a1c065f.jsonl
```

Claude Code can write several assistant JSONL rows with the same provider `message.id`.

Simplified shape:

```text
row 1: assistant text, message.id = msg_abc
row 2: tool_use,       message.id = msg_abc
row 3: tool_use,       message.id = msg_abc
```

Current parser behavior:

```text
same message.id -> merge rows into one OrderedMessage
merged blocks    -> [text, tool_use, tool_use]
display entries  -> [assistant, tool_call, tool_call]
```

That is wrong because `message.id` is not an Acepe display id. It is provider metadata. The two tool calls become the last visible rows even though the model-facing assistant text is the meaningful closing message.

## Root Cause

The bad source path is:

```text
Claude JSONL
  -> session_jsonl/parser/full_session.rs
  -> assistant_merge_key(message.id/requestId)
  -> merged OrderedMessage.content_blocks
  -> session_jsonl/parser/convert.rs
  -> StoredEntry display-like rows
  -> TranscriptSnapshot::from_stored_entries
  -> UI scene
```

Specific issue:

- `assistant_merge_key` treats provider `message.id` as a stable merge key.
- `existing.content_blocks.extend(content_blocks)` mixes semantic blocks from different provider rows.
- `convert_assistant_message` then flushes assistant text before tool calls when it sees merged blocks.
- Later layers can only render the already-wrong order.

This is an authority bug, not a Svelte bug.

## GOD Architecture Decision

The fix must move truth upstream into Rust-owned canonical data.

Correct flow:

```text
Provider raw history
  -> provider history adapter
  -> CanonicalTranscriptEvent[]
  -> SessionStateGraph transcript_snapshot + operation graph
  -> pure display projection
  -> UI
```

Wrong flow:

```text
Provider raw history
  -> parser guesses display rows
  -> UI repairs order
```

## Identity Rules

| Raw or canonical id | Meaning | May order transcript? | May identify display row? |
| --- | --- | --- | --- |
| Claude `message.id` | Provider assistant container id | No | No |
| JSONL `uuid` | Provider row id | Only as source evidence | No |
| `tool_use.id` | Provider tool call id | No | Only for operation/tool identity |
| `transcript_seq` | Acepe canonical transcript order | Yes | No |
| `journal_event_seq` | Acepe delivery/frontier event id | No | No |
| `display_id` | Acepe-owned stable display id | No | Yes |

## Canonical Event Shape

Add or widen the backend canonical transcript evidence model so it can represent provider rows before display projection.

```text
CanonicalTranscriptEvent
+------------------------------------------------+
| session_id                                     |
| transcript_seq   // strict transcript order    |
| journal_event_seq // optional delivery seq     |
| source           // claude_code, codex, cursor |
| provider_row_id  // JSONL uuid / DB row id     |
| provider_msg_id  // msg_abc, metadata only     |
| block_index      // order inside provider row  |
| kind             // user_text / assistant_text |
|                  // assistant_thought / tool   |
| display_id       // Acepe-owned stable id      |
| tool_call_id     // only for tools: toolu_123  |
| payload          // text, args, result, etc.   |
+------------------------------------------------+
```

`transcript_seq` can be derived from provider row order plus `block_index` for historical provider history. It must be stable for the same input. It must not use wall-clock time, random ids, local array insertion races, or UI render order.

`journal_event_seq` is different. It is a delivery/frontier id used to reconnect and replay live updates. It must not be used as the only transcript ordering authority because historical provider history can exist before Acepe has a journal event for every block.

## Scope

In scope:

- Claude Code historical JSONL parsing.
- Canonical transcript event construction.
- Conversion from canonical transcript events to `TranscriptSnapshot`.
- Operation linking for tool events by `tool_use.id`.
- Stable Acepe-owned `display_id` generation.
- Historical open, reconnect, and state lookup paths that publish `SessionStateGraph`.
- Removal of direct provider-history-to-display parsing for this path.
- Tests that prove reused provider `message.id` does not affect transcript order.

Out of scope:

- UI visual redesign.
- Making historical sessions read-only.
- Keeping an old and new transcript path alive forever.
- Provider-specific logic in TypeScript.
- Sorting, filtering, or repairing transcript rows in Svelte.

## Existing Red Test

A failing characterization test already exists:

```text
packages/desktop/src-tauri/src/session_jsonl/parser/tests.rs
test_parse_converted_session_keeps_reused_id_final_text_after_late_tool_fragments
```

It currently proves the bug:

```text
expected: ["user", "tool_call", "tool_call", "assistant"]
actual:   ["user", "assistant", "tool_call", "tool_call"]
```

During implementation, keep this test red until the canonical path is wired. If the final seam moves out of `session_jsonl/parser`, replace it with an equivalent backend materialization test. Do not delete the behavior proof.

## Implementation Plan

### 1. Introduce canonical transcript evidence types

Create or widen Rust types near the backend materialization boundary:

```text
packages/desktop/src-tauri/src/acp/session_materialization/
packages/desktop/src-tauri/src/acp/transcript_projection/
```

The types must keep raw provider ids as source metadata and expose Acepe-owned identity for product use.

Required fields:

- session id
- canonical sequence
- optional journal sequence
- provider source
- provider row id
- provider message id
- block index
- kind
- display id
- tool call id for tool events
- payload

### 2. Add a Claude JSONL history adapter

Move Claude-specific row/block interpretation into a Rust provider/history adapter.

Rules:

- Each provider row becomes one or more canonical transcript events.
- `message.id` is copied to `provider_msg_id` only.
- `tool_use.id` becomes `tool_call_id`.
- Tool-only rows are not merged into assistant text rows only because `message.id` matches.
- Text and thought fragments may be combined only when they represent the same canonical assistant display entry and do not cross a tool event boundary.

Minimum behavior for the known bug:

```text
row order + block index decides event order
same message.id does not collapse text and tools into one display entry
```

For live events, the adapter should assign `transcript_seq` from the same canonical reducer that handles historical events. `journal_event_seq` still controls delivery and dedupe, but it is not a display id and not a provider identity.

### 3. Project canonical events into `TranscriptSnapshot`

Build `TranscriptSnapshot` from canonical events, not from display-like `StoredEntry` rows.

Rules:

- Preserve canonical event order.
- Use `display_id` for transcript entry ids.
- Merge adjacent compatible assistant text/thought events only when the canonical event model says they share the same `display_id`.
- Create one tool transcript row per tool event.
- Do not dedupe tool rows by provider `message.id`.

### 4. Link operations from canonical tool events

For every canonical tool event:

- create or link an `OperationSnapshot`
- use `tool_call_id` for provider tool identity
- use `display_id` or source link for transcript row linking
- create a typed degraded backend operation if provider evidence is incomplete

The UI may render a degraded operation. It must not invent one.

### 5. Route materialization entry points through the canonical path

Use the canonical event path for:

- historical open
- reconnect after historical open
- `acp_get_session_state`
- resume from persisted provider history

This should align with `docs/plans/2026-05-17-001-refactor-single-session-materialization-engine-plan.md`.

`session_jsonl/parser/convert.rs` should stop being the semantic source for restored transcript order. It can remain only as a compatibility wrapper around canonical materialization while old callers are removed.

Any compatibility wrapper must have one direction only:

```text
canonical transcript events -> legacy DTO shape
```

It must never parse provider history itself or repair canonical output.

### 6. Remove UI semantic repair

Keep TypeScript as a pure projection layer:

```text
SessionStateGraph -> AgentPanelSceneModel
```

Remove or prevent:

- UI ordering repair.
- provider-specific branches in TypeScript.
- fallback operation lookup by raw provider ids.
- synthetic "looks okay" transcript rows for missing backend facts, except live pending presentation explicitly marked by backend state.

### 7. Delete old authority paths

Search and remove or rewrite paths that still:

- parse provider history directly into visible `StoredEntry` order
- use `message.id` as assistant display identity
- use `message.id` as a merge key for tool rows
- restore a graph from one path and repair it from another path
- make `acp_get_session_state` a hidden repair writer

## Tests

### Rust tests

Add focused tests for:

- Claude reused `message.id` with final assistant text after late tool fragments.
- Same fixture materializes the same transcript order every run.
- Tool calls use `tool_use.id`, not `message.id`.
- `provider_msg_id` is preserved as metadata.
- `display_id` is Acepe-owned and stable.
- `TranscriptSnapshot` order equals canonical event order.
- Historical open and `acp_get_session_state` produce the same transcript snapshot.
- Reconnect after historical open only accepts post-frontier live events.
- Incomplete tool evidence becomes a backend degraded operation.

### TypeScript tests

Add or update graph materializer tests for:

- UI renders graph transcript order exactly as received.
- UI does not sort assistant/tool rows.
- UI renders backend degraded operations.
- UI does not resolve missing tool rows by provider ids.

## Verification Commands

Focused Rust:

```bash
cd packages/desktop/src-tauri
cargo test test_parse_converted_session_keeps_reused_id_final_text_after_late_tool_fragments
cargo test acp::session_materialization
cargo test acp::transcript_projection
cargo test acp::session_open_snapshot
```

Focused TypeScript:

```bash
cd packages/desktop
bun test src/lib/acp/session-state/__tests__/agent-panel-graph-materializer.test.ts
bun run check
```

## Done Criteria

- The known red test is green through canonical materialization.
- Claude reused `message.id` cannot make assistant text and tools share display identity.
- `message.id` is metadata only.
- Historical open, reconnect, resume, and state lookup use the same canonical transcript result.
- UI renders the canonical order without repair.
- No provider-specific transcript ordering logic exists in TypeScript.
- No direct provider-history-to-display path remains for the restored session path.
- `bun run check` passes after TypeScript changes.
- Focused Rust tests pass.

## Manual Document Review

Status: passed after revisions.

Review must check:

- Does the plan fix the actual root cause instead of the symptom?
- Does it preserve historical reconnect after snapshot hydration?
- Does it avoid a long-lived dual authority system?
- Are ids separated clearly enough for a junior developer to implement safely?
- Are tests behavior-based, not source-string tests?

Findings resolved:

- **Sequence naming was too loose.** The draft used `event_seq` for transcript order, but Acepe already uses event sequence for journal delivery. The plan now separates `transcript_seq` from `journal_event_seq`.
- **Compatibility wrapper risk was unclear.** The draft allowed a wrapper around `session_jsonl/parser/convert.rs`; it now says wrappers may only project canonical events into old DTOs, never parse or repair provider history.
- **Reconnect boundary stayed explicit.** Historical reconnect remains required after snapshot hydration, but reconnect uses frontier/delivery metadata only. It does not decide transcript meaning.

Verdict: ready for implementation through the CE work phase.
