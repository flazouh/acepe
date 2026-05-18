---
module: acp-session-architecture
last_updated: 2026-05-09
tags:
  - final-god
  - session-graph
  - provider-owned-restore
  - operations
  - lifecycle
problem_type: architecture
---

# Final GOD Architecture — Merge Sign-off Ready

> **Status:** Automated gates are closed, Unit 0 evidence is linked to the explicitly covered provider set (`claude-code`, `codex`, `copilot`, `cursor`), and the live dev-app reopen/reconnect blocker is now closed. The local real-provider corpus produced an overall cold-open P95 of **84 ms** across 20 samples, with per-provider P95s of **12 ms / 9 ms / 314 ms / 84 ms** against Rust-gate maxima of **15 ms / 12 ms / 393 ms / 105 ms** respectively. After the `openPersistedSession` reconnect decoupling landed, the dev Tauri app successfully reopened the same persisted Claude session and stayed clean past the prior **30 s** open-timeout and **60 s** reconnect-timeout windows without logging `OpenPersistedSession Session open timed out`, `Failed to connect session`, or `Failed to reconnect hydrated session`.

## Problem

Acepe had most of the right ingredients for a production-grade agentic developer environment, but still carried old compatibility authorities beside the canonical session graph:

- `ToolCallManager` could still act as operation truth.
- `SessionHotState` could still act as lifecycle/actionability truth.
- raw ACP update lanes could still act as semantic product input.
- local journal/snapshot replay could still reconstruct provider-owned content.

That made the architecture a convergence story instead of a final endpoint.

## Final endpoint

The final GOD authority chain is:

```text
provider facts/history/live events
  -> provider adapter edge
  -> canonical session graph
  -> revisioned materializations
  -> desktop stores/selectors
  -> presentation-safe UI DTOs
```

Provider quirks are absorbed before they become canonical truth: live parser/adapter ingress, provider-history restore/session converters, persisted-history enrichment joins, and transcript snapshot rehydration must all emit the same canonical-safe ids and normalized payload shapes before projection. The backend-owned graph owns product truth. Desktop stores/selectors project canonical materializations. UI components render already-normalized DTOs. Raw provider traffic and raw ACP updates may remain only as redacted diagnostics or coordination data behind an observability boundary; desktop lint/test now enforces that boundary with `packages/desktop/scripts/check-diagnostic-import-boundary.ts`.

## Unit 0 gates

Before deleting compatibility authorities, the implementation must establish:

- a provider-history restore audit corpus for every supported provider,
- at least one parseable non-empty history case, one missing-history case, and one unparseable-history case per supported provider,
- per-provider provenance-key stability and canonical-safe well-formedness verdicts across live stream, provider-history restore, reconnect, and snapshot hydration,
- a cold-open P95 time-to-first-entry-render baseline,
- a 25% maximum P95 regression gate before local restore/cache paths can be deleted,
- superseded status pointers on older active architecture plans.

The checked-in gate scaffolding lives in `packages/desktop/src-tauri/src/history/commands/session_loading.rs` via `ProviderRestoreAuditCase`, `ProviderRestoreAuditReport`, `deletion_gate_status()`, and `max_allowed_time_to_first_entry_render_ms()`. The scaffolding now tracks both `provenance_key_stability` and canonical-safe well-formedness, and synthetic gate coverage includes Cursor alongside the other explicitly named providers.

Linked real-provider sign-off evidence was captured locally on 2026-05-09 with the same Rust audit path used by the gate:

- corpus source: `~/Library/Application Support/Acepe/acepe.db` plus provider transcript stores for `claude-code`, `codex`, `copilot`, and `cursor`
- sample shape: 5 recent real sessions per provider, 20 total
- execution path: the lightweight ignored Rust harness `manual_real_provider_timing_audit` in `session_loading.rs` (used instead of the full Tauri binary path because the machine repeatedly hit disk-space limits during `cargo run`)
- overall cold-open P95: **84 ms**
- per-provider results:
  - `claude-code`: P95 **12 ms**, max allowed **15 ms**
  - `codex`: P95 **9 ms**, max allowed **12 ms**
  - `copilot`: P95 **314 ms**, max allowed **393 ms**
  - `cursor`: P95 **84 ms**, max allowed **105 ms**

With that corpus in hand, Unit 0 provider-set coverage, baseline publication, and real-provider sign-off are closed for merge review.

## Deletion proof targets

The final integration gate must prove:

- no product code path depends on `ToolCallManager` as operation truth,
- no product code path depends on `SessionHotState` as lifecycle truth,
- raw session-update and inbound-request lanes cannot create transcript, operation, interaction, or lifecycle truth; the only remaining exception is the bounded `turnComplete` coordination fallback, which may complete the waiting state machine and finalize still-streaming rows while canonical turn completion races in,
- transcript-operation rendering joins only through explicit canonical `source_link` authority,
- local journal/snapshot paths cannot reconstruct provider content when provider history is missing,
- diagnostics remain on the observability side of the boundary and must not import product stores; desktop lint/test enforces this through `check-diagnostic-import-boundary.ts`.

## Deletion-proof outcome

The final stack removes or demotes the old peer authorities:

| Former authority | Final status |
|---|---|
| `ToolCallManager` | Replaced by `TranscriptToolCallBuffer`, a transcript-only compatibility buffer. Product operation identity/state is owned by canonical operation IDs and graph-fed `OperationStore` snapshots/patches. |
| Raw `ToolCall` operation writer | Deleted. Raw transcript/tool lanes can record transcript display rows, but they cannot create operation identity, update operation lifecycle, or reconcile operation arguments/status in TypeScript. |
| `SessionHotState` | Replaced by `SessionTransientProjection`. Lifecycle/actionability/activity selectors use canonical graph projection; transient state is a residual compatibility/config/telemetry projection, not lifecycle truth. |
| Raw `acp-session-update` lane | Diagnostic/coordination only. Raw tool calls, tool updates, plan payloads, user chunks, permission requests, and question requests do not author transcript/operation/interaction/lifecycle truth. A bounded `turnComplete` fallback still clears local waiting state and finalizes still-streaming rows when canonical turn completion has not arrived yet. The bound is test-backed in `session-messaging-service-stream-lifecycle.test.ts`: the fallback may clear `pendingSendIntent`, record `observedTerminalTurn`, call `sendResponseComplete`, and finalize still-streaming rows, but it does not write canonical-overlap hot-state fields; a late canonical failed turn suppresses the machine-complete path and only finalizes rows. |
| Raw `acp-inbound-request` lane | Normalized at the edge and used only for response coordination; canonical interaction state flows through graph patches. |
| Local journal/projection restore | No longer reconstructs provider-owned session content when provider history is missing. Provider-history restore owns cold-open content; Acepe-owned metadata layers on top. Missing or unparseable provider history surfaces a typed non-retryable restore failure; temporarily unavailable provider history remains a typed retryable failure. In every case the UI shows failure state instead of fabricating transcript content. |
| Local/provider session-id aliases | Removed from steady state. Completed `session_metadata.id` is the provider-owned canonical id; pre-provider state lives in `creation_attempts`; legacy aliases are migration diagnostics only. |
| `replace_checkpoint_for_compat` / `compat_graph_lifecycle` | Removed from production names/call sites; lifecycle checkpoints use the seven-state graph lifecycle path. |

## Session identity endpoint

Provider-owned identity is now part of the GOD boundary: provider facts/history/live events enter through adapters, and completed Acepe sessions are stored under the provider-canonical id before they become product sessions. `session_metadata` no longer carries `provider_session_id` or `provider_identity_kind`; those bridge fields were removed after legacy aliases were migrated or diagnosed. See `docs/solutions/architectural/provider-owned-session-identity-2026-04-27.md`.

## Final verification notes

Automated coverage exercised the final authority chain across Rust reducer/supervisor seams, desktop stores/selectors, operation/interaction materialization, raw-lane non-authority behavior, and agent-panel teardown stability. The key checks were:

- `cargo test --lib --quiet` in `packages/desktop/src-tauri`
- `bun run check` in `packages/desktop`
- focused Bun tests for live session work, queue/tab projections, session status projection, transient projection, and transcript buffering
- focused Vitest tests for session-state envelopes, operation store, raw session-event handling, agent-panel content, and virtualized entry teardown

This document now treats the architecture as closed on automated gates, closed on Unit 0 evidence, and closed on live reopen/reconnect verification in the dev Tauri app.

Live Tauri smoke evidence captured during closure:

- connected to the dev app over the MCP bridge (`localhost:9223`, debug build `v2026.3.33`)
- ran the Streaming Repro Lab through all 5 steps; console traces showed the expected waiting/streaming/completed progression:
  - step 1: `entryCount: 1`, `turnState: "streaming"`, `isWaitingForResponse: true`
  - step 2: `entryCount: 2`, `turnState: "streaming"`, `isWaitingForResponse: false`
  - step 5: `turnState: "completed"`, `isWaitingForResponse: false`
- switched a real session model from `Opus 4.7` to `Sonnet 4.6`; the UI label changed and the console logged `Model change completed` to `claude-sonnet-4-6`
- toggled the live mode selector from `Build` to `Auto`
- closed the live panel, then reopened the same persisted session from the project sidebar; the restored session came back on canonical `Build` + `Opus 4.7` state instead of preserving the transient local overrides, which is the expected authority direction
- the user-supplied screenshot from the same run shows the empty ready-assist panel still carrying the `Worktree` approval row while the restored persisted session remained visible in a separate panel, so pending approval UI survived the panel transition instead of being dropped
- that earlier reopen flow initially reproduced the blocker in logs:
  - `OpenPersistedSession Session open timed out`
  - `SessionConnectionManager Failed to connect session`
  - `OpenPersistedSession Failed to reconnect hydrated session`
- after the source fix, the same close -> reopen pattern was rerun against persisted Claude session `51df0b17-866d-46be-99c6-c6ec99714d6a`; the reopened panel emitted a fresh `SessionConnectionManager Provider model capabilities on session resume` log at `03:21:26` and remained clean past the previous 30 s and 60 s watchdog thresholds with no new timeout or reconnect-error logs
- a pre-session send on the ready panel created a deferred local session without fabricating transcript content: the panel stayed `sessionId: null` until provider identity promotion, then resolved to a new session id and returned to `ready` after a raw-lane `turnComplete`

That live pass closed send-disable latency, waiting-state progression, model switching, autonomous toggle mutation, pending-approval survival, and the reopened-session reconnect blocker rather than merely narrowing it.

## Unit 7 automated-gates pass (merge incomplete) (2026-04-27)

Unit 7 integration proof is closed on automated gates after provider-owned session identity landed; live-app smoke and linked Unit 0 evidence remain outstanding closeout items.

**R28 matrix results — all seams green:**

| Seam | Tests run | Result |
|---|---|---|
| Rust lifecycle supervisor | `acp::lifecycle::` — 7 tests | ✅ pass |
| Rust client layer | `acp::client::` — 193 tests | ✅ pass |
| Rust commands | `acp::commands::` — 68 tests | ✅ pass |
| Rust repository / migrations | `db::repository_test` — 57 tests; `m20260426*`, `m20260427*` — 6 tests | ✅ pass |
| Rust session descriptor / registry | `acp::session_descriptor` — 7; `acp::session_registry` — 2 | ✅ pass |
| Rust session history loading | `history::commands::session_loading` — 12 tests | ✅ pass |
| TypeScript operation store | `operation-store.vitest.ts` | ✅ pass |
| TypeScript session projection | `session-store-projection-state.vitest.ts` | ✅ pass |
| TypeScript create-session store | `session-store-create-session.vitest.ts` | ✅ pass |
| TypeScript connection manager | `session-connection-manager.test.ts` | ✅ pass |
| TypeScript ACP error deserialization | `deserialize-acp-error.test.ts` | ✅ pass |
| Full Rust suite | 2080 passed, 0 failed | ✅ pass |
| Full TypeScript suite | 2648 passed, 0 failed | ✅ pass |

**Remaining schema carry-along (not authority gaps):**
- `OperationProviderStatus` is the canonical type name; deprecated `OperationStatus` alias removed.
- `hotState.status === "loading"` in `setSessionLoaded()` is a pre-connection UX guard (prevents double-transition to idle), not lifecycle authority. Canonical projection is primary; the guard is bounded by `openPersistedSession` completion paths (`found`, `missing`, explicit `error`, or timeout), not by long-lived lifecycle truth.

**Live Tauri smoke pass:** Still required for teardown, reconnect, and pending-permission survival scenarios. Automated component tests cover the stale-row/teardown crash class; Tauri driver was unreachable during automated closure.

## Unit 9 canonical widening automated-gates pass (merge incomplete) (2026-04-29)

The pure GOD canonical widening plan is closed on automated gates:

- `SessionTransientProjection` now retains only residual fields: `acpSessionId` (provider-issued transport/session mapping for bridge coordination), `autonomousTransition` (local toggle animation state), `statusChangedAt` (local timestamp for urgency sorting from canonical lifecycle changes), `modelPerMode` (per-session model selection cache), `usageTelemetry` (adapter-agnostic cost/token display telemetry), `pendingSendIntent` (local send-click guard until canonical acceptance/error), `observedTerminalTurn` (local raw-event UI unstick signal), and `capabilityMutationState` (local mode/model mutation progress).
- `observedTerminalTurn` is a local raw-event UI unstick signal, not canonical turn-state or terminal-turn authority.
- The Unit 7 `loading` guard is not part of `SessionTransientProjection`; it is the content-load state-machine affordance described above and is intentionally outside the residual-field inventory.
- `SessionCapabilitiesStore`, `ICapabilitiesManager`, and `sessionStore.getCapabilities()` are deleted. Product capability readers use canonical projection accessors.
- Canonical lifecycle, actionability, activity, turn state, failures, terminal-turn authority, active mode/model truth, commands, config options, autonomous truth, provider metadata, and model display are no longer hot-state fields.
- `canonical-projection-parity.test.ts` verifies a representative cold-open snapshot and live snapshot envelope produce identical canonical projections and capability accessors.
- The GOD clearance scan found no forbidden bridge references, canonical-overlap hot-state reads/writes, or canonical-to-hot-state fallback patterns in ACP store code.

Tauri live-app smoke was not run during this closure because no MCP Bridge app was connected to the local driver. A human live-app pass remains required before merge for send-disable latency, model switching, autonomous toggles, turn errors, reconnect, and local-created persisted-session restore failure.

## Unit 10 canonical operation authority automated-gates pass (merge incomplete) (2026-04-29)

Operation authority is closed on the GOD model after the canonical operation refactor, subject to the same outstanding live-app smoke and Unit 0 evidence closeout items:

- `operation_state` is required on `OperationSnapshot`; TypeScript no longer derives lifecycle from `provider_status`.
- `provider_status` remains provenance evidence only. Product display status maps from canonical `operation_state` into presentation DTOs.
- `blocked` is a resumable, non-terminal state tied to canonical interaction evidence. Terminal states are `completed`, `failed`, `cancelled`, and `degraded`.
- `source_link` is the only transcript-operation join authority. Synthetic and degraded operations do not fake-join to transcript rows by matching ids, tool-call ids, or provenance keys.
- Raw `ToolCall` and `ToolCallUpdate` lanes no longer create or mutate operation truth. The TypeScript reconciler that merged raw status/arguments into operations was deleted.
- Tool routing for `read_lints` now comes from Rust canonical classification (`ToolKind::ReadLints`), not UI-level raw name/title aliases.
- Shared UI receives presentation-safe status values derived from operations (`pending`, `running`, `blocked`, `done`, `error`, `cancelled`, `degraded`) and remains presentational.

## UI session projection closure (2026-05-18)

The remaining UI session surfaces are now closed on the GOD authority boundary:

- Queue, kanban, session item, tab, urgency, agent panel, composer, and telemetry chip surfaces no longer read broad session hot/runtime objects for session semantics.
- Session lifecycle presentation comes from canonical graph projection selectors. Missing canonical projection fails closed instead of falling back to local hot state.
- Residual local fields are exposed through narrow selectors only: pending send intent, usage telemetry, autonomous toggle busy, lifecycle presentation, and status-changed timestamp.
- Panel-local hot state remains allowed for UI-only state such as drafts, provisional launch state, browser sidebar, and pre-session optimistic visuals. It is not session truth.
- Old generic transcript compatibility writer names are gone. Remaining compatibility writer APIs are explicitly named with `Compatibility`, while product transcript truth uses `replaceTranscriptSnapshot` and `applyTranscriptDelta`.

Deletion-proof scans for this closure are recorded in `docs/plans/2026-05-18-002-refactor-canonical-ui-session-projections-plan.md`.


## Post-land learnings

- `docs/solutions/logic-errors/terminal-state-guard-missing-blocked-2026-04-25.md` — Superseded by the canonical operation authority closure above. The old raw-writer guard treated `blocked` as settled to prevent raw `in_progress` events from overwriting it; the final model makes `blocked` resumable/non-terminal and removes the raw operation writer instead.
- `docs/solutions/logic-errors/reserved-first-send-routed-through-resume-2026-04-28.md` — After PR 180, fresh `Reserved` sessions could route their first prompt through resume/load because desktop projections still filled lifecycle/actionability gaps from hot state. The GOD routing invariant is explicit now: `Reserved` first-send uses direct send; `Detached` restore uses resume/load.
- `docs/solutions/architectural/historical-session-reconnect-frontier-2026-05-16.md` — Historical provider-backed opens must reconnect after snapshot hydration. The provider-history snapshot owns old transcript content; the reconnect owns future/live behavior through a claimable open-token frontier. Do not fix replay or unresolved-tool bugs by making historical sessions read-only.
- `docs/solutions/test-failures/bun-module-mock-cache-leakage-2026-04-25.md` — `analytics.test.ts` was deleted after its partial `mock.module` stub for `settings.js` leaked into `settings.test.ts` via Bun's per-process module cache.
- `docs/solutions/integration-issues/2026-04-30-cursor-acp-tool-call-id-normalization-and-enrichment-path.md` — Cursor ACP proved the provenance-key gate must cover both stability and canonical-safe well-formedness, not just cross-context equality. Cursor can emit composite `toolCallId` values containing control characters; the correct fix is shared, idempotent parser-boundary normalization before canonical operation projection, plus matching normalization in provider-history restore/session converters, persisted-history enrichment joins, and transcript snapshot rehydration.
