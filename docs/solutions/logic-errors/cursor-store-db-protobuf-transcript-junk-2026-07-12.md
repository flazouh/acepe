---
title: Cursor store.db parser leaked prompt scaffolding and protobuf wire bytes into transcripts
date: 2026-07-12
category: logic-errors
module: cursor-history-parser
problem_type: logic_error
component: history
severity: high
symptoms:
  - Cursor session transcripts rendered a giant <mcp_instructions …> block as a user bubble
  - Every user turn showed a <timestamp>…</timestamp> wrapper above the real text
  - Assistant rows showed stray prefix letters ("eThe user sent…", "MChecking…", "dReading…", "SRemoving…")
  - Junk rows like "summarized_conversationSummarized conversation" appeared mid-transcript
root_cause: incomplete_provider_normalization
resolution_type: code_fix
related_components:
  - history/cursor_sqlite_parser
  - cursor_history/parser/txt_transcript
  - transcript_viewport ledger
tags:
  - cursor
  - provider-history-parsing
  - protobuf
  - sanitization
  - god-architecture
---

# Cursor store.db parser leaked prompt scaffolding and protobuf wire bytes

## Problem

Reopened Cursor sessions (parsed from `~/.cursor/acp-sessions/<uuid>/store.db`)
rendered provider junk as canonical transcript text, persisted into
`session_transcript_row`.

## Root causes (three, all in `history/cursor_sqlite_parser.rs`)

1. **Sanitizer tag gaps.** Cursor persists the composed model-facing prompt:
   a session-start "preamble" user message (`<user_info>`, `<git_status>`,
   `<rules>`, `<agent_skills>`, `<mcp_instructions>`) and per-turn
   `<timestamp>…</timestamp>\n<user_query>…</user_query>` wrappers.
   `sanitize_cursor_sqlite_text` stripped most tags but its `blocked_tags`
   list was missing `mcp_instructions` and `timestamp` (the timestamp filter
   only matched bare `HH:MM:SS` lines).
2. **Lossy binary-blob scavenging.** Non-JSON blobs are protobuf, but
   `extract_plain_text_message_from_blob` line-scanned the lossy UTF-8 of raw
   bytes. Printable wire-format bytes leaked into text:
   - single-byte varint string lengths read as letters glued to the text
     (`0x65`→`eThe user sent…`, `0x4d`→`MChecking…`, `0x64`→`d…`, `0x53`→`S…`);
     strings >127 bytes have multi-byte varints with high bytes → U+FFFD → the
     line was dropped, which is why only short strings leaked;
   - metadata blobs (Cursor's context breakdown) leaked label pairs like
     `\x17summarized_conversation\x12\x17Summarized conversation`.
3. **A legacy test codified the bug.** The blob-sequence test used a
   hand-mangled fixture (`\nO\nM\nExploring…` with an extra `\n` after the
   length byte) so the stray-letter leak never showed up in tests.

## Fix

- Added `mcp_instructions` + `timestamp` to `blocked_tags` (mirrored in
  `txt_transcript.rs`). A preamble that sanitizes to empty now produces no
  message (empty-content messages are dropped in `parse_blob_messages`).
- Replaced the lossy scavenge with strict protobuf wire-format decoding
  (`extract_protobuf_strings` / `collect_protobuf_strings` /
  `read_protobuf_varint`), preferring the nested-message interpretation over
  UTF-8 (wrapper headers are often printable ASCII). Guardrails:
  - the legacy line-scan verdict still gates which blobs may become messages
    at all (metadata blobs keep getting dropped — judged on ALL decoded
    strings, so `file:///` URIs condemn context-breakdown blobs);
  - identifier-ish strings (no spaces: uuids, tool ids, tokens) are excluded
    from message content.
- Bumped `TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION` to `v14` so stale
  persisted rows rebuild through the fixed parser.

## Feedback loop that cracked it

Copied the live `store.db` (checkpoint the WAL first!) and ran the real parser
over it via a temporary `#[test]` harness dumping every message — reproduced
all four symptoms in one deterministic 0.03s loop. Regression tests use a
minimised fixture DB (`tests/fixtures/cursor_sessions/c2a34686-junk-session.db`)
built from the real offending blobs.

## Lessons

- Cursor's store.db "user" messages are model-facing composed prompts, not
  what the user typed. Treat every provider-composed wrapper as provider
  metadata to delete at the Rust adapter boundary (GOD rule).
- Never text-scan binary provider formats; decode the wire format. Printable
  bytes inside binary encodings produce convincing-looking corruption
  ("MChecking") that survives naive human-readability heuristics.
- When a fix contradicts an existing test fixture, check whether the fixture
  was hand-mangled to match buggy output before trusting it.
- Sanitizer verdicts must be computed on full decoded content, then content
  can be filtered — filtering before the verdict (dropping the path string
  that would condemn a metadata blob) reintroduces leaks.
