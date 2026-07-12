---
title: "refactor: Live transcript identity boundary"
type: refactor
status: active
date: 2026-05-18
origin: docs/brainstorms/2026-04-25-final-god-architecture-requirements.md
depends_on:
  - docs/plans/2026-05-17-002-refactor-canonical-transcript-event-materialization-plan.md
  - docs/plans/2026-05-18-001-refactor-full-god-session-transcript-authority-plan.md
  - docs/plans/2026-05-18-002-refactor-canonical-ui-session-projections-plan.md
  - docs/solutions/best-practices/canonical-ui-session-selector-boundary-2026-05-18.md
---

# Refactor: Live Transcript Identity Boundary

## Overview

This plan continues the GOD architecture cleanup from `main` after PR #194. The next risk is no longer the UI layer. The risk is the live transcript projection path still being able to use provider assistant ids as display entry ids.

The target architecture is stricter:

```text
provider live update
  -> Rust canonical transcript event / operation graph
  -> Acepe-owned display entry id
  -> TypeScript display projection
```

Raw provider message ids may remain metadata and grouping hints at the provider edge. They must not be the durable display identity that decides where later assistant text lands.

## Planning Inventory

Inventory was collected before implementation planning from `main` on 2026-05-18.

### Real GOD Violation Candidates

- `packages/desktop/src-tauri/src/acp/transcript_projection/runtime.rs`
  - `assistant_entry_id_for_chunk(...)` builds `provider_key` from `message_id` or `part_id`.
  - If an entry with that provider key already exists in the current turn, it reuses that provider key as the transcript `entry_id`.
  - Risk: a provider can emit assistant text, then a tool call, then more assistant text with the same provider `message_id`. The later text can append to the earlier assistant entry instead of creating a new Acepe-owned entry after the tool row.
  - GOD issue: provider `message_id` becomes display identity and grouping authority.

- `packages/desktop/src-tauri/src/acp/transcript_projection/delta.rs`
  - The `#[cfg(test)]` helper `TranscriptDeltaOperation::from_session_update(...)` uses `message_id` as `entry_id` for assistant chunks.
  - Risk: tests can still encode the old identity contract and hide production drift.
  - GOD issue: test helpers should model the canonical contract, not preserve provider-id identity shortcuts.

- `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
  - `getHotState(...)` and `getSessionRuntimeState(...)` remain public store methods.
  - UI surfaces no longer use them for session semantics, but the doors remain open.
  - GOD issue: broad session objects are still easy to reintroduce into UI or service code.

- `packages/desktop/src/lib/acp/store/services/interfaces/session-state-reader.ts`
  - Service interface still exposes `getHotState(...)`.
  - Current production uses are residual-local fields (`acpSessionId`, `autonomousTransition`), but the interface is wider than the need.
  - GOD issue: service seams should ask for exact local fields, not the full transient projection.

- `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts`
  - Compatibility transcript methods still exist as production methods:
    - `preloadCompatibilityEntriesAndBuildIndex`
    - `recordCompatibilityToolCallTranscriptEntry`
    - `updateCompatibilityToolCallTranscriptEntry`
    - `aggregateCompatibilityAssistantChunk`
    - `aggregateCompatibilityUserChunk`
  - Their names are now honest, but they still sit on the concrete store.
  - GOD issue: compatibility doors remain reachable from production code instead of being fully internal or test-only.

### Mostly Legal Or Lower-Risk Findings

- `packages/desktop/src-tauri/src/session_jsonl/parser/full_session.rs`
  - `assistant_merge_key(...)` still prefers Claude `message.id` for text/thinking fragments.
  - The parser now refuses to merge tool-use blocks into assistant text fragments, so it does not appear to carry the original duplicate-id tool-row bug by itself.
  - The comment saying “stable Claude message.id” is misleading and should be softened, but this is lower risk than the live runtime projection.

- `packages/desktop/src-tauri/src/session_converter/transcript_events.rs`
  - Converts provider history into `CanonicalTranscriptEvent` with `transcript_seq`, `provider_row_id`, `provider_msg_id`, `block_index`, `display_id`, and `tool_call_id`.
  - It intentionally normalizes split assistant fragments before TypeScript sees them.
  - This is the right layer for provider quirks, but tests should keep proving that display ids are Acepe-owned when provider ids repeat.

- Panel hot-state reads remain legal when they are panel UI state: drafts, browser/sidebar UI, pending local composer visuals, and review UI.

## Problem Frame

Acepe already moved transcript authority upstream, but the live projection path still has an old identity shortcut: “same provider assistant id means same visible assistant entry.” That is exactly the shape of the duplicate-id bug class.

Even if most providers behave well today, production-grade architecture should not make raw provider ids the display-entry key. Provider ids are metadata. The canonical projection should choose whether chunks belong to the same visible assistant entry based on canonical ordering and boundaries, especially tool-call boundaries.

## Requirements Trace

- R1. Provider facts flow through Rust-owned canonical data before TypeScript display projection.
- R3. Transcript order and transcript identity are product truth.
- R12. UI and store projections consume canonical state; they do not repair provider quirks.
- R23. Desktop stores consume and project canonical state, not repair it.
- R27. Old authorities must be deleted or quarantined with proof.

## Scope Boundaries

- This plan does not redesign the whole transcript graph.
- This plan does not remove panel-local UI state.
- This plan does not change provider history parser semantics unless tests prove a live/history parity gap.
- This plan does not remove canonical snapshot/delta APIs.
- This plan does not make historical sessions read-only or weaken reconnect.

## Key Technical Decisions

- **Use Acepe-owned assistant entry ids for live assistant rows.** Provider `message_id` may group compatible text/thinking chunks before a boundary, but it must not become the transcript `entry_id`. A tool row closes the active assistant display entry.
- **Treat `tool_call.id` as tool identity, not assistant display identity.** Tool rows still use canonical tool-call identity because that is the provider-owned tool id promoted by the canonical operation model.
- **Narrow public store/service APIs after fixing backend identity.** The deeper correctness bug is upstream; after it is green, remove broad TypeScript doors that would reintroduce the same class downstream.
- **Keep compatibility methods only where unavoidable.** If production callers still need compatibility paths, hide them behind internal interfaces and test helpers instead of broad store methods.

## Implementation Units

- [x] **Unit 1: Failing Live Transcript Identity Test**

**Goal:** Prove that repeated provider assistant ids across a tool boundary do not collapse later text into the earlier assistant entry.

**Requirements:** R1, R3, R27

**Files:**
- Test: `packages/desktop/src-tauri/src/acp/transcript_projection/runtime.rs`
- Test: `packages/desktop/src-tauri/src/acp/session_state_engine/graph.rs` if graph materialization coverage needs the full path

**Approach:**
- Add a Rust test that applies live updates in this order:
  - user message,
  - assistant text chunk with `message_id = msg_same`,
  - tool call `toolu_1`,
  - assistant text chunk with `message_id = msg_same`.
- Assert the transcript snapshot order is user, first assistant, tool, second assistant.
- Assert both assistant entries have Acepe-owned entry ids, not `msg_same`.
- Assert the second assistant does not append onto the first assistant row.

**Test scenarios:**
- Happy path: consecutive text chunks with the same provider id and no tool boundary still merge into one Acepe-owned assistant entry.
- Bug path: same provider id after a tool boundary creates a new assistant entry after the tool row.
- Edge case: missing provider id still uses generated Acepe-owned ids and preserves order.

**Verification:**
- The new test fails before implementation and passes after Unit 2.

**Execution result:** Added `reused_assistant_message_id_after_tool_boundary_starts_new_entry`. It failed before the implementation because the trailing assistant text appended to the earlier assistant row.

- [x] **Unit 2: Make Live Assistant Entry Identity Boundary-Aware**

**Goal:** Replace provider-id-as-entry-id behavior with canonical boundary-aware assistant entry ids.

**Requirements:** R1, R3, R23

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/transcript_projection/runtime.rs`
- Modify: `packages/desktop/src-tauri/src/acp/client_message_ids.rs` only if missing-id normalization must expose a stronger boundary signal

**Approach:**
- Track assistant display entries by current turn and boundary, not only by provider id.
- Keep provider id as metadata/grouping input, never final display identity.
- A tool call, user message, turn completion, or error must close the active assistant display entry.
- Use `assistant-event-{event_seq}` or a similarly Acepe-owned deterministic id for new assistant entries.

**Test scenarios:**
- Same provider id before a tool boundary merges compatible text/thought chunks into an Acepe-owned entry.
- Same provider id after a tool boundary creates a new Acepe-owned assistant entry.
- Different provider ids in the same turn create distinct Acepe-owned entries in arrival order.
- Replaying a snapshot followed by live chunks does not overwrite restored entries.

**Verification:**
- Focused Rust tests for `acp::transcript_projection` pass.

**Execution result:** Live transcript projection now closes assistant lineage at user/tool/error/turn boundaries through an internal assistant boundary entry count. The red test passes.

- [x] **Unit 3: Align Test Helpers With Canonical Identity**

**Goal:** Remove test-only shortcuts that encode provider `message_id` as transcript `entry_id`.

**Requirements:** R3, R27

**Files:**
- Modify: `packages/desktop/src-tauri/src/acp/transcript_projection/delta.rs`
- Modify tests that depend on `TranscriptDeltaOperation::from_session_update(...)`

**Approach:**
- Prefer deleting the helper if production no longer needs it.
- If a helper is still useful, route it through the same stateful runtime projection logic rather than creating a second stateless id rule.
- Keep helper output identical to production behavior so future tests cannot pass with the old identity rule.

**Test scenarios:**
- Existing transcript delta tests still pass through production projection behavior.
- A test that repeats provider ids across tool boundaries cannot pass by accidental provider-id reuse.

**Verification:**
- Focused Rust tests for transcript projection and session state envelopes pass.

**Execution result:** Deleted the test-only `TranscriptDelta::from_session_update(...)` helper so tests cannot encode provider `message_id` as assistant `entry_id`. `delta.rs` now keeps only wire-shape coverage.

## Current Verification

After Units 1-3:

- `cd packages/desktop/src-tauri && cargo test transcript_projection --quiet`
  - 22 passed, 0 failed
- `cd packages/desktop && bun run check`
  - passed with the existing SvelteKit `baseUrl`/`paths` warning
- `git diff --check`
  - passed

- [x] **Unit 4: Narrow TypeScript Session Reader Doors**

**Goal:** Remove broad transient/runtime readers from production-facing service seams.

**Requirements:** R12, R23, R27

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/services/interfaces/session-state-reader.ts`
- Modify: `packages/desktop/src/lib/acp/store/services/session-connection-manager.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-event-handler.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts`
- Test: `packages/desktop/src/lib/acp/store/services/__tests__/session-messaging-service-send-message.test.ts`

**Approach:**
- Replace service `getHotState(...)` use with exact methods:
  - provider session id mapping,
  - autonomous transition busy state,
  - capability mutation state if still needed.
- Keep `SessionTransientProjectionStore` internal to `SessionStore`.
- If `getSessionRuntimeState(...)` is no longer used by production UI or services, delete it or mark it test-only through explicit test access helpers.

**Test scenarios:**
- Autonomous toggle still rejects overlapping transitions.
- ACP session id lookup still reconnects/resumes correctly.
- Composer state still fails closed before canonical lifecycle hydration.
- Scans show migrated UI/service paths do not call broad session hot/runtime getters.

**Verification:**
- `bun run check`
- focused Bun tests for session-store projection and messaging service

**Execution progress:**
- Removed `getHotState(...)` from `ISessionStateReader`.
- Replaced `SessionConnectionManager` broad hot-state reads with exact selectors:
  - `getSessionAcpSessionId(...)`
  - `getSessionAutonomousTransitionBusy(...)`
- Updated focused service and repository tests to mock exact selectors instead of full transient projection state.
- Removed `getHotState(...)` from `SessionEventHandler`; the event service does not read broad transient session state.
- Made `SessionStore.getHotState(...)` private, so production callers and tests must use exact selectors instead of the full transient projection object.
- Kept `getSessionRuntimeState(...)` public because it is an exact derived runtime selector, not a broad transient-state reader.
- Verification passed:
  - `cd packages/desktop && bun run check`
  - `cd packages/desktop && bun test src/lib/acp/store/services/session-connection-manager.test.ts src/lib/acp/store/services/__tests__/session-messaging-service-send-message.test.ts src/lib/acp/store/services/__tests__/session-messaging-service-stream-lifecycle.test.ts src/lib/acp/store/services/__tests__/session-repository-placeholder-title.test.ts src/lib/acp/store/services/__tests__/session-repository-refresh-source-path.test.ts src/lib/acp/store/services/__tests__/session-repository-startup-sessions.test.ts`
  - `cd packages/desktop && bun test ./src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts ./src/lib/acp/store/__tests__/session-store-create-session.vitest.ts ./src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts src/lib/acp/store/services/session-connection-manager.test.ts src/lib/acp/store/services/__tests__/session-messaging-service-send-message.test.ts src/lib/acp/store/services/__tests__/session-messaging-service-stream-lifecycle.test.ts src/lib/acp/store/services/__tests__/session-repository-placeholder-title.test.ts src/lib/acp/store/services/__tests__/session-repository-refresh-source-path.test.ts src/lib/acp/store/services/__tests__/session-repository-startup-sessions.test.ts ./src/lib/acp/store/__tests__/urgency-tabs-store.test.ts ./src/lib/components/main-app-view/tests/panel-handler.test.ts`
    - 230 passed, 0 failed
- Production scan passed for this seam:
  - `ISessionStateReader` no longer exposes `getHotState(...)`.
  - `SessionConnectionManager` no longer calls `stateReader.getHotState(...)`.
  - `SessionEventHandler` no longer exposes `getHotState(...)`.
  - `SessionStore.getHotState(...)` has no public callers; it is now private internal glue around `SessionTransientProjectionStore`.

- [x] **Unit 5: Hide Or Delete Compatibility Transcript Writer Doors**

**Goal:** Make remaining compatibility transcript writers internal or test-only.

**Requirements:** R1, R3, R23, R27

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/services/interfaces/entry-store-internal.ts`
- Modify: `packages/desktop/src/lib/acp/store/__tests__/entry-store-test-access.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/session-entry-store-streaming.vitest.ts`
- Test: `packages/desktop/src/lib/acp/store/services/__tests__/chunk-aggregator.test.ts`
- Test: `packages/desktop/src/lib/acp/store/services/__tests__/transcript-tool-call-buffer.test.ts`

**Approach:**
- Search production callers first.
- Move test-only access into explicit test helpers.
- Keep compatibility methods only on narrow internal interfaces used by compatibility services.
- Do not remove canonical `replaceTranscriptSnapshot` or `applyTranscriptDelta`.

**Test scenarios:**
- Existing compatibility streaming tests pass through test helpers.
- Production `SessionStore` no longer exposes user/assistant chunk aggregation as a public method.
- Canonical transcript snapshot/delta materialization remains unchanged.

**Verification:**
- Deletion scan shows no compatibility writer methods on public production store APIs except the internal compatibility interface.

**Execution result:**
- Deleted the public `SessionStore.aggregateCompatibilityUserChunk(...)` wrapper.
- Made these `SessionEntryStore` compatibility writer methods private:
  - `preloadCompatibilityEntriesAndBuildIndex(...)`
  - `recordCompatibilityToolCallTranscriptEntry(...)`
  - `updateCompatibilityToolCallTranscriptEntry(...)`
  - `aggregateCompatibilityUserChunk(...)`
  - `aggregateCompatibilityAssistantChunk(...)`
- Added explicit test-access helpers in `packages/desktop/src/lib/acp/store/__tests__/entry-store-test-access.ts`.
- Rewired tests to call compatibility-only helpers instead of public store methods.
- Replaced stale compatibility user-row setup in `session-store-projection-state.vitest.ts` with a canonical transcript snapshot operation.
- Verification passed:
  - `cd packages/desktop && bun run check`
  - `cd packages/desktop && bun test ./src/lib/acp/store/__tests__/assistant-chunk-aggregation.test.ts ./src/lib/acp/store/__tests__/chunk-aggregation-bug.test.ts ./src/lib/acp/store/__tests__/chunk-fragmentation-scenarios.vitest.ts ./src/lib/acp/store/__tests__/operation-store.vitest.ts ./src/lib/acp/store/__tests__/session-entry-store-streaming.vitest.ts ./src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts ./src/lib/acp/store/__tests__/tool-call-event-flow.test.ts src/lib/acp/store/services/__tests__/chunk-aggregator.test.ts src/lib/acp/store/services/__tests__/session-messaging-service-stream-lifecycle.test.ts ./src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts`
    - 255 passed, 0 failed

- [x] **Unit 6: Documentation And Deletion-Proof Scans**

**Goal:** Record the final proof that live transcript identity, broad state reads, and compatibility doors are closed.

**Requirements:** R27

**Files:**
- Modify: `docs/plans/2026-05-18-003-refactor-live-transcript-identity-boundary-plan.md`
- Modify or add: `docs/solutions/architectural/*`

**Approach:**
- Record scan commands and expected results.
- Update learning docs only with behavior that is actually implemented and verified.

**Verification:**
- Rust focused tests pass.
- `bun run check` passes.
- focused Bun tests pass.
- deletion scans are recorded with no unexpected matches.

**Execution result:**
- Added `docs/solutions/architectural/live-transcript-display-identity-boundary-2026-05-18.md`.
- Removed the last live projection provider-key fallback; raw provider message ids cannot rehydrate assistant display lineage.
- Updated Rust tests that asserted the old fallback to assert the GOD rule instead.
- Review pass found and fixed a replay/live interleaving gap: `apply_delta(...)` now closes the assistant boundary when canonical user/tool/error rows are applied, so stale live grouping state cannot cross a replayed canonical boundary.
- Final verification passed:
  - `cd packages/desktop/src-tauri && cargo test transcript_projection --quiet`
    - 22 passed, 0 failed
  - `cd packages/desktop && bun run check`
    - passed with the existing SvelteKit `baseUrl`/`paths` warning
  - `cd packages/desktop && bun test ./src/lib/acp/store/__tests__/assistant-chunk-aggregation.test.ts ./src/lib/acp/store/__tests__/chunk-aggregation-bug.test.ts ./src/lib/acp/store/__tests__/chunk-fragmentation-scenarios.vitest.ts ./src/lib/acp/store/__tests__/operation-store.vitest.ts ./src/lib/acp/store/__tests__/session-entry-store-streaming.vitest.ts ./src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts ./src/lib/acp/store/__tests__/tool-call-event-flow.test.ts src/lib/acp/store/services/__tests__/chunk-aggregator.test.ts src/lib/acp/store/services/__tests__/session-messaging-service-stream-lifecycle.test.ts ./src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts`
    - 255 passed, 0 failed
  - `git diff --check`
    - passed
- Guard scans:
  - Provider fallback scan for `return provider_key`, `insert(scoped_key, provider_key`, and `provider_entry_is_in_current_assistant_boundary` returned no matches.
  - State-reader scan for `stateReader.getHotState` returned no matches.
  - Public compatibility call scan returned only private `SessionEntryStore` wrappers delegating to `ChunkAggregator`; no external production callers.

## Review Gate

Manual headless review was run during planning because subagent dispatch was unavailable in this Codex session. Findings resolved:

- Assistant entries must be Acepe-owned even before a tool boundary; provider ids may group chunks but must not become display identity.
- Test helpers must not create a second projection rule; delete them or route through production runtime projection.

Before implementation, rerun `mode:headless docs/plans/2026-05-18-003-refactor-live-transcript-identity-boundary-plan.md` if additional scope is added. This plan changes canonical transcript identity and must not go directly from planning to code without review.

## Risks

| Risk | Mitigation |
|------|------------|
| Breaking legitimate text/thought chunk aggregation | Unit 1 includes the happy path where same-provider text chunks before a tool boundary still merge. |
| Creating nondeterministic display ids | Use event sequence or another canonical monotonic source, not UUIDs in projection output. |
| Fixing live path but not tests | Unit 3 aligns helpers with production identity rules. |
| Removing useful local state | Unit 4 narrows residual fields instead of deleting local state blindly. |
| Compatibility test churn | Unit 5 moves test access to explicit helpers instead of preserving public production doors. |

## Sources & References

- Origin requirements: `docs/brainstorms/2026-04-25-final-god-architecture-requirements.md`
- Related plan: `docs/plans/2026-05-17-002-refactor-canonical-transcript-event-materialization-plan.md`
- Related plan: `docs/plans/2026-05-18-001-refactor-full-god-session-transcript-authority-plan.md`
- Related plan: `docs/plans/2026-05-18-002-refactor-canonical-ui-session-projections-plan.md`
- Related learning: `docs/solutions/best-practices/canonical-ui-session-selector-boundary-2026-05-18.md`
- Key file: `packages/desktop/src-tauri/src/acp/transcript_projection/runtime.rs`
- Key file: `packages/desktop/src-tauri/src/session_converter/transcript_events.rs`
