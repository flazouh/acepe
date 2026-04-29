---
date: 2026-04-29
topic: long-session-performance
---

# Long-Session Performance Stabilization

## Problem Frame

Acepe sessions can run for hundreds of turns and thousands of live events. The original overheating investigation found one critical root cause: hot `ToolCall` / `ToolCallUpdate` events emitted full canonical snapshots, cloning and serializing accumulated transcript and operation history on every hot update. That root cause is now addressed in `docs/plans/2026-04-28-002-refactor-pure-god-canonical-widening-plan.md` Unit 0, which requires bounded canonical deltas (`operation_patches` for tool operation changes).

The next performance pass should treat Unit 0 as the intended baseline, verify that baseline before planning new optimization work, and identify the remaining long-session risks that still scale with total history, visible row count, session count, journal size, or snapshot repair size. This is a measure-first requirements document: it inventories plausible risks, but it does not require fixing every listed path unless measurement or code evidence shows that path is material.

The product outcome is simple: a developer should be able to leave long agent sessions running without Acepe saturating CPU, heating the machine, or becoming progressively less responsive.

## Current Performance Issue Inventory

| Area | Current state | Risk |
|---|---|---|
| Hot tool updates | Unit 0 now routes `ToolCall` / `ToolCallUpdate` through bounded deltas instead of full snapshots. | Must be protected by regression tests and payload-size guards so this does not regress. |
| Non-tool snapshot events | `PermissionRequest`, `QuestionRequest`, `TurnComplete`, `TurnError`, `ConnectionComplete`, and `ConnectionFailed` still trigger snapshots. | Lower-frequency events can still clone/serialize full transcript + operation history, especially on long turns, reconnects, and repair paths. |
| Transcript virtualization fallback | Main transcript uses Virtua, but native fallback can become the active path when viewport/render probes fail. | Any fallback must stay bounded; otherwise one measurement failure can mount the full long transcript. |
| Visible-row reactivity | `thinkingNowMs` ticks every second while waiting and is read inside row rendering. | Under Virtua this should be bounded to visible rows, not the full transcript, but Phase 0 must confirm whether the reactive graph or helper calls still scale with total entry count. |
| Transcript array churn | `SessionEntryStore.addEntry` / `updateEntry` mutate by replacing session entry arrays; `buildVirtualizedDisplayEntries(entries)` rebuilds display entries from the full array. | Streaming segments and appended entries can still trigger O(transcript entries) frontend work. |
| Modified files aggregation | `aggregateFileEdits(sessionEntries)` scans all entries when the agent panel derives modified-file state. | Long sessions with many tool calls make review affordances more expensive than the changed entry warrants. |
| Operation selectors | Current-streaming lookup has working-tree guard work that must be verified as committed or explicitly included in the plan; last-tool and last-todo lookups still scan/materialize operations. | Session item, queue, kanban, and tab surfaces can multiply operation scans across many sessions. |
| Sidebar session list | The sidebar already limits rendered sessions per project through `getVisibleSessionsForProject()` / `SESSION_LIST_PAGE_SIZE`; it is not currently a primary suspected hotspot. | Preliminary classification: likely a regression guard only. Phase 0 may override this if measurement unexpectedly shows sidebar work is material. |
| Rust projection tracking | `completed_tool_call_ids` is a `Vec` with linear duplicate checks and grows with completed tools. | The cost is secondary after Unit 0, but still grows across very long sessions and can inflate snapshot payloads. |
| Transcript snapshot clone paths | `TranscriptProjectionRegistry::snapshot_for_session()` and `apply_delta()` return snapshots by cloning all entries. | Snapshot repair, reconnect, replay, or explicit open paths still have O(transcript entries) cost. |
| Session journal replay | `SessionJournalEventRepository::list_serialized()` loads all events for a session. | Reopen/reconnect can get progressively slower as journal history grows because replay is a full-history load/deserialization path. |
| Session journal append | `append()` does `SELECT MAX(event_seq)` per persisted journal event, but the sequence lookup is indexed by session and sequence. | Treat append as a secondary per-event round-trip concern, not the same O(history) risk as replay. Measure only if permission/question/turn-event persistence appears material. |
| Observability | There is no durable long-session perf dashboard or budget test covering backend payload size, frontend render cost, fallback state, and session-open replay. | Without measurement, future regressions will look like “Acepe feels hot” instead of failing a clear contract. |

## Requirements

Architectural invariants are not gated by Phase 0 materiality: hot tool deltas must stay bounded, transcript fallback must never mount unbounded history, and performance work must not reintroduce parallel lifecycle/capability authority. Conditional optimization requirements only activate when Phase 0 or code evidence shows material impact.

**Phase 0: Baseline Validation, Performance Contracts, and Observability**
- R1. Before planning optimizations, Acepe must define a long-session performance fixture or synthetic scenario with an initial floor of at least hundreds of transcript entries, hundreds of completed operations, thousands of live events, and an active streaming turn. The fixture must either be calibrated against a real long-session journal, event log, or observed session, or explicitly document the assumed distribution and mark itself unvalidated until real data is collected.
- R2. Unit 0 must be verified as the baseline: hot live `ToolCall` / `ToolCallUpdate` events must remain O(changed operation) in emitted session-state payload size and must not contain transcript entries, full transcript snapshots, full operation arrays, or fields that scale with total session history. A fixture assertion must verify envelope size stays within an approved budget independent of transcript length. If Unit 0 verification fails, this tranche pauses and the work returns to `docs/plans/2026-04-28-002-refactor-pure-god-canonical-widening-plan.md` Unit 0 before other performance work proceeds. Snapshot repair, session open, or reconnect paths that explicitly require full snapshots must be measured and budgeted in Phase 0 (see R18).
- R3. Snapshot-emitting non-tool events must be audited by frequency, payload size, and necessity; planning must distinguish events that can remain snapshot-based from events that need bounded event-specific deltas.
- R4. Backend logs or tests must expose session-state envelope size, payload kind, operation patch count, transcript operation count, event type, and baseline status for long-session scenarios.
- R5. Frontend tests or instrumentation must expose whether the transcript is using Virtua or native fallback, whether fallback remains bounded, and row count by a clear mechanism: DOM-mounted row count in component tests, or a visible-window count derived from available Virtua handle APIs when testing the Virtua path.
- R6. Phase 0 must produce a priority list that classifies every row in the Current Performance Issue Inventory as one of: confirmed hotspot to fix, regression guard to preserve, or deferred/non-material. The list must include the measurement evidence and approved budget behind each classification, and must be captured in the resulting CE plan or an update to this requirements document. Success must be measured with regression guards, not only manual profiling.
- R7. Phase 0 must include a top-level CPU or thermal proxy for the overheating complaint, such as process CPU utilization under the long-session fixture on a reference machine. Payload, render, and replay metrics are necessary but not sufficient if CPU remains saturated.

**Transcript Rendering and Reactive Work**
- R8. Transcript virtualization must never degrade into unbounded full-history DOM mounting, including when Virtua reports zero viewport size, renders no rows, or briefly receives undefined items during churn. Existing bounded native fallback work can satisfy this if it is committed and covered by a regression test; if it is uncommitted, it becomes a Phase 0 prerequisite deliverable before other transcript rendering work begins.
- R9. Waiting/thinking timer isolation must be implemented only after instrumentation or reactive-graph analysis confirms `thinkingNowMs` ticks currently re-render unrelated visible rows or full display-entry derivations. If already scoped correctly, this becomes a regression guard. Any implementation that modifies the timer must avoid adding new `$effect`-driven timer logic and should remove existing timer `$effect` usage when touching that code.
- R10. Display-entry derivation for assistant/thought merging must avoid full transcript rebuilds on hot streaming updates if Phase 0 shows that derivation exceeds the long-session budget when only the newest entry or segment changed.
- R11. Session entry mutations must avoid avoidable O(transcript entries) copying or derived scans on each streaming segment if Phase 0 shows entry-array churn is material and a bounded append/update path preserves behavior.
- R12. Modified-files state must become incremental or operation-backed if Phase 0 shows `aggregateFileEdits` is material. The fix must apply at the function or selector level so reactive and imperative call sites benefit, not only one `$derived` usage.

**Operation and Session Summary Selectors**
- R13. Operation-store selectors used by session items, queues, kanban, tab bars, and agent panels must be O(1) or bounded for confirmed hot “current” views. Current-streaming guard work must be either committed before planning or explicitly included in Phase 0.
- R14. “Last tool call” and “last todo tool call” affordances must stop repeatedly materializing or scanning every operation across rendered session rows if Phase 0 shows those scans are material.
- R15. Operation selector optimizations may use canonical-derived read models, indexes, or caches when they are derived from canonical events and cannot own lifecycle/capability truth. A read model or cache is canonical-derived only if it can be rebuilt from canonical events, never serves as source of truth for lifecycle/activity/capability state, and has no write path from non-canonical sources.

**Multi-Session Summary Surfaces**
- R16. The existing sidebar visible-window behavior must not regress. No dedicated sidebar virtualization or verification work is required unless a sidebar-affecting change is made or Phase 0 measurement unexpectedly identifies it as material.
- R17. Queue, kanban, tab, and session-item summary surfaces must be audited together if Phase 0 measurement or a change to those surfaces reveals material per-session selector multiplication.

**Backend Replay, Snapshot, and Projection Growth**
- R18. Phase 0 must measure snapshot repair/open/reconnect paths for transcript snapshot clone size, operation snapshot size, serialization time, and user-visible blocking time. Phase 0 may propose or revise budgets, but those budgets must be explicit and accepted before optimization implementation begins.
- R19. Phase 0 must measure journal replay for event count, load time, deserialization time, and projection rebuild time on long sessions. Replay optimization is required only if measured reopen/reconnect cost exceeds the approved budget.
- R20. Projection structures such as completed tool-call tracking must use bounded or constant-time data structures when they participate in hot updates, snapshots, or duplicate checks and Phase 0 confirms they are material or payload-visible. If a `Vec` is replaced with a set-like structure, emitted session-state serialization must remain deterministic.
- R21. If measurement shows journal or snapshot compaction is material and a compaction strategy is added, that strategy must preserve canonical replay correctness and provider-owned session identity semantics.

**User Experience**
- R22. Long-session performance fixes must preserve transcript correctness, scroll-follow behavior, review affordances, permissions/questions, and reconnect behavior.
- R23. If a repair/open/reconnect path cannot be made non-blocking within the approved budget, a separate UX requirement must be produced before implementing a user-visible repair/loading state. Otherwise no user-visible conversation UI change is required.
- R24. Performance work must not hide slow canonical paths by restoring `SessionHotState` or another parallel authority. Canonical-derived read models are allowed only when they remain derivable, bounded, and subordinate to canonical event/projection authority.

## Success Criteria

- Phase 0 verifies Unit 0 and any working-tree performance guard work before treating them as baseline.
- Hot `ToolCall` / `ToolCallUpdate` events stay bounded in payload shape and size under a representative long-session fixture.
- Phase 0 records a CPU or thermal proxy for the overheating complaint and uses it as a top-level acceptance signal alongside payload/render/replay metrics.
- Native transcript fallback mounts a bounded tail window rather than the full transcript, or the existing bounded fallback test is confirmed as baseline.
- The active panel remains responsive during a long streaming turn with many historical entries and operations after confirmed hotspots are addressed.
- Session-summary surfaces remain responsive when many sessions exist, while the already-bounded sidebar remains protected from regressions.
- Reopening or reconnecting a long session has an explicit approved budget and either stays within that budget or triggers a separate UX requirement for a repair/loading state instead of unexplained UI freezes.
- Performance regressions are caught by tests, instrumentation, or budget checks before users report overheating.
- The architecture remains canonical-first; no performance fix reintroduces duplicate lifecycle/capability authority, though bounded canonical-derived read models may be used for performance.

## Scope Boundaries

- This brainstorm does not replace `docs/plans/2026-04-28-002-refactor-pure-god-canonical-widening-plan.md`; it starts after Unit 0 and identifies the next performance tranche.
- This brainstorm does not require redesigning the user-visible conversation UI. If measurement shows unavoidable user-visible repair/reconnect blocking, the design of that indicator must be handled as a separate UX requirement before implementation.
- This brainstorm does not require retaining hot state as a performance cache for canonical lifecycle, activity, turn state, or capabilities.
- This brainstorm does not prohibit bounded read models, indexes, or caches that are fully derived from canonical events and never own lifecycle/capability truth.
- This brainstorm does not require optimizing website/marketing pages.
- This brainstorm does not assume every listed risk must be fixed in one implementation plan; Phase 0 must narrow implementation scope to measured or code-proven impact, except for architectural invariants that must always hold.
- This brainstorm does not require journal compaction unless measurement shows replay or append cost is material. If compaction is added, it must preserve canonical replay correctness and provider-owned session identity semantics.

## Key Decisions

- Treat the previous full-snapshot hot tool event bug as the intended resolved baseline, but verify it before planning new optimization work.
- Run Phase 0 measurement before broad refactors. The remaining risks are plausible and code-backed, but their priority should be set by deterministic payload, render/update, and replay shape data rather than thermal reproduction.
- Focus implementation on confirmed O(N) paths: frontend transcript derivation, session-summary selectors, snapshot repair, journal replay, and projection growth only when measurements show they are material.
- Keep canonical-only authority. Performance improvements must make canonical fast enough or add canonical-derived read models; they must not add a second lifecycle/capability authority.

## Dependencies / Assumptions

- Unit 0 from `docs/plans/2026-04-28-002-refactor-pure-god-canonical-widening-plan.md` must be verified as merged or otherwise included in the implementation scope, with regression tests protecting bounded hot tool deltas.
- Current working tree includes additional frontend performance guard work for bounded native transcript fallback and O(1) current-streaming operation lookup. Before planning, classify each as committed baseline, uncommitted prerequisite, or in-scope Phase 0 work.
- Long-session performance must be evaluated on desktop-app behavior, not only isolated unit tests.

## Outstanding Questions

### Resolve Before Planning

- [Affects R1-R7][Technical] What exact synthetic long-session fixture should define the first regression budget, and what real long-session data validates it?
- [Affects R1-R7][Technical] Are Unit 0 and the current working-tree frontend guard changes committed and regression-protected, or must they be included as Phase 0 work?
- [Affects R1-R7][Technical] Which deterministic render/update and payload-shape contracts best represent the overheating complaint in automated or repeatable measurement?
- [Affects R9-R12][Technical] Which frontend O(N) path is actually hottest after Unit 0: display-entry merging, entry-array replacement, modified-file aggregation, or timer-driven row invalidation?
- [Affects R18-R21][Needs research] Does journal replay or transcript snapshot cloning materially affect real reopen/reconnect times on existing long sessions?

### Deferred to Planning

- [Affects R3][Technical] Which remaining snapshot-emitting non-tool events are frequent enough or large enough to require operation-patch-based bounded deltas?
- [Affects R10-R15][Technical] For each measured hotspot, is the simplest fix an index/read model, incremental derivation, or narrower invalidation boundary?
- [Affects R18-R21][Technical] If reconnect or replay is material, is the right fix snapshot reduction, replay compaction, asynchronous repair, or a separate UX requirement for repair/loading state?

## Next Steps

-> /ce:plan for structured implementation planning
