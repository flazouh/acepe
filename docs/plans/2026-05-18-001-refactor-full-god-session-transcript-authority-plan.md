---
title: "refactor: Full GOD session and transcript authority"
type: refactor
status: completed
date: 2026-05-18
origin: docs/plans/2026-05-17-002-refactor-canonical-transcript-event-materialization-plan.md
depends_on:
  - docs/plans/2026-05-17-002-refactor-canonical-transcript-event-materialization-plan.md
  - docs/solutions/architectural/final-god-architecture-2026-04-25.md
  - docs/solutions/architectural/revisioned-session-graph-authority-2026-04-20.md
  - docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md
  - docs/solutions/logic-errors/terminal-state-guard-missing-blocked-2026-04-25.md
---

# Refactor: Full GOD Session And Transcript Authority

## Problem

Acepe has already started moving restored transcript truth into Rust-owned canonical transcript events, but the system still has several places that can decide session or transcript truth:

- Rust provider converters can still produce `StoredEntry` rows directly.
- `TranscriptSnapshot::from_stored_entries` still treats display-like rows as canonical input.
- The live transcript projection and the restored-history converter both own assistant entry identity logic.
- TypeScript still has live transcript builders, assistant id remaps, tool row buffers, and capability/lifecycle fallback windows.
- The Agent Panel still has more than one row materialization path.

That leaves the product one regression away from the original bug: a downstream layer can still make the UI look correct while the canonical model remains wrong.

## Goal

Make Rust canonical session data the only product truth for:

- transcript order
- transcript display identity
- assistant text/thought grouping
- tool row identity
- operation state and arguments
- interaction state
- lifecycle, turn state, activity, capabilities, and actionability

TypeScript may keep only local UI affordances: pending-send visuals, animation/reveal state, scroll state, local click guards, and input/composer draft state.

## GOD Authority Rules

| Surface | Owner | Rule |
| --- | --- | --- |
| Canonical transcript | Rust canonical transcript event reducer | Provider rows/events become canonical events before snapshots or UI rows exist. |
| Transcript snapshot/delta | Rust transcript projector | Built from canonical transcript events, not `StoredEntry`. |
| Operation graph | Rust operation projection | Tool arguments/status/results are merged once in Rust. |
| Interaction graph | Rust interaction projection | Questions, permissions, and plan approvals are product state. |
| Lifecycle/capabilities | Rust `SessionStateGraph` | TypeScript reads only canonical projection after reservation/open. |
| TypeScript store | Local UI state only | No transcript repair, no provider branches, no canonical fallback from hot state. |
| `packages/ui` | Presentation | Render props only. |

## Non-Goals

- No UI redesign.
- No historical-session read-only shortcut.
- No compatibility fork that keeps old and new transcript authority alive.
- No provider-specific logic in TypeScript.
- No sorting, grouping, or order repair in Svelte.

## Review Findings Resolved Into This Plan

### Finding 1: TypeScript still has live transcript authority

Files:

- `packages/desktop/src/lib/acp/logic/message-processor.ts`
- `packages/desktop/src/lib/acp/store/services/chunk-aggregator.ts`
- `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts`

Decision:

- Live user/assistant/tool transcript rows must be delivered through Rust transcript deltas.
- TypeScript entry storage becomes a compatibility read model until removed from Agent Panel rendering.
- Direct raw-lane transcript mutation is deleted or narrowed to pending-send local visuals.

### Finding 2: TypeScript remaps assistant ids

Files:

- `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts`
- `packages/desktop/src-tauri/src/acp/transcript_projection/runtime.rs`

Decision:

- Rust owns assistant entry id allocation.
- TypeScript must apply `appendEntry`, `appendSegment`, and `replaceSnapshot` using exact entry ids from Rust.
- If Rust sees a provider id reused across turns, Rust emits a new Acepe-owned display id.

### Finding 3: Two Rust transcript projection systems overlap

Files:

- `packages/desktop/src-tauri/src/session_converter/transcript_events.rs`
- `packages/desktop/src-tauri/src/acp/transcript_projection/runtime.rs`
- `packages/desktop/src-tauri/src/acp/transcript_projection/snapshot.rs`

Decision:

- Promote `CanonicalTranscriptEvent` from restored-session converter helper to the canonical input type for transcript snapshots and deltas.
- `transcript_projection` becomes the reducer/projector for canonical events.
- Provider converter modules produce canonical events or use provider adapters that do.

### Finding 4: `StoredEntry` still feeds canonical snapshots

Files:

- `packages/desktop/src-tauri/src/acp/transcript_projection/snapshot.rs`
- `packages/desktop/src-tauri/src/acp/session_materialization/mod.rs`

Decision:

- Add `TranscriptSnapshot::from_canonical_events`.
- Make `materialize_thread_snapshot` use canonical events for transcript snapshots.
- Keep `StoredEntry` only as a legacy/export/display DTO until callers are gone.

### Finding 5: OpenCode bypasses canonical transcript events

Files:

- `packages/desktop/src-tauri/src/session_converter/opencode.rs`

Decision:

- Add OpenCode canonical event materialization.
- OpenCode converter may project canonical events to legacy entries only for legacy callers, not as source truth.

### Finding 6: Cursor restore overlays streaming logs onto entries

Files:

- `packages/desktop/src-tauri/src/session_converter/cursor.rs`
- `packages/desktop/src-tauri/src/acp/providers/cursor_session_update_enrichment.rs`

Decision:

- Cursor persisted transcript facts and streaming log facts must merge into canonical event/operation evidence before transcript snapshots are built.
- No post-conversion entry overlay.

### Finding 7: TypeScript preserves capabilities when canonical data is missing

Files:

- `packages/desktop/src/lib/acp/store/session-store.svelte.ts`

Decision:

- Missing capabilities are a backend state bug, not a frontend preservation case.
- Remove previous-capability preservation once Rust open/resume paths always seed capabilities.

### Finding 8: XState/hot state overlaps lifecycle truth

Files:

- `packages/desktop/src/lib/acp/store/services/session-messaging-service.ts`
- `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
- `packages/desktop/src/lib/acp/store/session-work-projection.ts`

Decision:

- XState may drive local animation/input transitions only.
- Session status, sendability, activity, and failure come from canonical projection.
- Local state may disable controls during a pending local send, but it may not make a disconnected/failed/running decision.

### Finding 9: TypeScript merges tool operation data

Files:

- `packages/desktop/src/lib/acp/store/services/transcript-tool-call-buffer.svelte.ts`
- `packages/desktop/src/lib/acp/session-state/session-state-query-service.ts`

Decision:

- Operation merge rules live in Rust operation graph.
- TypeScript may render unresolved/degraded operation snapshots from Rust, but must not merge operation arguments/results/status.

### Finding 10: Two Agent Panel materializers

Files:

- `packages/desktop/src/lib/acp/session-state/agent-panel-graph-materializer.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/logic/agent-panel-display-model.ts`

Decision:

- Keep one graph-to-scene materializer.
- Delete or reduce the older display model to local presentation helpers that do not own row creation.

## Implementation Units

### Unit 1: Promote canonical transcript events into `acp/transcript_projection`

Status: completed

Goal:

Make `CanonicalTranscriptEvent` the common Rust input for transcript snapshots and deltas.

Files:

- Modify: `packages/desktop/src-tauri/src/session_converter/transcript_events.rs`
- Modify: `packages/desktop/src-tauri/src/acp/transcript_projection/snapshot.rs`
- Modify: `packages/desktop/src-tauri/src/acp/transcript_projection/runtime.rs`
- Modify: `packages/desktop/src-tauri/src/acp/transcript_projection/mod.rs`
- Test: existing Rust tests in `packages/desktop/src-tauri/src/acp/transcript_projection/`

Execution note:

- Test first. Add a regression proving assistant id reuse across turns is resolved in Rust and no TypeScript remap is required.

Verification:

- `cargo test acp::transcript_projection`
- `cargo test session_converter::transcript_events`

Progress:

- Added shared `CanonicalTranscriptEvent` and `CanonicalTranscriptEventKind` under `acp/transcript_projection`.
- Added `TranscriptSnapshot::from_canonical_events`.
- Changed live Rust transcript projection to allocate Acepe-owned assistant row ids for new assistant rows (`assistant-event-N`) and use provider ids only as current-turn lookup keys.
- Removed Rust `provider-id:turn:N` display-id remapping.
- Verified with `cargo test acp::transcript_projection::runtime` and the reused-id canonical snapshot regression.

### Unit 2: Build restored snapshots from canonical events, not `StoredEntry`

Status: completed

Goal:

Make historical open/resume/state lookup use canonical transcript events before `TranscriptSnapshot`.

Files:

- Modify: `packages/desktop/src-tauri/src/acp/session_materialization/mod.rs`
- Modify: `packages/desktop/src-tauri/src/acp/session_open_snapshot/mod.rs`
- Modify: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`
- Modify: `packages/desktop/src-tauri/src/session_converter/fullsession.rs`
- Test: `packages/desktop/src-tauri/src/acp/session_materialization/mod.rs`
- Test: `packages/desktop/src-tauri/src/acp/session_open_snapshot/mod.rs`
- Test: `packages/desktop/src-tauri/src/acp/commands/session_commands.rs`

Execution note:

- Characterization first: current Claude reused-id regression must keep passing while the authority source moves.

Verification:

- `cargo test acp::session_materialization`
- `cargo test acp::session_open_snapshot`
- `cargo test acp::commands::session_commands::tests`
- `cargo test test_parse_converted_session_keeps_reused_id_final_text_after_late_tool_fragments`

Progress:

- Added backend-only `ProviderOwnedSessionSnapshot` so provider-owned restored history can carry canonical transcript events beside the legacy thread snapshot.
- Updated provider-owned loading to return `ProviderOwnedSessionSnapshot`.
- Updated open/resume/state lookup materialization to call `materialize_provider_owned_thread_snapshot`.
- `materialize_provider_owned_thread_snapshot` now builds `TranscriptSnapshot` from canonical transcript events when present, falling back to `StoredEntry` only for providers that do not have canonical event adapters yet.
- Added regression test proving canonical event display ids beat legacy `StoredEntry` ids during provider-owned materialization.

### Unit 3: Move OpenCode and Cursor restored history onto canonical events

Status: completed

Goal:

Delete direct provider-history-to-display conversion for OpenCode and Cursor restored sessions.

Files:

- Modify: `packages/desktop/src-tauri/src/session_converter/opencode.rs`
- Modify: `packages/desktop/src-tauri/src/session_converter/cursor.rs`
- Modify: `packages/desktop/src-tauri/src/cursor_history/parser.rs`
- Modify: `packages/desktop/src-tauri/src/history/cursor_sqlite_parser.rs`
- Test: existing OpenCode converter tests in `packages/desktop/src-tauri/src/session_converter/mod.rs`
- Test: existing Cursor converter tests in `packages/desktop/src-tauri/src/session_converter/cursor.rs`

Execution note:

- Characterize current Cursor/OpenCode restored order before replacing direct entry conversion.

Verification:

- `cargo test session_converter::`
- `cargo test cursor_history::`
- `cargo test opencode_history::`

Progress:

- Added OpenCode provider-owned conversion that emits canonical transcript events from raw OpenCode messages.
- Routed OpenCode disk and HTTP restored-history loads through `ProviderOwnedSessionSnapshot` so restored transcript display uses canonical events before legacy entries.
- Added regression coverage proving OpenCode provider ids are not used as restored assistant display truth.
- Added provider-owned canonical tool-call updates for Cursor restored sessions, so streaming log facts update operation projections without rewriting restored transcript entries.
- Updated materialization to apply provider-owned operation updates after importing the restored thread snapshot.
- Added regression coverage proving Cursor streaming log facts materialize as operation facts while the restored transcript entry remains unchanged.
- Verified with:
  - `cargo test session_converter::opencode`
  - `cargo test session_converter::cursor`
  - `cargo test acp::session_materialization`

### Unit 4: Delete TypeScript assistant transcript repair

Status: completed

Goal:

Remove frontend assistant entry remapping and apply Rust transcript deltas literally.

Files:

- Modify: `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/services/transcript-snapshot-entry-adapter.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/session-entry-store-streaming.vitest.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/session-store-token-stream.vitest.ts`

Execution note:

- Test first: add a delta sequence where Rust sends a reused provider-facing assistant id already widened to a canonical display id; TS must not rewrite it.

Verification:

- `cd packages/desktop && bun test src/lib/acp/store/__tests__/session-entry-store-streaming.vitest.ts`
- `cd packages/desktop && bun test src/lib/acp/store/__tests__/session-store-token-stream.vitest.ts`
- `cd packages/desktop && bun run check`

Progress:

- Deleted frontend assistant entry remap maps and same-revision transcript repair.
- TypeScript now applies `appendEntry`, `appendSegment`, and `replaceSnapshot` using exact Rust ids.
- Updated tests to prove Rust-owned assistant ids are consumed literally.

### Unit 5: Delete TypeScript operation merge authority

Status: completed

Goal:

Make TypeScript render operation snapshots from Rust without merging tool arguments, status, or result.

Files:

- Modify: `packages/desktop/src/lib/acp/store/services/transcript-tool-call-buffer.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/session-state/session-state-query-service.ts`
- Modify: `packages/desktop/src/lib/acp/session-state/agent-panel-graph-materializer.ts`
- Test: `packages/desktop/src/lib/acp/session-state/__tests__/agent-panel-graph-materializer.test.ts`
- Test: `packages/desktop/src/lib/acp/store/services/transcript-tool-call-buffer.svelte.ts` adjacent tests

Execution note:

- Do not remove local streaming visuals before Rust operation snapshots cover them. If a field is still needed, widen Rust first.

Verification:

- `cd packages/desktop && bun test src/lib/acp/session-state/__tests__/agent-panel-graph-materializer.test.ts`
- `cd packages/desktop && bun run check`

Progress:

- Removed frontend preservation of old operations when a newer graph omits operations.
- Removed TypeScript argument/status/result merge policy from `session-state-query-service.ts`.
- Removed TypeScript terminal-state vetoes from live operation patch application. Rust decides whether a patch is stale; the store applies canonical operation patches literally.
- Fixed delta routing so canonical turn-only graph updates (`turnState`, `activeTurnFailure`, `lastTerminalTurnId`) are applied even when no operation or activity patch is present.
- Moved Todo header surfaces to operation-backed tool calls instead of compatibility transcript entries.
- Removed transcript entries from queue snapshot construction; queue tools/todos now come from canonical operation-backed fields.
- `TranscriptToolCallBuffer` now accepts incoming canonical tool status, kind, arguments, and extracted result literally instead of preserving richer previous values.
- Kept progressive streaming arguments as local display state only when canonical typed arguments are absent.
- Updated buffer tests from "preserve richer old data" expectations to "accept incoming canonical truth" expectations.
- Verified with:
  - `bun test src/lib/acp/store/services/__tests__/transcript-tool-call-buffer.test.ts`
  - `bun test src/lib/acp/session-state/__tests__/agent-panel-graph-materializer.test.ts`
  - `bun test src/lib/acp/store/services/__tests__/transcript-tool-call-buffer.test.ts src/lib/acp/session-state/__tests__/agent-panel-graph-materializer.test.ts`
  - `bun test ./src/lib/acp/store/__tests__/operation-store.vitest.ts`
  - `bun test ./src/lib/acp/logic/__tests__/todo-state-manager.test.ts`
  - `bun test ./src/lib/acp/store/queue/__tests__/queue-utils.test.ts`
  - `bun run check`

### Unit 6: Remove TypeScript capability/lifecycle fallbacks

Status: completed

Goal:

Make canonical projection the only lifecycle/capability read path.

Files:

- Modify: `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/services/session-messaging-service.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-work-projection.ts`
- Modify: `packages/desktop/src/lib/acp/store/tab-bar-utils.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts`
- Test: `packages/desktop/src/lib/acp/store/services/__tests__/session-messaging-service-stream-lifecycle.test.ts`

Execution note:

- Remove fallback only after Rust open/resume/new-session paths always publish canonical lifecycle and capabilities.

Verification:

- `cd packages/desktop && bun test src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts`
- `cd packages/desktop && bun test src/lib/acp/store/services/__tests__/session-messaging-service-stream-lifecycle.test.ts`
- `cd packages/desktop && bun run check`

Progress:

- Removed previous-capability preservation when canonical capability envelopes omit models or modes.
- Missing capabilities are now treated as canonical empty state in TypeScript.
- Removed the `sendMessage` auto-connect fallback for non-sendable restored sessions. TypeScript now fails closed unless canonical lifecycle says `canSend`, with only the explicit reserved-first-prompt path allowed.
- Removed Agent Input capability fallback once live session capabilities exist. Empty live models/modes are canonical empty state, not a request to fill from cache or preconnection.
- Moved Agent Panel empty/message state to canonical graph transcript count rather than compatibility entry cache length.
- Deleted the unused pre-canonical created-session helper and the stale projected-capability merge helper that preserved previous models/modes.
- Updated the restored detached-session test to assert canonical lifecycle authority instead of reconnect-on-send behavior.
- Verified with:
  - `bun test ./src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts`
  - `bun test src/lib/acp/store/services/__tests__/session-messaging-service-stream-lifecycle.test.ts`
  - `bun test ./src/lib/acp/components/agent-input/logic/capability-source.vitest.ts`
  - `bun run check`

### Unit 7: Collapse Agent Panel row materialization to one path

Status: completed

Goal:

Ensure Agent Panel rows come from one graph materializer and presentation code only decorates already-materialized rows.

Files:

- Modify: `packages/desktop/src/lib/acp/session-state/agent-panel-graph-materializer.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/agent-panel-display-model.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte`
- Test: `packages/desktop/src/lib/acp/session-state/__tests__/agent-panel-graph-materializer.test.ts`
- Test: existing Agent Panel component tests

Execution note:

- Keep scroll/reveal/viewport state local. Do not move presentation animation state into Rust.

Verification:

- `cd packages/desktop && bun test src/lib/acp/session-state/__tests__/agent-panel-graph-materializer.test.ts`
- `cd packages/desktop && bun run check`

Progress:

- Routed Agent Panel display-memory rows through `materializeAgentPanelSceneFromGraph` scene entries instead of rebuilding user/assistant rows directly from transcript entries.
- Removed the duplicate transcript-to-display-row builder from `agent-panel-display-model.ts`; token-reveal display memory now decorates already-materialized scene rows.
- Updated the Agent Panel component and debug repro fixtures to pass materialized scene entries into the display model.
- Updated display-model tests to use the graph materializer as the row source and to assert scene-materializer ordering.
- Verified with:
  - `bun test src/lib/acp/components/agent-panel/logic/__tests__/agent-panel-display-model.test.ts src/lib/acp/session-state/__tests__/agent-panel-graph-materializer.test.ts`
  - `bun test src/lib/acp/components/debug-panel/__tests__/streaming-repro-graph-fixtures.test.ts src/lib/acp/components/agent-panel/logic/__tests__/agent-panel-display-model.test.ts src/lib/acp/session-state/__tests__/agent-panel-graph-materializer.test.ts`
  - `bun test ./src/lib/skills/store/preconnection-agent-skills-store.vitest.ts`
  - `bun test src/lib/acp/store/services/session-connection-manager.test.ts`
  - `bun run check`

## Sequencing

1. Unit 1 must land first because it defines the Rust canonical transcript event input.
2. Unit 2 moves restored Claude history onto the new authority.
3. Unit 3 removes provider-specific restored-history bypasses.
4. Unit 4 removes TypeScript transcript id repair.
5. Unit 5 removes TypeScript operation merge repair.
6. Unit 6 removes lifecycle/capability fallbacks.
7. Unit 7 collapses Agent Panel materialization.

## Manual Headless Review

Coherence review:

- The plan has one direction: move product truth upstream into Rust and remove downstream repair.
- The highest-risk dependency is Unit 1. If canonical event projection is incomplete, later TypeScript deletion would remove behavior before Rust owns it.

Feasibility review:

- This should be implemented in slices. The full change touches Rust restored history, Rust live projection, TypeScript stores, and Agent Panel materialization.
- Each unit has focused tests. Full suite verification should happen after several units, not after every tiny edit.

Scope review:

- This is intentionally broad but bounded to session/transcript/operation/capability authority.
- UI redesign, provider feature changes, and read-only historical sessions remain out of scope.

Risk review:

- Removing TypeScript fallbacks too early can break live streaming UX.
- Cursor and OpenCode have different history shapes; they need characterization coverage before direct conversion is deleted.
- `StoredEntry` cannot disappear in one commit because storage/export/test helpers still use it. The plan narrows its authority first.

## Done Criteria

- Rust canonical events are the only source for transcript snapshots and transcript deltas.
- Restored Claude, Cursor, and OpenCode histories use canonical event materialization.
- TypeScript no longer invents or remaps transcript display ids.
- TypeScript no longer merges operation product truth.
- TypeScript no longer preserves missing canonical capabilities from previous values.
- Agent Panel uses one graph-to-scene row materializer.
- Focused Rust and TypeScript tests pass.
- `bun run check` passes after TypeScript changes.

## Additional GOD Sweep: Canonical Transcript Timestamps

Status: completed

Problem:

- Agent Panel scene rows still called a TypeScript backfill helper to copy timestamps from legacy `SessionEntry` rows into graph-materialized scene rows.
- That was a downstream repair: canonical transcript rows lacked the timestamp field, so UI code had to look sideways at legacy transcript state.

Fix:

- Added optional `timestamp_ms` to Rust `TranscriptEntry`.
- Canonical transcript snapshots now parse provider/canonical timestamps into milliseconds.
- Stored-entry snapshots preserve timestamps when available.
- The Agent Panel graph materializer projects `TranscriptEntry.timestampMs` directly into user and assistant scene rows.
- Deleted the TypeScript timestamp backfill helper and its tests.
- Moved pure graph/materializer imports to `@acepe/ui/agent-panel/types` so logic tests do not import the full Svelte component barrel or image assets.

Verification:

- `cd packages/desktop/src-tauri && cargo test transcript_snapshot_from_canonical_events_preserves_timestamp_ms`
- `cd packages/desktop && bun test ./src/lib/acp/session-state/__tests__/agent-panel-graph-materializer.test.ts`
- `cd packages/desktop && bun run check`

## Additional GOD Sweep: Canonical Copy And Export

Status: completed

Problem:

- Sidebar, kanban, and Agent Panel menu export paths still read `sessionStore.getEntries()` and serialized compatibility `SessionEntry[]`.
- That meant copied markdown/JSON could disagree with the canonical transcript graph and could reintroduce message-order bugs outside the visible panel.

Fix:

- Added `sessionGraphToMarkdown(graph)` for graph-backed markdown export.
- Added `copyCanonicalSessionToClipboard(session, graph)` for canonical JSON export.
- Rewired sidebar, kanban, and Agent Panel menu copy/export actions to read `SessionStateGraph`.
- Removed the legacy `copySessionToClipboard` export from Agent Panel logic.
- Export actions now fail closed when canonical graph content is not loaded instead of falling back to legacy transcript rows.

Verification:

- `cd packages/desktop && bun test ./src/lib/acp/utils/session-to-markdown.test.ts`
- `cd packages/desktop && bun run check`

## Additional GOD Sweep: Canonical Secondary UI Surfaces

Status: completed

Problem:

- Tab tooltip previews, settings session counts, checkpoint user previews, and Agent Panel diagnostics still read compatibility `SessionEntry[]`.
- Those surfaces could drift from canonical transcript order or re-render from compatibility state.

Fix:

- Tab bar conversation previews now consume canonical `TranscriptEntry[]`.
- Settings session tables use `SessionStateGraph.messageCount`.
- Checkpoint user previews use canonical transcript entry text and `timestampMs`.
- Agent Panel diagnostics/review restore gates use canonical visible entry counts and graph tail entries.
- Agent Panel attachment display now reads only truly local pending-send user entries, not compatibility transcript rows.
- Removed the last non-test direct UI call to `sessionStore.getEntries()`.

Verification:

- `cd packages/desktop && bun test ./src/lib/acp/store/__tests__/tab-bar-utils.test.ts ./src/lib/acp/store/__tests__/tab-bar-store.test.ts ./src/lib/acp/utils/session-to-markdown.test.ts`
- `cd packages/desktop && bun run check`

## Additional GOD Sweep: Operation-Backed Auto-Checkpoints

Status: completed

Problem:

- Auto-checkpoint creation still inspected compatibility transcript entries to find edit tool calls.
- That made checkpoint file summaries depend on display rows instead of the canonical operation graph.
- A transcript projection bug could therefore affect checkpoint behavior even when the operation graph had the correct tool facts.

Fix:

- Added `getSessionToolCalls(sessionId)` to the session state reader contract.
- Implemented it through the canonical operation store.
- Rewired `SessionMessagingService.createAutoCheckpointIfNeeded` to aggregate file edits from canonical operation-backed tool calls.
- Removed `getEntries` from the session state reader contract so services cannot accidentally use transcript rows as product state.
- Updated service tests to build checkpoint edit facts as `ToolCall` objects instead of `SessionEntry` rows.

Verification:

- `cd packages/desktop && bun run check`
- `cd packages/desktop && bun test ./src/lib/acp/store/services/__tests__/session-messaging-service-send-message.test.ts ./src/lib/acp/store/services/__tests__/session-messaging-service-stream-lifecycle.test.ts ./src/lib/acp/store/services/session-connection-manager.test.ts`

## Additional GOD Sweep: Canonical Activity Only

Status: completed

Problem:

- `deriveLiveCanonicalActivity` still upgraded canonical `idle` into `awaiting_model`, `running_operation`, or `waiting_for_user` by looking at local runtime state, current streaming tool calls, and pending interaction selectors.
- That let TypeScript repair stale canonical activity downstream.
- Tabs and queue items could display active work even when the Rust session graph said the session was idle.

Fix:

- `deriveLiveCanonicalActivity` now reads canonical graph activity directly.
- Canonical failures from `activeTurnFailure`, failed lifecycle, or lifecycle error still surface as error because those are canonical graph facts.
- Runtime state and local tool-call presence no longer promote canonical idle into active work.
- Updated tab and queue projection tests so they prove local runtime state cannot override canonical idle.

Verification:

- `cd packages/desktop && bun test ./src/lib/acp/store/__tests__/live-session-work.test.ts`
- `cd packages/desktop && bun test ./src/lib/acp/store/__tests__/tab-bar-utils.test.ts ./src/lib/acp/store/__tests__/tab-bar-store.test.ts ./src/lib/acp/store/queue/__tests__/queue-utils.test.ts ./src/lib/acp/store/__tests__/live-session-work.test.ts`
- `cd packages/desktop && bun run check`

## Additional GOD Sweep: No Turn-Boundary Transcript Scan

Status: completed

Problem:

- `ChunkAggregator.startNewAssistantTurn` scanned existing transcript rows and marked every assistant row as a pending boundary.
- That made TypeScript repair provider-reused assistant ids by looking backward through display rows.
- The same repaired behavior was the original class of bug: provider ids and transcript row order were treated as display truth downstream.

Fix:

- `startNewAssistantTurn` now only resets local chunk aggregation state.
- It does not read transcript rows.
- The compatibility chunk aggregator no longer claims to solve provider-reused assistant ids across user turns.
- The canonical transcript delta path remains the correct path for reused provider ids because Rust sends Acepe-owned display ids.
- `sendMessage` logging now records canonical transcript revision instead of reading compatibility row count.
- Removed the public `SessionStore.getStreamingArguments` facade because production code no longer reads streaming tool arguments from compatibility transcript rows.

Verification:

- `cd packages/desktop && bun test ./src/lib/acp/store/services/__tests__/chunk-aggregator.test.ts`
- `cd packages/desktop && bun test ./src/lib/acp/store/services/__tests__/chunk-aggregator.test.ts ./src/lib/acp/store/__tests__/session-entry-store-streaming.vitest.ts ./src/lib/acp/store/__tests__/chunk-fragmentation-scenarios.vitest.ts ./src/lib/acp/store/__tests__/chunk-aggregation-bug.test.ts ./src/lib/acp/store/__tests__/assistant-chunk-aggregation.test.ts ./src/lib/acp/store/services/__tests__/session-messaging-service-send-message.test.ts`
- `cd packages/desktop && bun run check`

## Additional GOD Sweep: Close Progressive Argument Read Facades

Status: completed

Problem:

- `SessionEntryStore` and `TranscriptToolCallBuffer` exposed `getStreamingArguments(...)`.
- That made compatibility transcript entries a public read source for progressive tool arguments.
- Tests also hid stale progressive arguments after session cleanup because the getter depended on indexes that `clearSession` deleted.

Fix:

- Removed `SessionEntryStore.getStreamingArguments`.
- Removed `TranscriptToolCallBuffer.getStreamingArguments`.
- Removed `getStreamingArguments` from `ITranscriptToolCallBuffer`.
- Updated tests to inspect remaining compatibility entry state directly instead of calling an app-facing read facade.
- Fixed `TranscriptToolCallBuffer.clearSession` so it clears progressive arguments from entries before dropping indexes.

Verification:

- `cd packages/desktop && bun run check`
- `cd packages/desktop && bun test ./src/lib/acp/store/__tests__/session-entry-store-streaming.vitest.ts ./src/lib/acp/store/__tests__/tool-call-event-flow.test.ts ./src/lib/acp/store/services/__tests__/transcript-tool-call-buffer.test.ts`
- `rg "getStreamingArguments" packages/desktop/src/lib -n` returns no matches.

## Additional GOD Sweep: Remove Public Compatibility Entry Read Facade

Status: completed

Problem:

- `SessionStore.getEntries(...)` exposed compatibility transcript rows from the app-level store.
- Production code no longer needed it, but the method made it too easy for future UI or service code to read transcript rows as product truth.
- That violated the architecture rule: app-level consumers should read canonical graph/projection facts, not compatibility rows.

Fix:

- Removed `SessionStore.getEntries(...)`.
- Updated the remaining SessionStore projection tests to read compatibility entries only through a test helper that reaches the internal entry store.
- Updated the sidebar performance comment so it describes the architectural rule without referring to the removed method.

Verification:

- Red check first: `cd packages/desktop && bun run check` failed only where tests still called `SessionStore.getEntries(...)`.
- `cd packages/desktop && bun run check`
- `cd packages/desktop && bun test ./src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts`
- `rg "sessionStore\\.getEntries|\\.getEntries\\(" packages/desktop/src/lib -n --glob '!**/__tests__/**'` no longer reports an app-level `SessionStore.getEntries(...)` read path.

## Additional GOD Sweep: Narrow Service Entry Manager Contract

Status: completed

Problem:

- `IEntryManager` still exposed `getEntries(...)`.
- Production services did not use it, but every service that accepted `IEntryManager` was still typed as if it could read compatibility transcript rows.
- That kept a stale read permission in the service boundary even after the app-level `SessionStore` facade was removed.

Fix:

- Removed `getEntries(...)` from `IEntryManager`.
- Left compatibility entry reads only on the lower `IEntryStoreInternal` boundary used by compatibility-only services.
- Removed unused `getEntries` fields from `IEntryManager` test doubles.

Verification:

- Red check first: `cd packages/desktop && bun run check` failed only on stale service test doubles.
- `cd packages/desktop && bun run check`
- `cd packages/desktop && bun test ./src/lib/acp/store/services/__tests__/session-messaging-service-send-message.test.ts ./src/lib/acp/store/services/__tests__/session-messaging-service-stream-lifecycle.test.ts ./src/lib/acp/store/services/__tests__/session-repository-placeholder-title.test.ts ./src/lib/acp/store/services/__tests__/session-repository-refresh-source-path.test.ts ./src/lib/acp/store/services/__tests__/session-repository-startup-sessions.test.ts ./src/lib/acp/store/services/session-connection-manager.test.ts`

## Additional GOD Sweep: Narrow Internal Compatibility Entry Lookups

Status: completed

Problem:

- `IEntryStoreInternal.getEntries(...)` still let compatibility services read all transcript rows.
- `ChunkAggregator` scanned rows to find assistant/user entries.
- `TranscriptToolCallBuffer` scanned rows to find tool-call entries.
- This kept broad transcript-row access inside services even though each service only needed one narrow lookup.

Fix:

- Removed `getEntries(...)` from `IEntryStoreInternal`.
- Added narrow internal lookup methods:
  - `findAssistantEntryRef(...)`
  - `hasAssistantEntry(...)`
  - `findLatestUserEntryRef(...)`
  - `findToolCallEntryRef(...)`
- Moved index validation and fallback scans into `SessionEntryStore`, the compatibility row owner.
- Updated `ChunkAggregator` and `TranscriptToolCallBuffer` to call those narrow methods instead of scanning transcript rows.
- Updated focused tests and mocks to use the narrow lookup contract.

Verification:

- Red check first: `cd packages/desktop && bun run check` failed on the old broad `getEntries(...)` service calls and test doubles.
- `cd packages/desktop && bun run check`
- `cd packages/desktop && bun test ./src/lib/acp/store/services/__tests__/chunk-aggregator.test.ts ./src/lib/acp/store/services/__tests__/transcript-tool-call-buffer.test.ts`
- `rg "getEntries\\(" packages/desktop/src/lib/acp/store -n --glob '!**/__tests__/**'` showed only the remaining owner method and its local normalization path before the final closure sweep below.

## Additional GOD Sweep: Make Compatibility Entry Reads Private

Status: completed

Problem:

- `SessionEntryStore.getEntries(...)` was no longer on service-facing contracts, but it was still a public class method.
- That meant future production code could accidentally call the broad compatibility transcript reader again.
- Tests needed broad reads for characterization, but production code should not.

Fix:

- Made `SessionEntryStore.getEntries(...)` private first.
- Added a small test-only helper, `readCompatibilityEntries(...)`, for tests that intentionally inspect compatibility rows.
- Updated all direct test calls to use the helper, making broad transcript-row reads explicit in tests and unavailable through normal production typing.

Verification:

- Red check first: `cd packages/desktop && bun run check` failed only where tests still called the now-private method.
- `cd packages/desktop && bun run check`
- `cd packages/desktop && bun test ./src/lib/acp/store/__tests__/assistant-chunk-aggregation.test.ts ./src/lib/acp/store/__tests__/chunk-aggregation-bug.test.ts ./src/lib/acp/store/__tests__/chunk-fragmentation-scenarios.vitest.ts ./src/lib/acp/store/__tests__/session-entry-store-streaming.vitest.ts ./src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts ./src/lib/acp/store/__tests__/tool-call-event-flow.test.ts ./src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts ./src/lib/acp/store/services/__tests__/session-messaging-service-stream-lifecycle.test.ts`
- `rg "\\.getEntries\\(" packages/desktop/src/lib -n --glob '!**/__tests__/**'` showed only the private owner-local normalization call before the final closure sweep below.

## Additional GOD Sweep: Remove Compatibility Entry Reader Entirely

Status: completed

Problem:

- After `SessionEntryStore.getEntries(...)` became private, the method still existed solely for tests and one owner-local preload normalization path.
- The preload normalization path created a second `SessionEntryStore` just to merge duplicate tool-call entries and read rows back.
- That kept a broad compatibility entry reader alive even though production code no longer needed it.

Fix:

- Deleted `SessionEntryStore.getEntries(...)` entirely.
- Replaced duplicate tool-call preload normalization with a direct deterministic array reducer.
- Kept duplicate tool-call merge behavior equivalent by reusing `resolveTranscriptToolCallCreate(...)` and explicit `ToolCall` construction.
- Updated the test-only helper to read `entriesById` directly as a named break-glass test accessor.
- Removed stale `getEntries` wording from tests and comments.

Verification:

- `cd packages/desktop && bun run check`
- `cd packages/desktop && bun test ./src/lib/acp/store/__tests__/session-entry-store-streaming.vitest.ts ./src/lib/acp/store/__tests__/chunk-aggregation-bug.test.ts ./src/lib/acp/store/__tests__/tool-call-event-flow.test.ts ./src/lib/acp/store/__tests__/tab-bar-store-non-agent.vitest.ts`
- `rg "\\.getEntries\\(" packages/desktop/src/lib -n --glob '!**/__tests__/**'` returns no matches.
- `rg "\\bgetEntries\\b" packages/desktop/src/lib -n` returns no matches.

## Final GOD Closure: Compatibility Entry Reader Removed

Status: completed

Checklist state:

- No app-level `SessionStore.getEntries(...)`.
- No service-facing `IEntryManager.getEntries(...)`.
- No compatibility-service `IEntryStoreInternal.getEntries(...)`.
- No `SessionEntryStore.getEntries(...)`.
- No production `.getEntries(...)` calls under `packages/desktop/src/lib`.
- No test-facing method named `getEntries`; tests use `readCompatibilityEntries(...)` as a named break-glass helper.
- No `getStreamingArguments(...)` facade.
- No turn-boundary transcript scan.
- No UI/sidebar/menu/export path reading compatibility transcript rows as product truth.

Verification:

- `cd packages/desktop && bun run check`
- `cd packages/desktop && bun test ./src/lib/acp/store/__tests__/assistant-chunk-aggregation.test.ts ./src/lib/acp/store/__tests__/chunk-aggregation-bug.test.ts ./src/lib/acp/store/__tests__/chunk-fragmentation-scenarios.vitest.ts ./src/lib/acp/store/__tests__/session-entry-store-streaming.vitest.ts ./src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts ./src/lib/acp/store/__tests__/tool-call-event-flow.test.ts ./src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts ./src/lib/acp/store/services/__tests__/session-messaging-service-stream-lifecycle.test.ts ./src/lib/acp/store/services/__tests__/chunk-aggregator.test.ts ./src/lib/acp/store/services/__tests__/transcript-tool-call-buffer.test.ts ./src/lib/acp/store/__tests__/tab-bar-store-non-agent.vitest.ts`
- `rg "\\.getEntries\\(" packages/desktop/src/lib -n --glob '!**/__tests__/**'` returns no matches.
- `rg "\\bgetEntries\\b" packages/desktop/src/lib -n` returns no matches.
- `rg "getStreamingArguments|sessionStore\\.getEntries|IEntryStoreInternal.*getEntries|IEntryManager.*getEntries" packages/desktop/src/lib -n` returns no matches.
- `git diff --check`

## Additional GOD Sweep: Remove Raw Stream Mutation APIs

Status: completed

Problem:

- Raw stream mutation methods still existed after canonical envelopes became the authority.
- `SessionEventHandler`, `SessionStore`, and `SessionMessagingService` exposed methods that could add stream rows, force streaming state, or handle raw stream errors outside the canonical graph.
- Some tests were still built around those old raw doors even though production traffic no longer used them.

Fix:

- Removed raw streaming methods from `SessionEventHandler`.
- Removed public raw stream wrappers from `SessionStore`.
- Removed dead raw methods from `SessionMessagingService`: raw entry handling, raw stream error handling, forced streaming state, and the assistant chunk proxy.
- Renamed the remaining terminal-turn side-effect methods to `handleCanonicalTurnComplete(...)` and `handleCanonicalTurnFailure(...)`.
- Updated tests to assert canonical/raw-lane behavior without keeping obsolete raw APIs alive.

Verification:

- Red check first: `cd packages/desktop && bun run check` failed only on stale test mocks and direct test calls to the removed methods.
- `cd packages/desktop && bun run check`
- `cd packages/desktop && bun test ./src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts ./src/lib/acp/store/services/__tests__/session-messaging-service-stream-lifecycle.test.ts ./src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts`
- `rg "handleStreamEntry|handleStreamError|ensureStreamingState|handleStreamComplete|handleTurnError" packages/desktop/src/lib/acp -n --glob '!**/__tests__/**'` returns no production method doors.

## Additional GOD Sweep: Require Canonical State Readers

Status: completed

Problem:

- `ISessionStateReader` exposed canonical accessors as optional.
- Optional canonical readers make it too easy for services to run without canonical truth and silently fall back to older local state.

Fix:

- Made canonical state reader methods required on `ISessionStateReader`.
- Removed optional-call fallbacks from connection and messaging services.
- Made `SessionEventHandler.getSessionCanSend(...)` required for the same boundary reason.
- Updated service test doubles to state their canonical defaults explicitly.

Verification:

- Red check first: `cd packages/desktop && bun run check` failed on mocks missing required canonical readers.
- `cd packages/desktop && bun run check`
- `cd packages/desktop && bun test ./src/lib/acp/store/services/session-connection-manager.test.ts ./src/lib/acp/store/services/__tests__/session-messaging-service-send-message.test.ts ./src/lib/acp/store/services/__tests__/session-messaging-service-stream-lifecycle.test.ts ./src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts`
- `rg "getSessionCanSend\\?|getSessionLifecycleStatus\\?|getGraphTranscriptRevision\\?|getSessionAutonomousEnabled\\?|getSessionCurrentModeId\\?|getSessionCapabilities\\?|getCanonicalSessionProjection\\?|getSessionToolCalls\\?" packages/desktop/src/lib/acp -n` returns no optional canonical reader declarations.

## Additional GOD Sweep: Canonical Live Work Projection

Status: completed

Problem:

- `deriveLiveSessionState(...)` still accepted local runtime state and local streaming tool calls.
- Tab, queue, urgency, and agent-panel content paths could pass local operation/runtime details into the live session state projection.
- Pending interaction objects could make a session look answer-needed even when canonical graph activity was idle.

Fix:

- Removed `runtimeState` and `currentStreamingToolCall` from `LiveSessionWorkInput`.
- Made live session activity derive from canonical lifecycle/activity only.
- Kept local tool objects out of `SessionState.activity.tool`; operation UI can still render operation data explicitly.
- Gated pending question/permission/plan approval state behind canonical `waiting_for_user` activity.
- Removed obsolete live-projection inputs from tab, queue, urgency, and agent-panel content paths.

Verification:

- Red check first: `cd packages/desktop && bun test ./src/lib/acp/store/__tests__/live-session-work.test.ts` failed on local tool attachment and stale pending input.
- `cd packages/desktop && bun run check`
- `cd packages/desktop && bun test ./src/lib/acp/store/__tests__/live-session-work.test.ts ./src/lib/acp/store/__tests__/tab-bar-utils.test.ts ./src/lib/acp/store/__tests__/tab-bar-store.test.ts ./src/lib/acp/store/queue/__tests__/queue-utils.test.ts`
- `rg "currentStreamingToolCall" packages/desktop/src/lib/acp/store/tab-bar-utils.ts packages/desktop/src/lib/acp/store/urgency-tabs-store.svelte.ts packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-content.svelte -n` returns no matches.

## Additional GOD Sweep: Remove First Pending Interaction Fallback

Status: completed

Problem:

- `buildSessionOperationInteractionSnapshot(...)` selected the first pending question, permission, or plan approval when no operation match existed.
- That made UI state depend on map insertion order instead of a canonical operation/interaction relationship.
- A stale or unrelated pending interaction could make a session look answer-needed even without a proven operation anchor.

Fix:

- Removed the first-pending fallback for questions, permissions, and plan approvals.
- The snapshot now reports a pending interaction only when it can be matched to an operation by tool call id or operation provenance key.
- Added regression tests for unmatched question, permission, and plan approval cases.

Verification:

- Red check first: `cd packages/desktop && bun test ./src/lib/acp/store/__tests__/operation-association.test.ts` failed on unmatched interactions being selected.
- `cd packages/desktop && bun run check`
- `cd packages/desktop && bun test ./src/lib/acp/store/__tests__/operation-association.test.ts ./src/lib/acp/store/__tests__/live-session-work.test.ts ./src/lib/acp/store/__tests__/tab-bar-utils.test.ts ./src/lib/acp/store/__tests__/tab-bar-store.test.ts ./src/lib/acp/store/queue/__tests__/queue-utils.test.ts`
- `rg "firstQuestion|firstPermission|firstPlanApproval|pending.*== null && first" packages/desktop/src/lib/acp/store/operation-association.ts -n` returns no matches.

## Additional GOD Sweep: Hide OperationStore From UI Components

Status: completed

Problem:

- Svelte UI components were reading `OperationStore` directly for modified files, permission visibility, tool-call lookup, tab tool kind, and interaction snapshots.
- That leaked operation graph access into the UI layer instead of keeping operation truth behind the app/session projection boundary.

Fix:

- Added narrow `SessionStore` projection methods for:
  - session modified-files state
  - operation-backed interaction snapshots
  - tool-call lookup by id
  - current tool kind
  - permission visibility/representation
- Moved permission/operation visibility logic into a store-level helper.
- Updated agent panel content, agent panel shell, permission bar, tab bar store, and urgency tabs store to call `SessionStore` projections instead of holding `OperationStore`.

Verification:

- `cd packages/desktop && bun run check`
- `cd packages/desktop && bun test ./src/lib/acp/components/tool-calls/__tests__/permission-visibility.test.ts ./src/lib/acp/store/__tests__/tab-bar-utils.test.ts ./src/lib/acp/store/__tests__/tab-bar-store.test.ts ./src/lib/acp/store/queue/__tests__/queue-utils.test.ts ./src/lib/acp/store/__tests__/operation-association.test.ts`
- `rg "getOperationStore\\(|operationStore|getSessionToolCalls\\(" packages/desktop/src/lib/acp/components packages/desktop/src/lib/acp/store/tab-bar-store.svelte.ts packages/desktop/src/lib/acp/store/urgency-tabs-store.svelte.ts -n --glob '!**/__tests__/**'` shows no Svelte component direct `OperationStore` ownership.

## Additional GOD Sweep: Narrow Compatibility Entry Mutation

Status: completed

Problem:

- `IEntryManager` still exposed entry-store concepts that service code should not own.
- Test doubles kept obsolete row mutation methods alive, which made the boundary look wider than production needs.
- Internal compatibility row writes were named `addEntry(...)` and `updateEntry(...)`, which made them sound like general transcript authority instead of a projection detail.

Fix:

- Narrowed `IEntryManager` to lifecycle-facing entry operations only: preload mark, clear, assistant-boundary reset, and streaming-finalize.
- Removed unused public `removeEntry(...)`.
- Renamed the internal compatibility row writer methods to `appendCompatibilityEntry(...)` and `replaceCompatibilityEntry(...)`.
- Updated chunk aggregation and transcript tool-call buffering to depend on the renamed internal compatibility row interface.
- Trimmed service test doubles so tests no longer advertise direct transcript row mutation through `IEntryManager`.

Verification:

- `cd packages/desktop && bun run check`
- `cd packages/desktop && bun test ./src/lib/acp/store/services/session-connection-manager.test.ts ./src/lib/acp/store/services/__tests__/session-messaging-service-stream-lifecycle.test.ts ./src/lib/acp/store/services/__tests__/session-messaging-service-send-message.test.ts ./src/lib/acp/store/services/__tests__/session-repository-startup-sessions.test.ts ./src/lib/acp/store/services/__tests__/session-repository-refresh-source-path.test.ts ./src/lib/acp/store/services/__tests__/session-repository-placeholder-title.test.ts ./src/lib/acp/store/__tests__/session-entry-store-streaming.vitest.ts ./src/lib/acp/store/services/__tests__/chunk-aggregator.test.ts ./src/lib/acp/store/services/__tests__/transcript-tool-call-buffer.test.ts`
- `rg "entryManager\\.(hasEntries|unmarkPreloaded|storeEntriesAndBuildIndex|addEntry|removeEntry|updateEntry|aggregateAssistantChunk)" packages/desktop/src/lib/acp -n` returns no production service calls.

## Additional GOD Sweep: Remove Public OperationStore Escape Hatch

Status: completed

Problem:

- `SessionStore.getOperationStore()` exposed the full operation graph to app views.
- Queue, kanban, review fullscreen, and session-list item code were pulling operation truth directly instead of asking for narrow session projections.
- The standalone Svelte context helpers `createOperationStore(...)` and `getOperationStore(...)` were unused but still suggested a second operation-store access path.

Fix:

- Added narrow `SessionStore` operation projections for:
  - current streaming tool call
  - last tool call
  - last todo tool call
  - existing current tool kind, tool lookup, session tool calls, modified-files state, and interaction snapshot projections
- Updated app queue row, kanban view, review fullscreen, and session item to use those projections.
- Removed `SessionStore.getOperationStore()`.
- Removed unused Svelte context helpers from `operation-store.svelte.ts` and stopped exporting them.
- Updated tests to use public projections or direct injected test-owned stores.

Verification:

- `cd packages/desktop && bun run check`
- `cd packages/desktop && bun test ./src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts ./src/lib/acp/store/__tests__/session-entry-store-streaming.vitest.ts ./src/lib/acp/store/__tests__/tab-bar-store-non-agent.vitest.ts ./src/lib/acp/store/__tests__/urgency-tabs-store.test.ts ./src/lib/acp/components/tool-calls/__tests__/permission-visibility.test.ts ./src/lib/acp/store/__tests__/tab-bar-store.test.ts ./src/lib/acp/store/__tests__/tab-bar-utils.test.ts`
- `rg "getOperationStore|createOperationStore|operationStore = sessionStore" packages/desktop/src -n --glob '!**/__tests__/**' --glob '!**/*.test.ts' --glob '!**/*.vitest.ts'` returns no production access path.

Follow-up cleanup in the same slice:

- Removed the component-layer `permission-visibility.ts` wrapper because it accepted `OperationStore`.
- Removed the exit-plan helper export that accepted `OperationStore`.
- Tests now target the store-level permission projection helpers directly.

Additional verification:

- `cd packages/desktop && bun test ./src/lib/acp/components/tool-calls/__tests__/permission-visibility.test.ts ./src/lib/acp/components/tool-calls/__tests__/exit-plan-helpers.test.ts`
- `rg "OperationStore" packages/desktop/src/lib/acp/components packages/desktop/src/lib/components -n --glob '!**/__tests__/**' --glob '!**/*.test.ts' --glob '!**/*.vitest.ts'` returns no component-layer operation-store dependency.
