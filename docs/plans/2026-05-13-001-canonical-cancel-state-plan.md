---
title: fix: Canonical cancel state for stopped turns
type: fix
status: active
date: 2026-05-13
---

# fix: Canonical cancel state for stopped turns

## Overview

Stopping a running thread can leave the UI split: the transcript shows `Info: Operation cancelled by user`, while canonical activity still says work is active. The correct fix is not a Svelte-side override. Cancellation must become a Rust-owned canonical terminal transition that clears busy actionability and cancels active operations before TypeScript renders the next frame.

This plan follows the GOD rule: lifecycle, activity, turn state, active turn failure, last terminal turn id, and operation state are canonical-owned. TypeScript readers must not infer cancelled state from text, hot state, or local button clicks.

## Problem Frame

`packages/desktop/src-tauri/src/acp/commands/interaction_commands.rs` handles `acp_cancel` by calling `client_guard.cancel(session_id)`. That sends the provider interrupt/cancel command, but it does not emit a canonical session update that says the turn is now terminal. Some providers later surface user cancellation as transcript text or a turn error, but the canonical projection can still contain active `pending`/`running`/`blocked` operations. The frontend correctly trusts canonical state, so it keeps showing Stop and `Editing`.

The fix belongs in the Rust event/projection path:

- cancel command succeeds,
- Rust emits a canonical cancellation update,
- projection marks the turn terminal and active operations cancelled,
- session-state envelope includes updated turn/activity and operation patches,
- existing TS canonical derivations naturally produce `showStop=false`, `canSubmit=true`, and tool status `cancelled`.

## Requirements Trace

- R1. After a successful user Stop, canonical state must stop reporting the session as busy.
- R2. Active operations in the cancelled turn must become `OperationState::Cancelled`.
- R3. TypeScript composer state must continue to read `canSubmit`, `showStop`, activity, and turn state from canonical data only.
- R4. TypeScript tool rendering must continue to read operation presentation state from canonical operations only.
- R5. Late provider events for the cancelled turn must not reopen the cancelled turn or change cancelled operations back to running.
- R6. Non-cancel failures must still render as failures, not cancelled.
- R7. The implementation must preserve real missing-operation degraded states and must not hide canonical data problems.
- R8. After cancellation, canonical lifecycle/actionability must be sendable again when the session is otherwise usable; the frontend must not rely on connection-manager hot state to re-enable Send.

## Scope Boundaries

- Do not add local `cancelRequested` UI state to override canonical busy/actionability.
- Do not parse transcript text like `Operation cancelled by user` in Svelte or TS materializers.
- Do not use `canonical ?? hotState` fallbacks.
- Do not write lifecycle, activity, turn state, active failure, or operation state into hot state.
- Do not branch in TS by provider id.
- Do not remove existing degraded `Unresolved tool` behavior.

## GOD Architecture Classification

| Field / behavior | Classification | Required source |
| --- | --- | --- |
| `turnState` after Stop | canonical-owned | Rust `SessionStateGraph` |
| `activity.kind` after Stop | canonical-owned | Rust selector from projection |
| `lifecycle.actionability.canSend` | canonical-owned | Rust lifecycle/actionability |
| active operation status | canonical-owned | Rust `OperationSnapshot.operation_state` |
| composer `showStop` / `canSubmit` | canonical-owned | `deriveCanonicalAgentPanelSessionState` |
| tool card `Editing` / `Cancelled` | canonical-owned | operation presentation status |
| pre-send click guard | truly-local | existing `pendingSendIntent` only |

No new hot-state field is allowed for this fix.

## Context & Research

### Relevant Code

- `packages/desktop/src-tauri/src/acp/commands/interaction_commands.rs` owns `acp_cancel`; it currently only calls `client_guard.cancel(session_id)`.
- `packages/desktop/src-tauri/src/acp/client/session_lifecycle.rs` sends generic ACP `session/cancel`.
- `packages/desktop/src-tauri/src/acp/client/codex_native_client.rs` sends `turn/interrupt` and clears its local current turn id.
- `packages/desktop/src-tauri/src/acp/client/cc_sdk_client.rs` interrupts the SDK client and cancels pending questions.
- `packages/desktop/src-tauri/src/acp/session_update/types/session_update.rs` has `TurnComplete` and `TurnError`, but no first-class `TurnCancelled` update.
- `packages/desktop/src-tauri/src/acp/domain_events.rs` already has `SessionDomainEventKind::TurnCancelled`, so the domain language exists but is not wired through `SessionUpdate`.
- `packages/desktop/src-tauri/src/acp/projections/mod.rs` clears active tool ids on `TurnError`, but does not mark active operations cancelled/failed at terminal-turn time.
- `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs` emits turn-state deltas for `TurnComplete` and `TurnError`, with `operation_patches: Vec::new()`.
- `packages/desktop/src/lib/acp/components/agent-panel/logic/session-status-mapper.ts` maps canonical lifecycle/activity/turn into UI actionability.
- `packages/desktop/src/lib/acp/session-state/agent-panel-graph-materializer.ts` maps canonical operation state into tool presentation.

### Institutional Learnings

- `docs/solutions/ui-bugs/agent-panel-composer-split-brain-canonical-actionability-2026-04-30.md` says Send/Stop, busy state, and planning indicators must come from canonical derivation only.
- `docs/solutions/architectural/canonical-projection-widening-2026-04-28.md` says canonical projections are Rust-authored and hot state is only for local transient affordances.
- `docs/solutions/best-practices/canonical-session-projection-ui-derivation-2026-05-01.md` says UI-visible lifecycle, activity, and turn state must derive from canonical projection.

### External Research

None. This is internal Acepe architecture; local GOD guidance and existing Rust projection patterns are the source of truth.

## Key Technical Decisions

- Add a first-class cancellation update instead of text inference. `SessionUpdate::TurnCancelled` should be the canonical event for user Stop.
- Treat cancelled as a terminal turn state. Prefer widening `SessionTurnState` with `Cancelled` so cancellation is neither success nor failure.
- Cancel active operations in the projection at the terminal cancellation transition. The frontend should see operation patches with `operation_state = "cancelled"`.
- Include operation patches in terminal turn-state deltas. Otherwise the frontend may receive the terminal turn but keep stale operation rows.
- Keep TypeScript as a canonical reader. TS changes should be limited to accepting the widened `Cancelled` state and mapping it to non-busy/sendable presentation.
- Generalize terminal-turn preservation. The existing failed-turn protection should become terminal-turn protection for `Failed` and `Cancelled`, including `turn_id: None` cancellation updates that must protect the stopped turn until a new user turn starts.
- Treat cancel command output as canonical input. If a provider can return the active turn id, carry it in a provider-agnostic cancel outcome. If no turn id is available, the projection must still handle `turn_id: None` safely instead of letting late same-turn events reopen work.

## Implementation Units

- [ ] **Unit 1: Add canonical cancellation model and tests**

**Goal:** Add a test-first canonical model for user cancellation.

**Requirements:** R1, R2, R5, R6

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/session_update/types/session_update.rs`
- Modify: `packages/desktop/src-tauri/src/acp/projections/mod.rs`
- Modify: `packages/desktop/src-tauri/src/acp/session_update_parser.rs`
- Modify: `packages/desktop/src-tauri/src/session_jsonl/export_types.rs`
- Test: `packages/desktop/src-tauri/src/acp/projections/mod.rs`
- Test: `packages/desktop/src-tauri/src/acp/session_update_parser.rs`

**Approach:**
- Add `SessionUpdate::TurnCancelled { session_id, turn_id }`.
- Add `SessionTurnState::Cancelled` in `packages/desktop/src-tauri/src/acp/projections/mod.rs`.
- Extend domain event conversion so `TurnCancelled` emits `SessionDomainEventKind::TurnCancelled`.
- Add projection tests where a running edit operation receives `TurnCancelled`; assert turn state is `Cancelled`, active tool ids are cleared, active failure is `None`, last terminal turn id is recorded, and operation state is `Cancelled`.
- Replace failed-only preservation with terminal-turn preservation for `Failed` and `Cancelled`. Tool updates and late terminal updates for the preserved terminal turn must not restart the turn.
- Add a late-event test: after `TurnCancelled`, late same-turn tool updates or terminal events must not make cancelled operations running again.
- Add a `turn_id: None` cancellation test: a generic cancellation without a known turn id must preserve cancelled state until the next user turn starts.
- Add a new-user-turn test: after cancellation, a real new user message may start a fresh running turn and clear terminal cancellation state.

**Test scenarios:**
- Running operation + `TurnCancelled` -> turn is `Cancelled`, operation is `Cancelled`.
- Multiple active operations + `TurnCancelled` -> every active operation is `Cancelled`.
- Non-active completed operation + `TurnCancelled` -> completed operation stays `Completed`.
- `TurnError` from non-cancel failure -> operation state is failed or failure behavior remains unchanged, never cancelled.
- Late provider `TurnError` after `TurnCancelled` for same turn -> cancelled state is preserved.
- Late provider `TurnError` after `TurnCancelled { turn_id: None }` -> cancelled state is preserved.
- New user message after cancellation -> new turn can become `Running`.

- [ ] **Unit 2: Emit cancellation update from the Rust cancel command**

**Goal:** Make successful `acp_cancel` publish canonical cancellation immediately.

**Requirements:** R1, R2, R3, R5, R8

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/commands/interaction_commands.rs`
- Modify: `packages/desktop/src-tauri/src/acp/client_trait.rs` if the command path should carry a provider-agnostic cancel outcome
- Modify: provider clients only if they can report the active turn id without leaking provider-specific behavior
- Test: `packages/desktop/src-tauri/src/acp/commands/tests.rs`

**Approach:**
- After `client_guard.cancel(session_id)` succeeds, enqueue or apply `SessionUpdate::TurnCancelled`.
- Use the best available turn id. Prefer a provider-agnostic cancel outcome or canonical runtime snapshot lookup over provider-specific branching. If the generic command path cannot know it yet, emit `turn_id: None` and rely on the no-id terminal preservation rule from Unit 1.
- Do not emit cancellation if provider cancel returns an error.
- Keep provider-specific interrupt logic inside providers; the command layer only emits the provider-agnostic canonical cancellation update after success.
- Ensure the canonical graph/lifecycle path emits sendable actionability after cancellation when the session remains connected. This must be visible in the emitted session-state envelope, not only in TS hot connection state.

**Test scenarios:**
- Successful command cancel -> dispatcher receives `TurnCancelled`.
- Failed command cancel -> no `TurnCancelled` is emitted.
- Codex native cancel with current turn id -> cancellation update carries that turn id if plumbing is added.
- Generic ACP cancel with no turn id -> cancellation update still clears active work.
- Successful cancel -> next canonical graph state is non-busy and sendable when lifecycle permits sending.

- [ ] **Unit 3: Include operation patches in terminal cancellation envelopes**

**Goal:** Ensure TS receives cancelled operation states in the same canonical envelope family as turn/activity updates.

**Requirements:** R1, R2, R4, R7

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs`
- Modify: `packages/desktop/src-tauri/src/acp/session_state_engine/selectors.rs` only if `Cancelled` needs explicit activity handling
- Test: `packages/desktop/src-tauri/src/acp/session_state_engine/runtime_registry.rs`
- Test: `packages/desktop/src-tauri/src/acp/session_state_engine/selectors.rs`

**Approach:**
- Update `should_emit_turn_state_delta` to include `TurnCancelled`.
- Build terminal deltas with relevant changed operation patches, not an empty operation patch list. Bound this to operations changed by the terminal update, especially operations that were active immediately before cancellation.
- Ensure activity selection for `Cancelled` with no active operations returns idle, not awaiting model.
- Keep snapshot path consistent: full snapshots after cancel must also contain cancelled operations and non-busy activity.
- Include `operations` in changed fields when cancellation changes operation states.

**Test scenarios:**
- `TurnCancelled` delta includes `turn_state = Cancelled`, `activity.kind = Idle`, and operation patches for cancelled operations.
- Snapshot after cancellation contains the same operation states as the delta path.
- No active operations -> cancellation delta is still valid and sendable.
- Delta for cancellation does not resend unrelated completed operations as changed patches.

- [ ] **Unit 4: Regenerate/widen TypeScript canonical types and mappings**

**Goal:** Let the frontend understand the new canonical cancelled turn state without adding local authority.

**Requirements:** R3, R4

**Files:**
- Modify/generated: `packages/desktop/src/lib/services/acp-types.ts`
- Modify: `packages/desktop/src/lib/acp/store/canonical-turn-state-mapping.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/session-status-mapper.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/session-status-mapper.test.ts`
- Test: `packages/desktop/src/lib/acp/session-state/__tests__/agent-panel-graph-materializer.test.ts`

**Approach:**
- Regenerate or update Specta output so `SessionTurnState` includes `"Cancelled"`.
- Map canonical `"Cancelled"` to legacy hot `TurnState` `"interrupted"` only where legacy display adapters still need the old union.
- In `deriveCanonicalAgentPanelSessionState`, `Cancelled` should not be busy and should allow submit when lifecycle actionability says `canSend`.
- Add the smallest required TS exhaustiveness updates for the widened enum. Do not widen unrelated local state unless a compiler error proves that adapter still needs the value.
- Do not add local cancel state to `AgentInput`.
- Do not infer operation cancellation from `activeTurnFailure.message`.

**Test scenarios:**
- `ready + activity.idle + turnState.Cancelled + canSend=true` -> `isStreaming=false`, `showStop=false`, `canSubmit=true`.
- `turnState.Cancelled` maps to non-streaming viewport behavior.
- Tool entries with canonical `operation_state="cancelled"` render as `Cancelled`.
- `turnState.Running` still shows Stop.

- [ ] **Unit 5: Remove any temporary UI workaround and verify GOD compliance**

**Goal:** Make sure the shipped fix has one authority.

**Requirements:** R3, R4, R7

**Files:**
- Inspect: `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte`
- Inspect: `packages/desktop/src/lib/acp/session-state/agent-panel-graph-materializer.ts`
- Inspect: `packages/desktop/src/lib/acp/store/types.ts`

**Approach:**
- Confirm there is no `cancelRequestedSessionId`, no text matching for cancellation in TS, and no hot-state write for canonical fields.
- Confirm `SessionTransientProjection` was not widened.
- Run GOD scans for `canonical ?? hotState` style fallbacks and forbidden hot-state writes in touched files.

**Test scenarios:**
- Static scan: no new `updateHotState` writes for canonical fields.
- Static scan: no TS cancellation text matching.
- Existing `Unresolved tool` degraded tests still pass.

## Verification Plan

- `cd packages/desktop && bun run check`
- Focused TS tests:
  - `bun test src/lib/acp/components/agent-panel/logic/__tests__/session-status-mapper.test.ts`
  - `bun test src/lib/acp/session-state/__tests__/agent-panel-graph-materializer.test.ts`
- Focused Rust tests:
  - `cd packages/desktop/src-tauri && cargo test acp::projections`
- `cd packages/desktop/src-tauri && cargo test acp::session_state_engine`
- `cd packages/desktop/src-tauri && cargo test acp::commands`
- `cd packages/desktop/src-tauri && cargo clippy`
- If generated bindings are not updated by the Rust tests/build automatically, run the repository's existing Specta export path or update the generated file in the same shape as the Rust type.

## Risks

- Adding `SessionTurnState::Cancelled` is a generated-type widening and may reveal exhaustiveness gaps. That is good; fix each gap canonically.
- Some providers may emit late failure events after cancel. Projection tests must lock the intended precedence.
- Generic ACP cancel may not expose a turn id. The projection must handle `turn_id: None` without reopening or corrupting unrelated completed turns.

## Open Questions

- Should cancelled turns display as a distinct panel status or as connected/sendable idle? Planning decision: keep panel status sendable and non-busy unless product explicitly wants a separate visible cancelled status later.
- Should cancellation write an active turn failure? Planning decision: no. User cancellation is not an error; transcript/info text can remain as content, but `activeTurnFailure` should stay `None`.
