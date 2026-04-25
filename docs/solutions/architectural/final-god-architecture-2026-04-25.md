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
| `replace_checkpoint_for_compat` / `compat_graph_lifecycle` | Removed from production names/call sites; lifecycle checkpoints use the seven-state graph lifecycle path. |

## Final verification notes

Automated coverage exercised the final authority chain across Rust reducer/supervisor seams, desktop stores/selectors, operation/interaction materialization, raw-lane non-authority behavior, and agent-panel teardown stability. The key checks were:

- `cargo test --lib --quiet` in `packages/desktop/src-tauri`
- `bun run check` in `packages/desktop`
- focused Bun tests for live session work, queue/tab projections, session status projection, transient projection, and transcript buffering
- focused Vitest tests for session-state envelopes, operation store, raw session-event handling, agent-panel content, and virtualized entry teardown

Tauri MCP live-app verification was attempted during closure, but no MCP Bridge app was reachable on the local driver port. The automated component tests cover the known stale-row/teardown crash class; a human live-app smoke pass should still be run before merge if the PR gate requires fresh Tauri evidence.


## Post-land learnings

- `docs/solutions/logic-errors/terminal-state-guard-missing-blocked-2026-04-25.md` — After the GOD stack landed, a regression was found where `isTerminalOperationState` in `operation-store.svelte.ts` lacked `"blocked"` in its terminal-state set. ToolCall `in_progress` events could overwrite a canonical blocked patch. The guard is the enforcement mechanism for the GOD rule that raw event lanes cannot regress settled canonical state.
- `docs/solutions/test-failures/bun-module-mock-cache-leakage-2026-04-25.md` — `analytics.test.ts` was deleted after its partial `mock.module` stub for `settings.js` leaked into `settings.test.ts` via Bun's per-process module cache.
