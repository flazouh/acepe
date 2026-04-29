---
module: acp-session-architecture
tags:
  - final-god
  - session-graph
  - provider-owned-restore
  - operations
  - lifecycle
problem_type: architecture
---

# Final GOD Architecture

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

Provider quirks stop at the adapter edge. The backend-owned graph owns product truth. Desktop stores/selectors project canonical materializations. UI components render already-normalized DTOs. Raw provider traffic and raw ACP updates may remain only as redacted diagnostics or coordination data behind a structural observability boundary.

## Unit 0 gates

Before deleting compatibility authorities, the implementation must establish:

- a provider-history restore audit corpus for every supported provider,
- at least one parseable non-empty history case, one missing-history case, and one unparseable-history case per supported provider,
- per-provider provenance-key stability verdicts across live stream, provider-history restore, and reconnect,
- a cold-open P95 time-to-first-entry-render baseline,
- a 25% maximum P95 regression gate before local restore/cache paths can be deleted,
- superseded status pointers on older active architecture plans.

## Deletion proof targets

The final integration gate must prove:

- no product code path depends on `ToolCallManager` as operation truth,
- no product code path depends on `SessionHotState` as lifecycle truth,
- raw session-update and inbound-request lanes cannot mutate transcript, operation, interaction, or lifecycle product stores directly,
- local journal/snapshot paths cannot reconstruct provider content when provider history is missing,
- diagnostics are structurally blocked from product-store imports.

## Deletion-proof outcome

The final stack removes or demotes the old peer authorities:

| Former authority | Final status |
|---|---|
| `ToolCallManager` | Replaced by `TranscriptToolCallBuffer`, a transcript-only compatibility buffer. Product operation identity/state is owned by canonical operation IDs and `OperationStore`. |
| `SessionHotState` | Replaced by `SessionTransientProjection`. Lifecycle/actionability/activity selectors prefer canonical graph projection; transient state is a compatibility/config/telemetry projection, not lifecycle truth. |
| Raw `acp-session-update` lane | Diagnostic/coordination only. Raw tool calls, tool updates, plan payloads, user chunks, permission requests, and question requests do not mutate transcript/operation/interaction/lifecycle product stores. |
| Raw `acp-inbound-request` lane | Normalized at the edge and used only for response coordination; canonical interaction state flows through graph patches. |
| Local journal/projection restore | No longer reconstructs provider-owned session content when provider history is missing. Provider-history restore owns cold-open content; Acepe-owned metadata layers on top. |
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

Tauri MCP live-app verification was attempted during closure, but no MCP Bridge app was reachable on the local driver port. The automated component tests cover the known stale-row/teardown crash class; a human live-app smoke pass should still be run before merge if the PR gate requires fresh Tauri evidence.

## Unit 7 closure (2026-04-27)

Unit 7 final integration proof completed after provider-owned session identity landed.

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
- `hotState.status === "loading"` in `setSessionLoaded()` is a pre-connection UX guard (prevents double-transition to idle), not lifecycle authority. Canonical projection is primary; this fires only in the brief window before the first `SessionStateEnvelope` arrives.

**Live Tauri smoke pass:** Still required for teardown, reconnect, and pending-permission survival scenarios. Automated component tests cover the stale-row/teardown crash class; Tauri driver was unreachable during automated closure.

## Unit 9 canonical widening closure (2026-04-29)

The pure GOD canonical widening plan is closed on automated gates:

- `SessionTransientProjection` is now residual-only: `acpSessionId`, `autonomousTransition`, `statusChangedAt`, `modelPerMode`, `usageTelemetry`, `pendingSendIntent`, `localPersistedSessionProbeStatus`, and `capabilityMutationState`.
- `SessionCapabilitiesStore`, `ICapabilitiesManager`, and `sessionStore.getCapabilities()` are deleted. Product capability readers use canonical projection accessors.
- Lifecycle, actionability, activity, turn state, failures, terminal-turn id, mode/model, commands, config options, autonomous truth, provider metadata, and model display are no longer hot-state fields.
- `canonical-projection-parity.test.ts` verifies a representative cold-open snapshot and live snapshot envelope produce identical canonical projections and capability accessors.
- The GOD clearance scan found no forbidden bridge references, canonical-overlap hot-state reads/writes, or canonical-to-hot-state fallback patterns in ACP store code.

Tauri live-app smoke was not run during this closure because no MCP Bridge app was connected to the local driver. A human live-app pass remains appropriate before merge if the PR gate requires fresh UI evidence for send-disable latency, model switching, autonomous toggles, turn errors, reconnect, and local-created persisted-session restore failure.


## Post-land learnings

- `docs/solutions/logic-errors/terminal-state-guard-missing-blocked-2026-04-25.md` — After the GOD stack landed, a regression was found where `isTerminalOperationState` in `operation-store.svelte.ts` lacked `"blocked"` in its terminal-state set. ToolCall `in_progress` events could overwrite a canonical blocked patch. The guard is the enforcement mechanism for the GOD rule that raw event lanes cannot regress settled canonical state.
- `docs/solutions/logic-errors/reserved-first-send-routed-through-resume-2026-04-28.md` — After PR 180, fresh `Reserved` sessions could route their first prompt through resume/load because desktop projections still filled lifecycle/actionability gaps from hot state. The GOD routing invariant is explicit now: `Reserved` first-send uses direct send; `Detached` restore uses resume/load.
- `docs/solutions/test-failures/bun-module-mock-cache-leakage-2026-04-25.md` — `analytics.test.ts` was deleted after its partial `mock.module` stub for `settings.js` leaked into `settings.test.ts` via Bun's per-process module cache.
