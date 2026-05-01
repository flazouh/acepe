---
date: 2026-05-01
topic: agent-panel-content-reliability-rewrite
---

# Agent Panel Content Reliability Rewrite

## Problem Frame

The agent-panel conversation content feels unreliable in day-to-day use: rows sometimes do not load while scrolling, the virtualized list can show blank content, and the rendering stack has accumulated enough migration residue that visual and behavioral regressions are hard to reason about.

Recent Plan 002 and Plan 003 work correctly removed the tool-call dual path and retired `ToolCallRouter`, but the panel is still mid-migration:

- Tool calls now render through the shared scene path.
- User and assistant rows still render through desktop-local message components inside `VirtualizedEntryList`.
- `VirtualizedEntryList` still owns too many responsibilities: virtualization, native fallback, auto-follow, session switching, hydration gating, missing-row diagnostics, scene lookup, theme plumbing, and message rendering.
- The viewport has real blank-state failure modes: hydration can intentionally hold entries empty, fallback probes are frame-count-based, and destructive display-entry shape changes are not remounting the virtualizer by key sequence.

The goal is not to discard the graph-to-scene architecture. The goal is to finish the remaining render migration and replace the brittle viewport adapter with a smaller, testable transcript viewport that renders exclusively from the canonical scene model.

Sequencing is deliberately split: planning must first identify which viewport reliability fixes are independent of the user/assistant scene migration, because the blank-row failures are mostly in the viewport adapter. Independent reliability fixes may land before or in parallel with the migration if they reduce user-visible blank states without deepening the split render path. Migration-dependent viewport work waits for the single scene contract.

## Requirements

**Phase 0: Inventory, Characterization, and Sequencing**

- R1. Before migration implementation begins, planning must inventory every desktop-only behavior currently owned by `UserMessage` and `AssistantMessage`, including streaming reveal behavior, model metadata, markdown rendering, project/file interactions, copy controls, error states, and accessibility behavior.
- R2. The inventory must classify each behavior as one of: already represented in the scene model; requires a new scene-model field; requires an injected callback or host-provided service; or should be deliberately dropped. Phase 1 is not mergeable until every required behavior is represented by one of the first three categories and any scene-model widening is explicit in scope.
- R3. Before viewport rewrite implementation begins, tests must characterize the currently plausible blank and missing-row failure modes using the existing mixed pipeline. If a failure mode cannot be deterministically reproduced, a characterization test that captures the closest observable behavior is acceptable, but the nondeterministic gap must be documented in the plan.
- R4. Planning must classify Phase 2 viewport requirements as either migration-dependent or migration-independent. Migration-independent fixes, such as avoiding permanent blank states or replacing false fallback triggers, may be sequenced before or in parallel with Phase 1 if they do not add new render authority or preserve the split path as a long-term design.
- R5. `bun run check:svelte` errors that originate in agent-panel render-path files must be resolved before the related migration or viewport change lands. For this requirement, render-path files are files directly imported by `VirtualizedEntryList` or by its replacement viewport renderer. If a fix requires broad GOD/sidebar/session-list type work, keep the render-path fix local and defer the broader projection cleanup.

**Phase 1: Complete the Scene Render Migration**

- R6. All conversation entry kinds displayed in the agent-panel content viewport must render through the shared scene-entry contract, including user messages, assistant messages, assistant-merged display rows, thinking indicators, and tool calls.
- R7. `VirtualizedEntryList` must no longer import or directly render desktop-local `UserMessage` or `AssistantMessage` branches for normal conversation content. Any desktop-only behavior that is still required must be surfaced as scene-model data, renderer props, or explicit injected callbacks.
- R8. The render path must not silently reconstruct missing scene entries from transcript-shaped DTOs. If a renderable display row cannot find its canonical scene entry, the graph/scene materialization layer must emit a first-class degraded scene entry rather than relying on a transcript-derived fallback producer.
- R9. Degraded/missing-scene rows are production-visible but intentionally low-drama: muted warning treatment, user-facing copy equivalent to "Message unavailable" or "This message could not be loaded", no destructive action, and a developer diagnostic log that carries the architecture-specific missing-scene detail. The row should preserve list height/count semantics so viewport math stays stable and should expose accessible readable text rather than icon-only meaning. Recovery happens by the next valid materialization cycle or by the user refreshing/reopening the session; no ad hoc retry button is required in this scope.
- R10. There must be one primary scene-model producer for rendered conversation content: graph materialization. Transcript-derived scene helpers may remain only for tests or non-rendering adapters. Any helper marked temporary must be explicitly deleted before Phase 2 viewport implementation begins.
- R11. `SessionEntry[]` may remain available for non-render derivations such as header title, entry count, exports, or permission context, but it must not be a competing data source for conversation row rendering.
- R12. Phase 1 has a hard intermediate-state guarantee: it is not mergeable unless user, assistant, thinking, and tool rows retain their current required behavior through the shared scene renderer. If the Phase 0 inventory discovers scene-model or materializer gaps, those gaps are in Phase 1 scope or Phase 1 must pause.

**Phase 2: Rewrite the Content Viewport Adapter**

- R13. The content viewport must have a narrow responsibility: take canonical scene entries plus viewport/follow inputs and produce a reliable scrollable transcript. It should not own domain mapping, tool semantics, or multiple render pipelines.
- R14. When the primary virtualized renderer is active, the viewport must not remain blank when scene entries are non-empty. Initial hydration, session switch, resize settling, and fallback transitions must all have explicit non-blank guarantees.
- R15. Bounded fallback may show an explicit out-of-window placeholder for content outside its retained tail window, but it must not silently show an empty panel when entries exist and must never mount unbounded full history. The placeholder should be muted, readable, accessible status/help text, not an empty spacer.
- R16. Undefined or stale virtualizer rows must be guarded at the virtualizer snippet boundary before any message/tool component can be instantiated.
- R17. Destructive display-row shape changes within a session, including shrink, non-prefix replacement, assistant merge changes, and thinking-row removal, must remount or reset the virtualizer before stale row indexes can reach the renderer. Append-only transitions must preserve the active viewport instance.
- R18. Phase 1 must establish and document the stable scene-model key scheme for display rows. Phase 2 destructive-change detection must compare those scene-derived display keys, not legacy `SessionEntry` keys.
- R19. During remount/reset, visual continuity is required: the previous painted content must remain visible until the replacement virtualizer has painted at least one valid row, or a deliberate bounded placeholder must be shown. A blank flash is not an acceptable transition.
- R20. Native fallback must be bounded and reliable, but it must not be entered permanently because of one slow frame. Fallback entry should be based on confirmed layout/render failure signals rather than fixed frame-count guesses.
- R21. Native fallback must be recoverable across session switches and must never mount unbounded full history.
- R22. User scroll intent must detach from auto-follow promptly during streaming. Programmatic scroll suppression must not misclassify deliberate upward user scroll as automatic settling. Existing scroll-to-bottom/follow affordances should be preserved; adding a new affordance is out of scope unless planning confirms none exists and the lack blocks a reliable detach/follow UX.
- R23. Thinking-duration updates must not invalidate every visible conversation row once per second. Thinking duration is a timer-derived decoration seeded by a scene timestamp, not a scene-materialization concern; the thinking indicator may derive elapsed time locally as the explicit exception to the single-producer rule.
- R24. Long-session behavior must stay bounded: rendering and follow work during active streaming should scale with visible rows and the tail entry, not the full transcript history.

**Testing and Observability**

- R25. Phase 0 characterization tests must land before Phase 1 or migration-independent viewport fixes. They may use the existing mixed pipeline because they are proving current behavior.
- R26. Before Phase 2 viewport rewrite work lands, tests must mount real content components for the crash-prone paths. Stubs may be used for narrow unit tests, but at least one integration path must exercise real user, assistant, and tool scene rows through the viewport after Phase 1 provides that path.
- R27. Test coverage must include session switch while streaming, initial historical load, destructive display-row shape changes, native fallback entry and recovery, scroll detach/follow behavior, mixed assistant/tool long-session rows, and resize/observer cleanup.
- R28. Existing "test passes if no error is thrown" scroll tests must become behavioral assertions with expected scroll calls, no-scroll calls, or visible-row outcomes.

## Success Criteria

- The agent panel does not show an empty conversation area when canonical scene entries exist and the active renderer is expected to cover the requested scroll window.
- Scrolling through long mixed conversations reliably loads visible rows without holes, missing rows, or stale row crashes.
- User, assistant, thinking, and tool rows all flow through one scene renderer contract.
- Missing canonical scene data is visible as an explicit degraded state, not silently reconstructed from transcript DTOs.
- The viewport component is small enough to reason about: virtualization/fallback/follow behavior is separated from scene mapping and message/tool semantics.
- Long-session performance remains protected by bounded fallback and visible-row rendering contracts.
- The reliability suite fails against the known current failure modes and passes after the rewrite.

## Scope Boundaries

- Do not replace the canonical graph-to-scene materializer. It is the architecture to preserve.
- Do not reintroduce `ToolCallRouter`, per-kind desktop tool components, or transcript-derived tool semantics as a fallback render path.
- Do not solve unrelated GOD projection fields or sidebar/session-list migrations except where Svelte check failures directly block the content viewport work.
- Do not make the native fallback unbounded. If fallback becomes primary temporarily, it must remain tail-bounded and clearly documented as a transitional behavior.
- Do not redesign the visual look of every tool card as part of this rewrite. Visual cleanup may happen only where it is necessary to preserve a consistent shared renderer.

## Key Decisions

- Complete the remaining render migration and viewport rewrite as separate but dependency-aware tracks. Do not let migration work block independent blank-state stabilization, but do not build the final viewport rewrite on top of the split render contract.
- Keep Virtua as the likely primary virtualizer unless planning proves it cannot satisfy the reliability contracts. The audit points to Acepe's adapter/probe logic as the main problem, not necessarily Virtua itself.
- Treat native fallback as a safety path, not a license to hide virtualizer failure. It should be bounded, recoverable, and observable.
- Favor hard diagnostics over silent reconstruction. A missing scene entry is an architecture violation and should be visible during development and degraded in product UI.
- Treat display rows and scene entries as separate concepts. Scene entries are canonical data; display rows are viewport/layout projections over scene entries, including assistant grouping and thinking-row placement. Display rows may carry keys and grouping metadata, but they do not own content authority.
- Treat thinking duration as a local timer decoration seeded from scene data. It is the only intentional exception to the "all rendered content comes from scene materialization" rule, and it exists to avoid full-row invalidation on every timer tick.

## Dependencies / Assumptions

- Plan 002 and Plan 003 are treated as baseline: tool-call rendering is already unified through `AgentPanelConversationEntry`, and `ToolCallRouter` is retired.
- The graph materializer is the correct authority boundary, but planning must confirm any remaining desktop-only assistant features such as streaming reveal behavior, model metadata, markdown behavior, and project/file interactions through the Phase 0 inventory before Phase 1 can merge.
- Existing long-session performance requirements in `docs/brainstorms/2026-04-29-long-session-performance-requirements.md` still apply.

## Outstanding Questions

### Deferred to Planning

- [Affects R1-R2][Technical] What desktop-only behavior in `UserMessage` and `AssistantMessage` must move into `@acepe/ui`, scene-model fields, or injected callbacks before those branches can be removed?
- [Affects R4][Technical] Which viewport reliability fixes are independent enough to land before the user/assistant migration, and which depend on the post-migration scene key/data contract?
- [Affects R8-R10][Technical] Which transcript-derived scene helpers have live rendered-output callers after Phase 1, and which can be deleted versus kept for tests or non-render adapters?
- [Affects R20-R21][Needs research] Which event-based signal should replace the current frame-count fallback probes: ResizeObserver, MutationObserver, Virtua APIs, or a small adapter-owned state machine?
- [Affects R22][Technical] What scroll-intent heuristic best separates deliberate user detach from programmatic settling during rapid streaming?
- [Affects R25-R28][Technical] Which existing tests should be converted from stubs to real-component integration tests, and which should remain pure logic tests?

## Next Steps

-> /ce:plan for structured implementation planning
