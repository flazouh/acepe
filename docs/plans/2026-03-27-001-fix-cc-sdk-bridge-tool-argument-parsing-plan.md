---
title: "fix: Parse tool arguments in cc_sdk_bridge instead of passing raw JSON"
type: fix
status: active
date: 2026-03-27
---

# fix: Parse tool arguments in cc_sdk_bridge instead of passing raw JSON

## Overview

The cc_sdk_bridge translation layer creates tool calls with untyped `ToolArguments::Other { raw }` and `kind: None`, bypassing the parser pipeline that all other agent parsers use. This causes tool call components to fail to display file paths, commands, and other typed data — and breaks permission argument merging.

## Problem Frame

When a Claude Code ACP agent streams a tool call (e.g. Read a file), the UI should show the file name inline and permission buttons if needed. Instead:

1. The `content_block_start` stream event creates the tool call with `kind: Some("read")` but `arguments: Other { raw: Null }` (expected — args haven't arrived yet)
2. `input_json_delta` events carrying the actual arguments are **dropped** (TODO(006) in cc_sdk_bridge.rs:302)
3. The final `Message::Assistant` with complete `ToolUse` blocks arrives and re-creates the tool call with `arguments: Other { raw: tu.input }` and `kind: None` — the raw input is never parsed into typed `ToolArguments`
4. Frontend components check `arguments.kind === "read"` which is `false` (it's `"other"`), so file paths don't render
5. `mergePermissionArgs` also fails because `parsed.kind !== args.kind`

**Contrast with other parsers**: `claude_code_parser.rs` and `cursor_parser.rs` both route through `build_tool_call_from_raw(parser, raw)` which calls `parse_typed_tool_arguments` to produce properly typed arguments and `detect_tool_kind` to set the kind.

## Requirements Trace

- R1. Tool calls from cc_sdk bridge must have typed `ToolArguments` (Read, Edit, Execute, etc.) matching what other parsers produce
- R2. Tool calls must have correct `kind` field (not `None`)
- R3. Streaming arguments must progressively display file paths and commands as deltas arrive
- R4. Permission merging via `mergePermissionArgs` must work when tool arguments start as untyped

## Scope Boundaries

- NOT implementing full stateful index→tool_call_id tracking for `input_json_delta` (TODO(006)) — that's a larger refactor
- NOT changing the streaming accumulator throttle behavior
- NOT modifying frontend components — the fix is entirely in the Rust bridge

## Context & Research

### Relevant Code and Patterns

- `cc_sdk_bridge.rs:125-148` — `translate_assistant` ToolUse handling (the broken path)
- `cc_sdk_bridge.rs:203-255` — `translate_stream_event` content_block_start (partially correct — has kind but no args)
- `cc_sdk_bridge.rs:298-303` — TODO(006) where `input_json_delta` is dropped
- `session_update/tool_calls.rs:307-397` — `build_tool_call_from_raw` (the correct pipeline)
- `session_update/tool_calls.rs:28-37` — `RawToolCallInput` struct
- `claude_code_parser.rs:31-37` — how other parsers call `build_tool_call_from_raw`
- `tool-call-manager.svelte.ts:244-304` — frontend `createEntry` handles duplicates by merging
- `tool-call-read.svelte:30-36` — `filePath` derivation checks `arguments.kind === "read"`
- `merge-permission-args.ts:18` — kind-match guard that fails with `"other"` args
- `CcSdkTurnStreamState` at `cc_sdk_bridge.rs:15-21` — existing state struct that can be extended

### Key Architecture Notes

- `RawToolCallInput` and `build_tool_call_from_raw` are `pub(crate)` — accessible from cc_sdk_bridge
- The frontend's `createEntry` already handles duplicate tool calls by merging (status precedence, preferring non-null fields)
- The streaming accumulator + delta batcher pipeline works correctly when fed `streaming_input_delta` — the issue is that cc_sdk_bridge never feeds it
- `content_block_start` events don't carry `input` — only `id`, `name`, `type`. The `input_json_delta` events carry fragments but lack `tool_use_id` (only have block `index`)

## Key Technical Decisions

- **Use `build_tool_call_from_raw` in `translate_assistant`**: Route ToolUse blocks through the same pipeline as other parsers. This is the minimal, correct fix for the argument parsing issue.
- **Add index→id tracking to `CcSdkTurnStreamState`**: Track the mapping from content block index to tool call ID established at `content_block_start`, then use it to route `input_json_delta` events through the streaming accumulator. This fixes progressive display.
- **Emit `ToolCallUpdate` with `streaming_input_delta` for `input_json_delta` events**: Once we know the tool_call_id from index tracking, we can emit proper updates that feed the existing streaming accumulator pipeline.

## Open Questions

### Resolved During Planning

- **Can cc_sdk_bridge access `build_tool_call_from_raw`?** Yes — it's `pub(crate)` and cc_sdk_bridge is in the same crate.
- **Will duplicate tool calls cause issues?** No — `createEntry` in tool-call-manager.svelte.ts merges duplicates, and the second call (from `Message::Assistant`) will now carry correctly typed arguments.
- **Should we also fix `content_block_start`?** Not for arguments (they're empty at that point), but we should ensure kind detection is consistent. Currently it already calls `detect_tool_kind` — this is correct.

### Deferred to Implementation

- **Exact partial JSON behavior during rapid deltas**: The streaming accumulator has a 150ms throttle. For very fast tool calls (<10ms total), only one emission may occur with incomplete args. This is acceptable — the `Message::Assistant` with full typed args arrives immediately after.
- **Whether `tool_name` field needs special handling in delta accumulation**: The accumulator can seed tool name from the initial tool_call event. Verify during implementation.

## Implementation Units

- [ ] **Unit 1: Parse ToolUse arguments in `translate_assistant`**

  **Goal:** Route `ContentBlock::ToolUse` blocks through `build_tool_call_from_raw` so they get typed `ToolArguments` and correct `kind`.

  **Requirements:** R1, R2, R4

  **Dependencies:** None

  **Files:**
  - Modify: `packages/desktop/src-tauri/src/acp/parsers/cc_sdk_bridge.rs`
  - Test: `packages/desktop/src-tauri/src/acp/parsers/cc_sdk_bridge.rs` (inline tests)

  **Approach:**
  - In `translate_assistant` (line 125-148), replace the manual `ToolCallData` construction with a `RawToolCallInput` + `build_tool_call_from_raw(parser, raw)` call, matching the pattern in `claude_code_parser.rs:35-36`
  - Get the parser via `get_parser(current_agent())`
  - Map `tu.id`, `tu.name`, `tu.input` to `RawToolCallInput` fields
  - Set `status: ToolCallStatus::InProgress` and `parent_tool_use_id` from the message context
  - This produces properly typed arguments (e.g. `ToolArguments::Read { file_path: Some("...") }`) and correct `kind`

  **Patterns to follow:**
  - `claude_code_parser.rs:31-37` — `parse_tool_call` method calls `build_tool_call_from_raw(self, raw)`
  - `session_update/tool_calls.rs:307-397` — `build_tool_call_from_raw` implementation

  **Test scenarios:**
  - ToolUse with Read tool and `{"file_path": "/foo.rs"}` input → `ToolArguments::Read { file_path: Some("/foo.rs") }` and `kind: Some(ToolKind::Read)`
  - ToolUse with Bash tool and `{"command": "ls"}` input → `ToolArguments::Execute { command: Some("ls") }` and `kind: Some(ToolKind::Execute)`
  - ToolUse with Edit tool and edit-shaped input → `ToolArguments::Edit { edits: [...] }` and `kind: Some(ToolKind::Edit)`
  - ToolUse with unknown tool name → `ToolArguments::Other` and `kind: Some(ToolKind::Other)` (preserves current behavior for unknown tools)
  - ToolUse with null/empty input → should not panic, produces reasonable defaults

  **Verification:**
  - `cargo test` passes for cc_sdk_bridge tests
  - Tool calls from ACP Claude Code sessions display file paths in the UI

- [ ] **Unit 2: Add index→tool_call_id tracking for streaming deltas**

  **Goal:** Track the content block index → tool call ID mapping so `input_json_delta` events can be routed to the correct tool call for progressive display.

  **Requirements:** R3

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `packages/desktop/src-tauri/src/acp/parsers/cc_sdk_bridge.rs`
  - Test: `packages/desktop/src-tauri/src/acp/parsers/cc_sdk_bridge.rs` (inline tests)

  **Approach:**
  - Extend `CcSdkTurnStreamState` with an `index_to_tool_call_id: HashMap<u64, String>` field (or `Vec<String>` since indices are sequential)
  - In `content_block_start` handler (line 203-255), when a `tool_use` block is detected, record the mapping from `index` (from the event) to the tool call `id`
  - In `content_block_delta` handler (line 257-304), when `input_json_delta` type is encountered, look up the tool call ID from the index, and emit a `SessionUpdate::ToolCallUpdate` with `streaming_input_delta` set — this feeds into the existing streaming accumulator pipeline via `build_tool_call_update_from_raw`
  - Also seed the streaming accumulator with the tool name (via `seed_tool_name`) when the `content_block_start` arrives, so kind detection works on deltas

  **Patterns to follow:**
  - `streaming_accumulator.rs:261` — `seed_tool_name` for establishing tool name context
  - `claude_code_parser.rs:289-294` — how `streaming_input_delta` is extracted from update data
  - `session_update/tool_calls.rs:87-224` — `build_tool_call_update_from_raw` which processes `streaming_input_delta`

  **Test scenarios:**
  - Two sequential tool_use content_block_start events at index 1 and 3 → correct ID mapping for both
  - input_json_delta at index 1 with mapped ID → emits ToolCallUpdate with streaming_input_delta
  - input_json_delta at unmapped index → no emission (graceful skip)
  - content_block_start for non-tool_use type (text) → no mapping created

  **Verification:**
  - `cargo test` passes
  - Tool calls progressively display file paths as arguments stream in (before the final Message::Assistant arrives)

## System-Wide Impact

- **Interaction graph:** The change is isolated to `cc_sdk_bridge.rs` — no other parsers or frontend components need modification. The frontend already handles typed `ToolArguments` correctly; it just wasn't receiving them from this path.
- **Error propagation:** `build_tool_call_from_raw` is infallible (returns `ToolCallData`, not `Result`). Worst case for unparseable input is `ToolArguments::Other { raw }` — same as current behavior.
- **State lifecycle risks:** The index→id map in `CcSdkTurnStreamState` is per-turn. A new turn creates a new state, so stale mappings can't leak across turns.
- **API surface parity:** After this fix, cc_sdk_bridge tool calls will produce the same `ToolCallData` shape as claude_code_parser, cursor_parser, and opencode_parser.

## Risks & Dependencies

- **Low risk**: `build_tool_call_from_raw` is battle-tested across all other parser paths. Using it in cc_sdk_bridge is applying an existing, proven pattern.
- **Index tracking correctness**: Content block indices from the Anthropic API are sequential and stable within a message. The mapping is straightforward. Edge case: if a turn is interrupted mid-stream, the state is discarded with the turn.

## Sources & References

- Related code: `cc_sdk_bridge.rs`, `build_tool_call_from_raw` in `session_update/tool_calls.rs`
- Related TODO: `TODO(006)` at cc_sdk_bridge.rs:302
- Session with bug: `a1de6236-3bab-416b-817f-e07ddb7125dd.jsonl`
