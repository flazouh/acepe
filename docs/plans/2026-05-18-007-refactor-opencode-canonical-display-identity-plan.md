---
title: "refactor: OpenCode canonical display identity"
type: refactor
status: active
date: 2026-05-18
origin: docs/brainstorms/2026-04-25-final-god-architecture-requirements.md
depends_on:
  - docs/plans/2026-05-18-006-refactor-history-parser-provider-id-boundary-plan.md
  - docs/solutions/architectural/live-transcript-display-identity-boundary-2026-05-18.md
---

# Refactor: OpenCode Canonical Display Identity

## Overview

The Claude history parser now has explicit coverage proving provider message ids stay metadata. The next scan finding is OpenCode history conversion:

```text
OpenCode messages
  -> materialize_opencode_canonical_transcript_events(...)
  -> CanonicalTranscriptEvent.display_id
  -> TranscriptSnapshot.entry_id
```

Current OpenCode canonical transcript events build user/assistant `display_id` from `msg.id`, and tool events leave `display_id` empty so the snapshot layer falls back to `tool_call_id`. That keeps provider ids too close to visible transcript identity.

Target rule:

```text
OpenCode provider ids stay in provider_row_id/provider_msg_id.
OpenCode text display ids are Acepe-owned order ids.
OpenCode tool display ids are the promoted canonical tool_call_id.
```

## Planning Inventory

Inventory was collected after commit `3b13a9de7`.

### Real GOD Violation Candidates

- `packages/desktop/src-tauri/src/session_converter/opencode.rs`
  - User event `display_id` is `format!("opencode:{}:user", msg.id)`.
  - Assistant event `display_id` is `format!("opencode:{}:assistant", msg.id)`.
  - Tool event `display_id` is `String::new()`, relying on downstream fallback.
  - GOD issue: provider message id is used as visible row identity for text rows, while tool rows are not explicit at the canonical event boundary.

- `packages/desktop/src-tauri/src/session_converter/opencode.rs` tests
  - Existing test expects `"opencode:provider-assistant-message:assistant"`.
  - GOD issue: the test encodes provider-derived display identity.

### Legal Or Lower-Risk Findings

- `provider_row_id` and `provider_msg_id` may keep `msg.id`.
  - They are metadata fields.

- `convert_opencode_messages(...)` still builds a legacy `SessionThreadSnapshot` from provider ids.
  - Lower risk in this slice because `convert_opencode_messages_to_provider_owned_snapshot(...)` supplies canonical events, and `materialize_provider_owned_thread_snapshot(...)` prefers canonical events for transcript snapshots.
  - Do not expand scope unless tests show the legacy entries leak into transcript identity.

## Problem Frame

OpenCode is provider-owned, but provider-owned does not mean provider ids are display ids. The canonical transcript event should carry provider ids as metadata and carry Acepe-owned row ids as product identity.

The clean fix is to generate display ids from deterministic event/message order at the canonical event boundary. Tool rows should explicitly use promoted `tool_call_id` as the canonical display id instead of relying on an empty-string fallback downstream.

## Requirements Trace

- R1. Provider facts flow through Rust-owned canonical data before TypeScript display projection.
- R3. Transcript order and transcript identity are product truth.
- R12. UI and store projections consume canonical state; they do not repair provider quirks.
- R23. Desktop stores consume and project canonical state, not repair it.
- R27. Old authorities must be deleted or quarantined with proof.

## Scope Boundaries

- This plan does not change OpenCode HTTP or disk parsing.
- This plan does not change OpenCode tool argument normalization.
- This plan does not remove the legacy `SessionThreadSnapshot` entries.
- This plan does not change Claude/Codex/Cursor transcript paths.

## Implementation Units

- [x] **Unit 1: Add OpenCode Provider-Id Reuse Characterization**

**Goal:** Prove repeated OpenCode message ids do not become repeated transcript display ids.

**Requirements:** R3, R27

**Files:**
- Modify: `packages/desktop/src-tauri/src/session_converter/opencode.rs`

**Approach:**
- Add a test with multiple OpenCode messages sharing the same provider `id`.
- Convert through `convert_opencode_messages_to_provider_owned_snapshot(...)` and `materialize_provider_owned_thread_snapshot(...)`.
- Assert `provider_msg_id` can repeat.
- Assert transcript entry ids are Acepe-owned order ids, not `msg.id` strings.

**Execution note:** Failing test first. The current code should fail because text `display_id` contains provider `msg.id`.

**Verification:**
- New OpenCode identity test fails before implementation and passes after implementation.

**Execution result:** Added `opencode_canonical_events_keep_provider_id_out_of_display_identity`, which failed before implementation with provider-derived assistant display ids and an empty tool display id.

- [x] **Unit 2: Generate Acepe-Owned OpenCode Display Ids**

**Goal:** Replace provider-derived text display ids and empty tool display ids in OpenCode canonical events.

**Requirements:** R1, R3, R12, R23

**Files:**
- Modify: `packages/desktop/src-tauri/src/session_converter/opencode.rs`

**Approach:**
- Enumerate OpenCode message order while materializing canonical events.
- For user text events, use a deterministic display id such as `opencode-event-{message_index}:user`.
- For assistant text events, use a deterministic display id such as `opencode-event-{message_index}:assistant`.
- For tool events, set `display_id` to the promoted `tool_call_id`.
- Keep `provider_row_id` and `provider_msg_id` as `msg.id`.

**Verification:**
- Existing OpenCode provider-owned snapshot test is updated to expect Acepe-owned ids.
- New provider-id reuse test passes.

**Execution result:** OpenCode text events now use deterministic order-owned ids like `opencode-event-1:assistant`; tool events explicitly use the promoted `tool_call_id` as `display_id`.

- [x] **Unit 3: Update Architecture Documentation And Guard Scan**

**Goal:** Make the cross-provider identity rule explicit for OpenCode.

**Requirements:** R27

**Files:**
- Modify: `docs/solutions/architectural/live-transcript-display-identity-boundary-2026-05-18.md`

**Approach:**
- Add OpenCode note under historical replay boundary.
- Add guard scan for `opencode:{}:user`, `opencode:{}:assistant`, and empty tool display ids in canonical event materializers.

**Verification:**
- Guard scan has no production matches for provider-derived OpenCode display ids.

**Execution result:** Updated the durable architecture doc with the OpenCode rule and guard scan.

## Verification Plan

- Focused Rust tests:
  - `cd packages/desktop/src-tauri && cargo test opencode_provider_owned_snapshot_promotes_canonical_transcript_events --quiet`
  - `cd packages/desktop/src-tauri && cargo test opencode_canonical_events_keep_provider_id_out_of_display_identity --quiet`
- Broader Rust tests:
  - `cd packages/desktop/src-tauri && cargo test session_converter::opencode --quiet`
  - `cd packages/desktop/src-tauri && cargo test transcript_projection --quiet`
- TypeScript check:
  - `cd packages/desktop && bun run check`
- Guard scan:
  - `rg -n "opencode:\\{\\}:user|opencode:\\{\\}:assistant|display_id: String::new\\(\\)" packages/desktop/src-tauri/src/session_converter`

Expected result: OpenCode provider ids remain metadata, text display ids are order-owned, tool display ids are explicit canonical tool ids.

## Current Verification

- `cd packages/desktop/src-tauri && cargo test opencode_canonical_events_keep_provider_id_out_of_display_identity --quiet`
  - failed before implementation with provider-derived assistant display ids and empty tool display id
  - passed after implementation: 1 test
- `cd packages/desktop/src-tauri && cargo test opencode_provider_owned_snapshot_promotes_canonical_transcript_events --quiet`
  - passed: 1 test
- `cd packages/desktop/src-tauri && cargo test session_converter::opencode --quiet`
  - passed: 2 tests
- `cd packages/desktop/src-tauri && cargo test transcript_projection --quiet`
  - passed: 22 tests
- `cd packages/desktop && bun run check`
  - passed with the existing SvelteKit `baseUrl`/`paths` warning
- Guard scans:
  - no provider-derived OpenCode display id patterns in canonical event materializers
  - no stale provider-message-id identity wording outside the expected architecture note
- `git diff --check`
  - passed
