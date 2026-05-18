---
title: "refactor: History parser provider id boundary"
type: refactor
status: active
date: 2026-05-18
origin: docs/brainstorms/2026-04-25-final-god-architecture-requirements.md
depends_on:
  - docs/plans/2026-05-18-003-refactor-live-transcript-identity-boundary-plan.md
  - docs/plans/2026-05-18-005-refactor-delete-compatibility-chunk-aggregation-plan.md
  - docs/solutions/architectural/live-transcript-display-identity-boundary-2026-05-18.md
---

# Refactor: History Parser Provider Id Boundary

## Overview

The TypeScript raw chunk aggregation path has been deleted. The next boundary to verify is the Rust historical JSONL path:

```text
Claude JSONL
  -> session_jsonl parser
  -> FullSession / OrderedMessage
  -> canonical transcript events
  -> transcript snapshot
```

Provider `message.id` may remain as metadata or as a narrow parser merge hint for compatible assistant text/thinking fragments. It must not become display identity, ordering authority, or proof that tool calls and assistant text belong in one visible row.

## Planning Inventory

Inventory was collected after commit `797325141`.

### Legal Or Intended Boundaries

- `packages/desktop/src-tauri/src/session_converter/transcript_events.rs`
  - Canonical events copy `provider_msg_id` as metadata.
  - Assistant display ids come from `OrderedMessage.uuid` or `uuid:assistant:<index>`.
  - Tool display ids come from `tool_use.id`.
  - `transcript_seq` is assigned from event vector order.

- `packages/desktop/src-tauri/src/acp/transcript_projection/snapshot.rs`
  - Snapshot projection uses `CanonicalTranscriptEvent.display_id` directly.
  - Existing test `transcript_snapshot_from_canonical_events_uses_acepe_display_ids_without_remap` proves repeated provider ids do not force repeated display ids.

- `packages/desktop/src-tauri/src/acp/transcript_projection/runtime.rs`
  - Existing tests cover reused assistant provider ids after user and tool boundaries in the live path.

### Real GOD Violation Candidates

- `packages/desktop/src-tauri/src/session_jsonl/parser/full_session.rs`
  - `assistant_merge_key(...)` currently says it prefers the "stable Claude message.id".
  - GOD issue: the wording is wrong. Claude `message.id` is not a stable display identity. It is only a provider grouping hint.
  - Current implementation only merges when both existing and incoming assistant fragments contain no `ToolUse` block. That is the minimum acceptable rule from `god-architecture-check`.

- `packages/desktop/src-tauri/src/session_jsonl/parser/tests.rs`
  - Existing coverage proves:
    - same-id text fragments merge into one assistant entry;
    - text followed by same-id tool fragments displays as tool rows before final assistant text.
  - Missing coverage: the parser should keep separate `OrderedMessage` rows when same provider id appears as text -> tool -> later text. This proves the parser boundary before snapshot conversion, not only final converted display entries.

## Problem Frame

The bug started because the system treated a reused Claude assistant `message.id` like identity. We already fixed the live path and deleted the TypeScript compatibility aggregation path. Historical replay still needs an explicit guard: same provider id can help merge text-only fragments, but tool boundaries must break that merge.

This slice is not a new architecture. It is a hardening slice that makes the existing Rust parser boundary explicit and tested.

## Requirements Trace

- R1. Provider facts flow through Rust-owned canonical data before TypeScript display projection.
- R3. Transcript order and transcript identity are product truth.
- R12. UI and store projections consume canonical state; they do not repair provider quirks.
- R23. Desktop stores consume and project canonical state, not repair it.
- R27. Old authorities must be deleted or quarantined with proof.

## Scope Boundaries

- This plan does not remove text/thinking fragment merging in the history parser.
- This plan does not change live transcript projection.
- This plan does not change TypeScript stores.
- This plan does not change tool-call ids; `tool_use.id` remains canonical tool identity.

## Implementation Units

- [x] **Unit 1: Add Parser Characterization For Reused Provider Id Across Tool Boundary**

**Goal:** Prove the JSONL parser does not merge assistant text, tool, and later text rows just because they share `message.id` or `requestId`.

**Requirements:** R3, R27

**Files:**
- Modify: `packages/desktop/src-tauri/src/session_jsonl/parser/tests.rs`

**Approach:**
- Add a test that writes a Claude JSONL session with:
  - user row,
  - assistant text row with `message.id = msg-1`,
  - assistant tool-use row with `message.id = msg-1`,
  - assistant later text row with `message.id = msg-1`.
- Parse with `parse_full_session(...)`.
- Assert the resulting assistant `OrderedMessage` rows remain separate around the tool row.
- Assert the provider message id is preserved only as metadata.

**Execution note:** Characterization-first. Run the new test before changing implementation. If it already passes, keep it as a guard and do not change parser behavior.

**Verification:**
- Focused Rust test for the new parser case passes.

**Execution result:** Added parser-level coverage proving `parse_full_session(...)` keeps same-provider-id assistant rows separate across a tool boundary while preserving `provider_message_id` only as metadata.

- [x] **Unit 2: Correct Provider Id Boundary Wording**

**Goal:** Remove wording that implies Claude `message.id` is stable identity.

**Requirements:** R1, R3

**Files:**
- Modify: `packages/desktop/src-tauri/src/session_jsonl/parser/full_session.rs`
- Modify: `docs/solutions/architectural/live-transcript-display-identity-boundary-2026-05-18.md`

**Approach:**
- Update comments around `assistant_merge_key(...)`.
- Say provider ids are metadata/grouping hints only.
- State that merge is allowed only for compatible text/thinking fragments and is not display identity.

**Verification:**
- Guard scan no longer finds "stable Claude message.id".

**Execution result:** Reworded the parser merge comment so it describes provider ids as narrow merge hints, not stable identity.

- [x] **Unit 3: Confirm Canonical Event Identity From Historical Replay**

**Goal:** Prove historical replay keeps provider ids out of display identity after parsing.

**Requirements:** R3, R12, R23

**Files:**
- Modify: `packages/desktop/src-tauri/src/session_converter/transcript_events.rs`

**Approach:**
- Add a focused test with multiple assistant `OrderedMessage` rows sharing `provider_message_id`.
- Assert event `provider_msg_id` values may repeat.
- Assert assistant `display_id` values are Acepe/parser row ids, and tool `display_id` is the tool id.
- Assert event order is controlled by canonical event order, not provider id.

**Verification:**
- Focused Rust test for `session_converter::transcript_events` passes.

**Execution result:** Added canonical event coverage proving repeated `provider_msg_id` values do not become repeated `display_id` values. Assistant rows use parser row ids and tool rows use `tool_use.id`.

## Verification Plan

- Focused Rust tests:
  - `cd packages/desktop/src-tauri && cargo test session_jsonl::parser --quiet`
  - `cd packages/desktop/src-tauri && cargo test session_converter::transcript_events --quiet`
- Guard scan:
  - `rg -n "stable Claude message\\.id|same provider id means same display|provider_msg_id.*display_id" packages/desktop/src-tauri/src docs/solutions`
- Existing broad checks if Rust changes are non-comment only:
  - `cd packages/desktop/src-tauri && cargo test transcript_projection --quiet`
  - `cd packages/desktop && bun run check`

Expected result: tests pass, and there is no wording that promotes provider message ids to identity.

## Current Verification

- `cd packages/desktop/src-tauri && cargo test test_parse_full_session_keeps_reused_provider_id_rows_separate_across_tool_boundary --quiet`
  - passed: 1 test
- `cd packages/desktop/src-tauri && cargo test canonical_events_keep_reused_provider_id_out_of_display_identity --quiet`
  - passed: 1 test
- `cd packages/desktop/src-tauri && cargo test session_jsonl::parser --quiet`
  - passed: 62 tests, 3 ignored
- `cd packages/desktop/src-tauri && cargo test session_converter::transcript_events --quiet`
  - passed: 2 tests
- `cd packages/desktop/src-tauri && cargo test transcript_projection --quiet`
  - passed: 22 tests
- `cd packages/desktop && bun run check`
  - passed with the existing SvelteKit `baseUrl`/`paths` warning
- `git diff --check`
  - passed
- Guard scan:
  - no stale source/docs wording that promotes provider message ids to display identity
