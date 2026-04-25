---
title: "feat: Direct transcript parsing for Copilot sessions"
type: feat
status: active
date: 2026-04-10
---

# feat: Direct transcript parsing for Copilot sessions

## Overview

Replace the ACP replay path for Copilot `getUnifiedSession` with direct filesystem parsing of `~/.copilot/session-state/{id}/events.jsonl`, matching the architecture Claude Code already uses. Preserve the existing journal fast path for Acepe-managed sessions, then use direct file parsing for external Copilot sessions before falling back to ACP replay. This eliminates the ~10s process startup + ACP handshake + replay drain for file-backed sessions and keeps session loading in the ms range.

## Problem Frame

Copilot `getUnifiedSession` currently spawns a fresh Copilot process, initializes ACP, calls `session/load`, collects streamed replay events, and waits up to 5s for the replay drain. This takes ~10s per session vs ~1s for Claude Code, which directly parses its JSONL files from disk.

Copilot CLI already persists structured session events to `~/.copilot/session-state/{session_id}/events.jsonl` with a well-defined schema (session.start, user.message, assistant.message, tool.execution_start/complete, subagent events, etc.) and session metadata in `workspace.yaml`. These files are the direct equivalent of Claude Code's JSONL transcripts.

## Requirements Trace

- R1. Copilot session content loads as fast as Claude Code (direct file parse, no process startup)
- R2. Session list discovery also uses filesystem scanning (no ACP `session/list` call)
- R3. The indexer stores real `events.jsonl` file paths with mtime/size for change detection
- R4. ACP replay remains as fallback for sessions without events.jsonl (edge case)
- R5. Existing `convert_replay_updates_to_session` / `ReplayAccumulator` reused for the conversion pipeline

## Scope Boundaries

- Not changing how live Copilot sessions stream updates (ACP remains for interactive use)
- Not changing the session journal DB persistence (that path remains intact for projection replay)
- Not parsing `session.db` or `checkpoints/` from Copilot session directories
- Not handling `assistant.message_delta` or `assistant.reasoning_delta` (ephemeral, not persisted to events.jsonl)
- Not preserving `session.model_change` / per-message model attribution in disk-loaded Copilot sessions for this phase

## Context & Research

### Relevant Code and Patterns

- `src/session_jsonl/parser/full_session.rs` — Claude Code's `parse_full_session` reads JSONL, produces `FullSession`, then `session_converter` maps to `ConvertedSession`
- `src/copilot_history/mod.rs` — `convert_replay_updates_to_session` + `ReplayAccumulator` already converts `Vec<(u64, SessionUpdate)>` to `ConvertedSession`. This is the exact interface the new parser should target
- `src/history/indexer.rs` — `ClaudeSource` scans `.jsonl` files with mtime/size tracking; `CopilotSource` currently uses ACP `session/list` with sentinel file paths
- `~/.copilot/session-state/{id}/events.jsonl` — JSONL with typed events: `session.start`, `user.message`, `assistant.message` (with `toolRequests`), `tool.execution_start`, `tool.execution_complete`, `subagent.started/completed`
- `~/.copilot/session-state/{id}/workspace.yaml` — Session metadata: `id`, `cwd`, `summary`, `created_at`, `updated_at`

### Copilot Event Schema (Key Types)

Every line: `{ id, timestamp, parentId, type, data, ephemeral? }`

| Event Type | Maps To |
|---|---|
| `session.start` | Session metadata (title from workspace.yaml summary) |
| `user.message` | `SessionUpdate::UserMessageChunk` |
| `assistant.message` | `SessionUpdate::AgentMessageChunk` + tool requests |
| `assistant.reasoning` | `SessionUpdate::AgentThoughtChunk` |
| `tool.execution_start` | `SessionUpdate::ToolCall` (pending) |
| `tool.execution_complete` | `SessionUpdate::ToolCallUpdate` (completed/failed) |
| `subagent.started` | `SessionUpdate::ToolCall` (task kind) |
| `subagent.completed` | `SessionUpdate::ToolCallUpdate` |
| `session.model_change` | Recognized but ignored in this phase |

## Key Technical Decisions

- **Reuse ReplayAccumulator**: The existing `convert_replay_updates_to_session` already handles `Vec<(u64, SessionUpdate)>` → `ConvertedSession`. The parser just needs to produce that intermediate format from the JSONL events. This avoids duplicating conversion logic.
- **Parser module lives in `copilot_history/`**: Not in `session_jsonl/` (that's Claude-specific). The Copilot parser is a peer to `session_jsonl/parser` but with its own event format.
- **Indexer scans filesystem directly**: Replace ACP-based `list_workspace_sessions` in the indexer with a filesystem scan of `~/.copilot/session-state/*/workspace.yaml`, reading project path and title from YAML. This removes the need to spawn a Copilot process just to list sessions.
- **File path in DB**: Store `{copilot_config_dir}/session-state/{id}/events.jsonl` as the real `file_path` with actual mtime/size when the transcript exists; otherwise store an explicit non-persisted fallback marker so ACP replay remains reachable without pretending a missing file exists.
- **Config dir resolution**: Treat `dirs::home_dir()` + `.copilot/session-state` as the canonical session-state root for this phase. Do not try to infer ad hoc `copilot --config-dir` usage during indexing; non-default config-dir installs remain outside the filesystem discovery path until Acepe exposes an explicit override.
- **Test seam via shared root helper**: Add internal `*_at_root` helpers so parser/discovery tests can run against temp directories while public entry points still resolve the default Copilot session-state root.

## Open Questions

### Resolved During Planning

- **Q: Should we parse all event types or just the conversation-bearing ones?** Parse conversation-bearing types plus `session.start` for metadata extraction. Skip compaction, context changes, and other non-conversation events.
- **Q: Do we need Deserialize on ConvertedSession types?** No — the parser produces `SessionUpdate` variants which are already handled by `ReplayAccumulator`.
- **Q: Should direct transcript loading preserve Copilot model-switch metadata?** No for this phase — direct transcript loading can leave `model` / `display_model` unset, matching current replay accumulator behavior.

### Deferred to Implementation

- Exact field mapping edge cases (e.g., assistant.message with empty `toolRequests` vs no field)
- Whether `workspace.yaml` parsing should use serde_yaml or simple string extraction

## Implementation Units

- [ ] **Unit 1: Copilot events.jsonl parser types and deserialization**

**Goal:** Define Rust types for the Copilot events.jsonl format and implement line-by-line deserialization with explicit fallback signaling for corrupted supported events.

**Requirements:** R1, R5

**Dependencies:** None

**Files:**
- Create: `packages/desktop/src-tauri/src/copilot_history/parser.rs`
- Modify: `packages/desktop/src-tauri/src/copilot_history/mod.rs` (add `mod parser;`)
- Test: `packages/desktop/src-tauri/src/copilot_history/parser.rs` (inline `#[cfg(test)]`)

**Approach:**
- Define a `CopilotEvent` struct with `id`, `timestamp`, `type`, `data` (serde_json::Value), using `#[serde(tag = "type")]` on an inner enum for typed dispatch
- Only model the event types we need: `session.start`, `user.message`, `assistant.message`, `assistant.reasoning`, `tool.execution_start`, `tool.execution_complete`, `subagent.started`, `subagent.completed`, plus a catch-all `Other` variant
- Define data structs for each: `UserMessageData { content }`, `AssistantMessageData { messageId, content, toolRequests, reasoningText? }`, `ToolExecutionStartData { toolCallId, toolName, arguments? }`, `ToolExecutionCompleteData { toolCallId, success, result?, model? }`, etc.
- Parse function: `fn parse_events_from_reader(reader: impl std::io::BufRead) -> Result<Vec<CopilotEvent>, ParseError>` — skip blank lines, parse unknown event types into the catch-all `Other` variant, and return an error when JSON is malformed or a supported event shape cannot be deserialized so `load_session` can fall back to ACP replay

**Patterns to follow:**
- `src/session_jsonl/types.rs` for Serialize/Deserialize derive patterns
- `src/copilot_history/mod.rs` existing `ReplayAccumulator` push interface
- `src/acp/parsers/copilot_parser.rs` and `src/acp/session_update/tool_calls.rs` for raw Copilot tool-call conversion helpers

**Test scenarios:**
- Happy path: Parse a multi-line JSONL string with user.message, assistant.message (with toolRequests), tool.execution_start, tool.execution_complete → correct event types and data extracted
- Happy path: Parse session.start → sessionId and context extracted
- Edge case: Empty lines are skipped without error
- Edge case: Malformed JSON or malformed supported event payload returns an error instead of a partial session
- Edge case: Unknown event types (e.g., `session.compaction_start`) parse as catch-all variant and are skipped during conversion
- Edge case: assistant.message with empty `toolRequests` array vs missing field both handled

**Verification:**
- All event types deserialize correctly from real Copilot JSONL samples
- Unknown events don't cause parse failures, while malformed supported events surface a parser error

---

- [ ] **Unit 2: Convert parsed Copilot events to SessionUpdate stream**

**Goal:** Map `Vec<CopilotEvent>` into `Vec<(u64, SessionUpdate)>` so the existing `convert_replay_updates_to_session` produces a `ConvertedSession`.

**Requirements:** R1, R5

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src-tauri/src/copilot_history/parser.rs`
- Test: `packages/desktop/src-tauri/src/copilot_history/parser.rs` (inline `#[cfg(test)]`)

**Approach:**
- `fn convert_events_to_updates(events: Vec<CopilotEvent>) -> Vec<(u64, SessionUpdate)>`
- Map each Copilot event to zero or more `SessionUpdate` variants:
  - `user.message` → `SessionUpdate::UserMessageChunk` with `ContentBlock::Text`
- `assistant.message` → `SessionUpdate::AgentMessageChunk` for the text content, plus `SessionUpdate::ToolCall` for each entry in `toolRequests`
- `assistant.reasoning` → `SessionUpdate::AgentThoughtChunk`
  - `tool.execution_start` → build a typed tool call via `RawToolCallInput` + `build_tool_call_from_raw` when the tool call was not already declared in `assistant.message.toolRequests`; otherwise treat it as the authoritative start metadata for the existing tool call
- `tool.execution_complete` → `SessionUpdate::ToolCallUpdate` with status and result
  - `subagent.started` → `SessionUpdate::ToolCall` with `ToolKind::Task`
  - `subagent.completed` → `SessionUpdate::ToolCallUpdate`
- Timestamp: parse ISO 8601 `timestamp` field to epoch millis (u64)
- Tool argument classification and update shaping: reuse `RawToolCallInput` / `RawToolCallUpdateInput`, `build_tool_call_from_raw`, and `build_tool_call_update_from_raw` via the Copilot parser rather than manually constructing `ToolCallData`

**Patterns to follow:**
- `src/copilot_history/mod.rs` `ReplayAccumulator::push` for the expected `SessionUpdate` shape
- `src/acp/session_update/tool_calls.rs` for `RawToolCallInput`, `RawToolCallUpdateInput`, and typed tool-call builders

**Test scenarios:**
- Happy path: Full conversation (user message → assistant message with 2 tool requests → tool completions) produces correct StoredEntry sequence via `convert_replay_updates_to_session`
- Happy path: assistant.reasoning events produce thought chunks in the output
- Happy path: subagent.started + subagent.completed produce task tool call entries
- Edge case: tool.execution_complete with `success: false` maps to failed status
- Edge case: assistant.message with no toolRequests still reconstructs a visible tool call when `tool.execution_start` / `tool.execution_complete` arrive
- Integration: Round-trip test — parse real Copilot JSONL sample → convert → verify `ConvertedSession` has expected entry count and types

**Verification:**
- `convert_replay_updates_to_session` produces correct `ConvertedSession` from converted events

---

- [ ] **Unit 3: Wire parser into load_session as primary path**

**Goal:** `copilot_history::load_session` keeps the journal fast path for Acepe-managed sessions, otherwise reads `events.jsonl` from disk when `source_path` points to a validated file, and falls back to ACP replay when file parsing is unavailable or unsafe.

**Requirements:** R1, R4

**Dependencies:** Unit 2

**Files:**
- Modify: `packages/desktop/src-tauri/src/copilot_history/mod.rs`
- Modify: `packages/desktop/src-tauri/src/copilot_history/parser.rs`
- Test: `packages/desktop/src-tauri/src/copilot_history/parser.rs`

**Approach:**
- Add an internal `parse_copilot_session_at_root(session_state_root: &Path, events_jsonl_path: &Path, title: &str) -> Result<ConvertedSession, String>` plus a thin public wrapper that resolves the default root. The helper:
  1. Canonicalizes the path and verifies it lives under the resolved Copilot session-state root before opening any file handle
  2. Opens `std::fs::File` + `std::io::BufReader` inside `tokio::task::spawn_blocking`
  3. Calls `parse_events_from_reader`
  4. Calls `convert_events_to_updates`
  5. Calls `convert_replay_updates_to_session`
- In `load_session`: keep the current journal-first fast path. If the journal is empty, check whether `source_path` points to a validated `events.jsonl` file and call `parse_copilot_session`; on parser/path errors or missing files, fall back to ACP replay.

**Patterns to follow:**
- `src/acp/providers/claude_code.rs` `load_provider_owned_session` pattern

**Test scenarios:**
- Happy path: `parse_copilot_session` with a temp file containing valid Copilot JSONL produces correct `ConvertedSession`
- Edge case: Non-existent file path returns error
- Edge case: Empty file or `session.start`-only transcript falls back to ACP replay instead of returning a falsely blank session
- Edge case: Source path outside the Copilot session-state root is rejected and falls back to ACP replay
- Edge case: Malformed supported event payload falls back to ACP replay instead of returning a partial session

**Verification:**
- `load_session` returns a `ConvertedSession` without spawning a Copilot process when `source_path` points to a valid events.jsonl
- End-to-end verification uses a Unit 4-indexed Copilot session so the direct-load path is exercised through the real metadata pipeline, not only via a hand-supplied `source_path`

---

- [ ] **Unit 4: Filesystem-based session discovery and indexer update**

**Goal:** Replace ACP-based `list_workspace_sessions` with filesystem scanning of `~/.copilot/session-state/*/workspace.yaml`, and update the indexer to store real `events.jsonl` paths with mtime/size.

**Requirements:** R2, R3

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src-tauri/src/copilot_history/mod.rs` (add `scan_copilot_sessions`)
- Modify: `packages/desktop/src-tauri/src/history/indexer.rs` (`CopilotSource::fetch`)
- Modify: `packages/desktop/src-tauri/src/db/repository.rs` (allow explicit downgrade from persisted transcript path to ACP fallback state)
- Test: `packages/desktop/src-tauri/src/copilot_history/parser.rs`

**Approach:**
- Add an internal `scan_copilot_sessions_at_root(session_state_root: &Path, project_paths: &[String]) -> Result<Vec<CopilotListedSession>, String>` plus a thin public wrapper that resolves the canonical Copilot session-state root from `dirs::home_dir()` + `.copilot/session-state`
  1. Resolve the session-state root
  2. Iterate subdirectories (each is a session UUID)
  3. Read `workspace.yaml` for metadata: `cwd` (project path), `summary` (title), `created_at`, `updated_at`
  4. Normalize each `cwd` through `session_metadata_context_from_cwd`, filter on normalized `project_path`, and preserve the normalized `worktree_path` plus original `cwd`
  5. Sort by `updated_at_ms`, enforce `MAX_SESSIONS_PER_PROJECT`, and return `CopilotListedSession` with the session_id, title, project_path, worktree_path, cwd, timestamps
- Update `CopilotSource::fetch` in the indexer:
  - Call `scan_copilot_sessions` instead of `list_workspace_sessions`
  - For sessions with `events.jsonl`, store the real `{config_dir}/session-state/{id}/events.jsonl` path with real `mtime` and `file_size` from `tokio::fs::metadata`
  - For sessions without `events.jsonl`, store an explicit non-persisted Copilot fallback marker that can replace an existing real transcript path, while keeping the provider session id / replay session id intact for ACP fallback
  - Mirror `ClaudeSource::fetch` by loading indexed file entries, comparing `mtime`/`file_size`, incrementing `unchanged_count`, and skipping unchanged sessions
- Remove ACP-based `list_workspace_sessions` from the indexer path once filesystem scanning lands; ACP remains only as the session-load fallback using `replay_context.history_session_id`

**Patterns to follow:**
- `ClaudeSource::fetch` in `src/history/indexer.rs` for mtime/size-based change detection
- `extract_thread_metadata` pattern for metadata extraction from files

**Test scenarios:**
- Happy path: `scan_copilot_sessions` with a temp dir containing workspace.yaml files discovers sessions matching project paths
- Happy path: Sessions whose `cwd` is a subdirectory or worktree of a project still normalize back to the indexed project path
- Happy path: Sessions with normalized `project_path` not matching any indexed project are filtered out
- Edge case: Session dir without workspace.yaml is skipped
- Edge case: Session dir without events.jsonl still appears in the list with a non-persisted fallback marker so ACP replay remains reachable even if a stale persisted transcript path existed before
- Edge case: Empty session-state directory returns empty list
- Integration: Indexer stores real file paths instead of `__session_registry__/copilot/` sentinels
- Integration: Discovery -> index -> load for a session with no `events.jsonl` still reaches ACP replay via the provider session id

**Verification:**
- App startup discovers Copilot sessions without spawning a Copilot process
- Indexer records contain real events.jsonl paths with non-zero mtime/size
- Subsequent indexer runs skip unchanged sessions (mtime/size match)

## System-Wide Impact

- **Interaction graph:** The indexer, session loading, and provider all change. The `CopilotProvider::load_provider_owned_session` → `copilot_history::load_session` path prefers journal, then validated file parsing. ACP replay and its AcpEventHub collection path remain only as fallback for missing/invalid/untrusted transcript files.
- **Error propagation:** Missing `workspace.yaml` skips discovery. Missing `events.jsonl`, invalid `source_path`, or parser errors on supported events fall through to ACP replay fallback instead of returning partial sessions.
- **State lifecycle risks:** None — this is read-only file parsing. No writes to Copilot's data directory.
- **Unchanged invariants:** Live Copilot sessions still use ACP for interactive prompting, streaming, and session management. The session journal DB persistence continues for projection replay. The `ReplayAccumulator` conversion pipeline is unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Copilot CLI changes events.jsonl schema | Parser uses `#[serde(other)]` catch-all; unknown events skipped gracefully |
| Copilot launched with a non-default `--config-dir` | Use the default `~/.copilot/session-state` root for this phase and treat custom config-dir discovery as a follow-up capability |
| Large events.jsonl files (20MB+) | Stream line-by-line from `tokio::fs::File` + `BufReader`, same as Claude Code JSONL parsing |
| workspace.yaml format changes | Minimal field extraction (cwd, summary, timestamps); unknown fields ignored |

## Sources & References

- Related code: `src/session_jsonl/parser/full_session.rs`, `src/copilot_history/mod.rs`
- Schema: `~/.copilot/pkg/universal/1.0.17/schemas/session-events.schema.json`
- Data: `~/.copilot/session-state/{id}/events.jsonl`, `~/.copilot/session-state/{id}/workspace.yaml`
