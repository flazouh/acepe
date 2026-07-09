---
title: feat: Show Claude Code compaction as canonical session activity
type: feature
status: reviewed
date: 2026-07-09
---

# feat: Show Claude Code compaction as canonical session activity

## Overview

Make Claude Code compaction visible in Acepe as Rust-owned canonical session activity.

Today Acepe can show the effect of compaction only indirectly: if Claude sends `usage_update` with `compaction: true`, Rust resets context usage to `0`, then the composer context meter may drop. Acepe does not preserve "a compaction happened" as product truth, does not show a transcript/activity row, and does not expose compact metadata such as trigger, pre/post tokens, duration, or precomputed status.

The target is a canonical compaction event lane:

```text
Claude raw compaction signal
        |
        v
Rust parser / provider history adapter
        |
        v
canonical SessionCompactionEvent
        |
        v
session state envelope + transcript viewport row
        |
        v
UI renders Context compaction with status and metadata
```

## Problem Frame

Current implementation facts:

- `cc_sdk_bridge.rs` handles Claude `Message::System` only for `usage_update`; other system subtypes return no `SessionUpdate`.
- `usage_update.compaction == true` becomes `UsageTelemetryUpdate` with `tokens.total = 0`.
- `UsageTelemetryUpdate` is non-transcript-bearing and routes only through the telemetry envelope.
- `ToolKind` has no compaction kind.
- `SessionUpdate` has no compaction event variant.
- SDK hook types include `PreCompactHookInput`, but the Claude Code client registers only the `PermissionRequest` hook.
- Local streaming samples did not show Claude `compact_boundary`, `compact_progress`, `Conversation compacted`, or `"compaction": true`.
- Claude transcript JSONL can contain durable `compact_boundary` records with `compactMetadata`.

User-facing gap:

- No visible "Context compaction" row.
- No running/preparing state.
- No post-compaction summary.
- No metadata table for trigger, pre/post token count, duration, dropped tokens, precomputed status, preserved messages, or cumulative dropped tokens.

## Requirements

- R1. Acepe must represent Claude Code compaction as canonical Rust-owned session truth, not as a TypeScript UI fallback.
- R2. A completed Claude `compact_boundary` record must produce a canonical compaction event.
- R3. A live `usage_update` with `compaction: true` must continue resetting context usage, and should be linkable to a compaction event when enough identity/timing exists.
- R4. A live `PreCompact` hook, if registered and delivered by Claude Code, should produce a running/preparing compaction event.
- R5. The transcript/activity display should show a compact row such as `Context compaction`, with status and core metadata.
- R6. The UI may render canonical compaction facts, but must not parse Claude-specific raw payloads or infer provider behavior.
- R7. Missing optional metadata must be allowed and displayed gracefully.
- R8. The feature must not model compaction as a normal tool call unless Rust explicitly promotes it into a canonical operation-like event. Preferred: session activity/transcript system event, not `ToolKind`.
- R9. The event identity must be Acepe-owned. Claude row ids and message ids are metadata only.
- R10. Tests must cover parser behavior, canonical envelope routing, TypeScript reduction, and UI presentation.
- R11. UI-visible changes must be verified with the Acepe QA wrapper after implementation.

## Scope Boundaries

In scope:

- Claude Code CLI compaction only.
- Canonical event type and envelope payload for compaction.
- Live best-effort start/reset handling from `PreCompact` and `usage_update.compaction`.
- Historical completed compaction from Claude `compact_boundary` JSONL records if that history parser path is available in this slice.
- A visible transcript/activity row with metadata.

Out of scope:

- Cross-provider compaction normalization.
- Determinate percent progress unless Claude provides real progress numerics.
- Deep redesign of transcript storage or row ledger.
- Account usage widgets or billing quota UI.
- Replaying every historical session in the repo as part of this feature.

## GOD Architecture Check

Authority surface: canonical session state and transcript viewport display.

Field classification:

| Field | Classification | Notes |
|---|---|---|
| compaction event id | canonical-owned | Acepe-generated stable id. |
| status | canonical-owned | `preparing`, `completed`, `usage_reset`, `failed` if supported. |
| trigger | canonical-owned with raw fallback | `auto`, `manual`, `unknown`, preserve raw value. |
| pre/post tokens | canonical-owned optional metadata | From `compactMetadata`. |
| duration | canonical-owned optional metadata | From `compactMetadata.durationMs`. |
| precomputed | canonical-owned optional metadata | Optional bool. |
| preserved metadata | canonical-owned optional metadata | Preserve known values plus raw metadata. |
| Claude transcript row id/path | provider-metadata | Debug/provenance only, not display identity. |
| UI expanded/collapsed state | truly-local | May live in Svelte if added. |

Violations to avoid:

- No TypeScript branch like `if agentId === "claude" && raw.subtype === "compact_boundary"`.
- No UI-only synthetic compaction row from telemetry reset.
- No raw provider id as display row id.
- No parser bypass from provider history directly into display rows.

Attestation: cleared if implementation widens canonical Rust models first and keeps UI rendering provider-neutral canonical compaction facts.

## User Experience

Completed event row:

```text
Context compaction
Auto compacted context: 470k -> 45k tokens
Dropped about 426k tokens · 6 ms · precomputed
```

Running/preparing event row:

```text
Context compaction
Preparing summary...
Triggered automatically
```

Metadata to display when present:

- trigger: manual / auto / unknown
- before tokens
- after tokens
- dropped tokens
- duration
- precomputed
- preserved message count
- cumulative dropped tokens

Metadata hidden by default or placed in a detail surface:

- raw provider row id
- transcript path
- raw compact metadata JSON
- custom instructions

Progress rule:

```text
If Claude emits only PreCompact:
  show indeterminate preparing/running state.

If Claude emits compact_boundary:
  show completed state with metadata.

If Claude later exposes compact_progress:
  add numeric progress only after Rust models the provider data.
```

## Technical Design

### Rust Data Model

Add a new canonical compaction model near session update/session state types:

```text
SessionCompactionEvent
  event_id: String
  session_id: String
  status: preparing | completed | usage_reset | failed
  trigger: auto | manual | unknown
  raw_trigger: Option<String>
  pre_tokens: Option<u64>
  post_tokens: Option<u64>
  dropped_tokens: Option<u64>
  duration_ms: Option<u64>
  precomputed: Option<bool>
  preserved_messages: Option<u64>
  cumulative_dropped_tokens: Option<u64>
  occurred_at_ms: Option<i64>
  provider_metadata: serde_json::Value
```

Add a `SessionUpdate::CompactionEvent { event, session_id }`.

Add a `SessionStatePayload::Compaction { event, revision }` for live session state, then separately emit a viewport buffer delta or push row when the event should appear in the transcript viewport. This avoids overloading usage telemetry and keeps compaction out of the operation graph.

### Parser Inputs

Handle these signals:

1. `Message::System { subtype: "usage_update", data: { compaction: true } }`
   - Existing telemetry reset remains.
   - Emit an additional `CompactionEvent` with `status = usage_reset` if we can attach session id.
2. `Message::System { subtype: "compact_boundary", data/content/metadata }`
   - Emit `CompactionEvent` with `status = completed`.
   - Parse `compactMetadata` if present.
3. `PreCompactHookInput`
   - Register a `PreCompact` hook in the Claude Code client.
   - Emit `CompactionEvent` with `status = preparing`.
   - Include trigger and custom instructions metadata.

If the live SDK does not deliver `compact_boundary`, historical parser support still gives completed events on reopen.

### Canonical Projection

Store latest and historical compaction events in a Rust-owned compaction projection owned by the session state engine. Do not store them in the operation graph.

Projection rules:

- Preparing event may be updated by a later completed event if session, trigger, and temporal proximity match.
- Usage reset may remain a separate small event if no matching compaction exists.
- Completed event should produce a transcript viewport row with canonical identity and metadata.
- Preparing event should produce or update a transcript viewport row only if live `PreCompact` can be registered cleanly without interfering with permission hooks.
- If matching is uncertain, do not merge destructively; display separate facts or mark relation as unknown.

### Transcript Viewport Row

Current viewport rows only support `TranscriptViewportRowContent::Transcript`, and `TranscriptEntryRole` is limited to user/assistant/tool. Do not force compaction through a fake transcript role or a fake tool call.

Add a row content type for compaction-specific session activity:

```text
TranscriptViewportRowKind::SessionActivity

TranscriptViewportRowContent::Compaction {
  event: TranscriptViewportCompactionEvent
}
```

The row must be produced by Rust and consumed as presentational props. This keeps the change narrow and avoids pretending compaction is an agent tool.

### TypeScript/UI

Regenerate or update specta-generated types as needed.

Update envelope reducer to store compaction events from canonical envelopes.

Add presentational rendering in the agent panel row renderer:

- icon: use an existing icon from the UI icon set if available; otherwise use neutral system/activity styling.
- status: show spinner/indeterminate state for `preparing`.
- completed summary: show before -> after token numbers.
- details: compact metadata lines.

Do not add Claude-specific parsing or matching in TypeScript.

## Files To Inspect Or Change

Rust:

- `packages/desktop/src-tauri/src/acp/session_update/types/session_update.rs`
- `packages/desktop/src-tauri/src/acp/session_update/types/interaction.rs` or a new dedicated type module
- `packages/desktop/src-tauri/src/acp/parsers/cc_sdk_bridge.rs`
- `packages/desktop/src-tauri/src/acp/parsers/shared_chat.rs`
- `packages/desktop/src-tauri/src/acp/parsers/claude_code_parser.rs`
- `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/mod.rs`
- `packages/desktop/src-tauri/src/acp/client/cc_sdk_client/permission_handler.rs` or new hook handler module
- `packages/desktop/src-tauri/src/acp/session_state_engine/protocol.rs`
- `packages/desktop/src-tauri/src/acp/session_state_engine/envelope_router.rs`
- `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs`
- `packages/desktop/src-tauri/src/acp/transcript_viewport/row.rs`
- `packages/desktop/src-tauri/src/acp/transcript_viewport/projection.rs`

TypeScript/Svelte:

- `packages/desktop/src/lib/services/acp-types.ts`
- `packages/desktop/src/lib/services/session-update-types.ts`
- `packages/desktop/src/lib/acp/store/envelope-reducer/*`
- `packages/desktop/src/lib/acp/store/types.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/*`
- `packages/ui/src/components/agent-panel/*` only if the presentational row lives in `@acepe/ui`

Tests:

- Rust parser tests near `cc_sdk_bridge.rs` and `types.rs`
- Rust envelope routing tests
- Transcript viewport row projection tests
- TypeScript envelope reducer tests
- UI component/model tests for compaction row rendering

## TDD Plan

Red tests first:

1. Rust parser test: `compact_boundary` system message emits `SessionUpdate::CompactionEvent` with parsed metadata.
2. Rust parser test: `usage_update.compaction == true` emits telemetry reset and a usage-reset compaction event.
3. Rust hook test: `PreCompactHookInput` creates a preparing compaction event or dispatchable canonical update.
4. Rust envelope test: compaction update routes to canonical compaction envelope and is transcript/activity bearing as intended.
5. TypeScript reducer test: compaction envelope stores a canonical compaction event without using hot state fallback.
6. UI/model test: completed compaction renders before/after token metadata; preparing compaction renders indeterminate progress.

Then implement smallest code to pass.

## Verification

Required:

- `cd packages/desktop && bun run check`
- focused Rust tests for parser/envelope/projection
- focused TS/Svelte tests for reducer/UI model
- DOM QA through repo wrapper:
  - `cd packages/desktop && bun run qa doctor`
  - observe/open a session state that can show a compaction event, or inject a test fixture route/state if available
  - `bun run qa inspect --selector=<compaction-row-selector>`
  - `bun run qa screenshot` if a visual row was added

If live Claude compaction state is unavailable, report behavioral live QA as blocked and verify with fixture/static DOM evidence only.

## Risks

- Claude live stream may not expose `compact_boundary`; historical support must not depend on live delivery.
- `PreCompact` may fire before useful token metadata exists, so live progress is indeterminate.
- Matching `PreCompact`, `usage_reset`, and `compact_boundary` may be ambiguous; avoid destructive merges.
- Adding a new transcript row type touches generated TS types and UI rendering.
- If compaction rows are stored as operation/tool rows, the UI could misrepresent runtime maintenance as a model tool. Prefer session activity.

## Open Questions

- This feature should introduce the first narrow session activity row type as `Compaction`; no existing row type carries the semantics.
- Where is the best historical Claude JSONL parser seam for `compact_boundary` in the current row ledger/reconnect architecture?
- Should preparing compaction rows be visible in the main transcript, the activity strip, or both?
- Should raw compact metadata be exposed behind a developer/debug disclosure, or only summarized?

## Implementation Notes

- Keep this Claude-only for now.
- Keep the report in `docs/solutions/integration-issues/claude-code-cli-compaction-behavior-2026-07-09.md` as background reference.
- Do not touch unrelated dirty files already present in the checkout.
- Fable second-opinion was attempted on 2026-07-09 but was blocked by a monthly spend limit.

## Document Review Result

Headless review was run manually because the active tool rules did not permit spawning reviewer agents without explicit subagent delegation. Findings:

- Coherence: fixed ambiguity around whether compaction should reuse a generic activity row or introduce a dedicated row type. The plan now chooses a narrow `Compaction` viewport row.
- Feasibility: confirmed current viewport content supports only transcript rows, so implementation must widen Rust and generated TypeScript types before UI rendering.
- Scope: keep the first slice Claude-only and avoid cross-provider normalization.
- GOD check: cleared only if implementation widens Rust canonical state first and avoids TypeScript provider-specific repair.
