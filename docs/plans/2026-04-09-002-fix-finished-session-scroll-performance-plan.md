---
title: fix: Improve finished session scroll performance
type: fix
status: active
date: 2026-04-09
origin: docs/brainstorms/2026-04-09-finished-session-scroll-performance-requirements.md
deepened: 2026-04-09
---

# fix: Improve finished session scroll performance

## Overview

Long finished agent sessions currently scroll poorly because the conversation row subtree stays too expensive to composite once the thread is no longer live. The plan is to keep the existing Virtua + thread-follow architecture intact, introduce an explicit settled-thread render mode for the main conversation thread, make settled rows cheaper to render while preserving inspection value, and verify the result against the same reproduction path that exposed the slowdown.

This is a bounded fix, not a virtualization rewrite. If the settled-row work plus one bounded tuning pass still cannot meet the benchmark, the escalation path is to stop and open a separate architecture pass rather than quietly expanding this change.

## Problem Frame

The source requirements document established that this is a finished-session reader-performance problem, not primarily an auto-scroll correctness problem (see origin: `docs/brainstorms/2026-04-09-finished-session-scroll-performance-requirements.md`). The current trace shows compositor-heavy stalls while scrolling a long, non-streaming session. Recent thread-follow work already encoded important correctness rules around detach/follow, synthetic thinking rows, fallback reveal behavior, and virtualization remount safety. This plan must improve finished-session scroll performance without reopening those live-thread semantics.

## Requirements Trace

- R1. Target ordinary scrolling in finished, non-streaming agent sessions.
- R2. Reduce the compositor-bound hitch pattern rather than only making scroll handlers cheaper.
- R3. Treat finished sessions as stable reading surfaces with less live-only work.
- R4. Preserve message readability, tool context, file context, and prior-work inspection.
- R5. Ensure suppressed affordances return via stable non-hover triggers after scrolling settles.
- R6. Keep any live-versus-finished distinction implicit and non-disruptive.
- R7. Preserve detach, follow, and send-time reveal behavior for live threads.
- R8. Prefer localized row-subtree changes before architectural rewrites.
- R9. Use before/after verification on the same reproduction path.

## Scope Boundaries

- This plan applies only to the main agent conversation thread in finished sessions.
- This plan does not change the user-facing follow contract for live sessions.
- This plan does not replace Virtua or redesign thread-follow architecture inside this work.
- This plan does not broaden into a general finished-session UX redesign beyond the minimum inspection contract needed for this fix.
- The only finished-session affordances explicitly in scope to preserve or restabilize are copy, existing file-token access, existing tool-context access, and command-output readability; any broader affordance redesign belongs in separate UX work.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte`
  - Owns the Virtua-backed thread viewport, hydration fallback, native fallback, scroll callbacks, and session context propagation.
- `packages/desktop/src/lib/acp/components/agent-panel/logic/create-auto-scroll.svelte.ts`
  - Owns geometry-based follow/detach state, nested-scrollable wheel handling, and suppression for virtualized settling.
- `packages/desktop/src/lib/acp/components/agent-panel/logic/thread-follow-controller.svelte.ts`
  - Owns latest-target routing, forced reveal behavior, and safe fallback when targets are missing or remounted.
- `packages/desktop/src/lib/acp/components/agent-panel/logic/virtualized-entry-display.ts`
  - Encodes stable display keys and the reveal-target versus resize-follow split for synthetic thinking rows.
- `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte`
  - Already differentiates streaming thinking behavior from settled assistant content and carries its own thinking follow logic.
- `packages/desktop/src/lib/acp/components/messages/user-message.svelte`
  - Wraps user text, command output, and file-token affordances in a shared message container.
- `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte`
  - Splits sync versus async markdown rendering, mounts file/GitHub badges, and owns several non-trivial post-render enhancement paths.
- `packages/ui/src/components/rich-token-text/rich-token-text.svelte`
  - Tokenizes inline artefacts into reusable badge components; likely part of remount cost in settled user rows.
- `packages/desktop/src/lib/acp/components/tool-calls/tool-call-router.svelte`
  - Central seam for applying the same settled-thread contract to heavy tool-call surfaces if they contribute materially to the benchmark.
- `packages/desktop/src/lib/acp/components/virtual-session-list.svelte`
  - Good reference for conservative virtualization patterns, explicit size estimation, and bounded overscan decisions.
- `packages/desktop/src/lib/acp/components/virtualization-tuning.ts`
  - Existing location for virtualization tuning constants and row-estimation logic.

### Institutional Learnings

- `docs/solutions/logic-errors/thinking-indicator-scroll-handoff-2026-04-07.md`
  - Preserve the split between reveal targeting and resize-follow targeting; synthetic rows may be revealable without owning growth-follow.
- `docs/plans/2026-03-31-005-refactor-agent-thread-follow-redesign-plan.md`
  - Keep a single authoritative scroller/follow owner and preserve the native fallback path.
- `docs/plans/2026-03-31-004-perf-remediate-desktop-thread-hotspots-plan.md`
  - Favor less work per frame over architectural churn; protect hydration and fallback behavior in `virtualized-entry-list.svelte`.
- `packages/desktop/docs/plans/2026-02-28-refactor-auto-scroll-follow-mode-plan.md`
  - Minimal-first bias, preserve the 300ms stop delay unless disproven, and keep virtualizer rounding tolerance small rather than exact-zero.
- `packages/desktop/docs/plans/2026-02-28-zed-style-scroll-target-follow-plan.md`
  - Stable identity must be by display key, not raw index; missing targets degrade to fallback reveal instead of breaking behavior.
- `packages/desktop/docs/plans/2026-01-31-fix-scroll-anchoring-flickering-plan.md`
  - Near-bottom geometry can lie during content change; do not infer reattachment too aggressively from scroll events.

### External References

- None. The codebase already has strong local patterns for the scrolling, follow, fallback, and testing seams this work touches, so planning proceeds without external research.

## Key Technical Decisions

- **Keep the current scroll/follow architecture.** The performance diagnosis does not justify reopening `createAutoScroll` or `ThreadFollowController` semantics inside this fix.
- **Introduce a reversible settled-thread render mode that stays local to the conversation viewport.** The main conversation thread may expose a local “live” versus “settled” render contract derived from current thread state so nested rows can become cheaper after live work stops and revert immediately if a new turn begins, but no unrelated scroll surface or store consumer may treat it as a new session semantic.
- **Define the settled-state activation rule in the UI layer.** For this plan, the settled path activates only when the thread is not actively streaming, no waiting indicator is active, and no known row-level async enhancement work for the visible thread remains in flight. If the UI cannot prove those signals are quiet, it must stay on the live path. Any new live turn, waiting state, or resumed enhancement work forces an immediate return to live rendering.
- **Use one settled-session inspection pattern across messages and tools.** Finished sessions may simplify live-only chrome, but the preserved inspection affordances stay reachable through one shared low-cost pattern: a stable row-level action anchor that is keyboard reachable, focus visible, semantically labeled, and available without hover timing. During active scroll, heavier row chrome may collapse behind that anchor, but the anchor itself remains discoverable and the fuller actions return when scrolling settles or the row receives focus.
- **Treat virtualization tuning as bounded support work.** One explicit tuning pass is in scope after settled-row simplification lands; a broader virtualizer rethink is out of scope unless the benchmark still misses the budget.
- **Escalation threshold is explicit.** If the agreed reproduction fixture still shows either p95 frame time above 50ms or any repeated run of 2+ consecutive frames above 100ms after Units 2-4, stop and open a separate architecture plan instead of extending this fix.

## Open Questions

### Resolved During Planning

- **Should this plan revisit external docs or best practices?** No. Local patterns around Virtua, thread-follow, fallback reveal, and scroll regression coverage are already strong enough to ground the plan.
- **What counts as a finished session for this plan?** A thread is considered settled when it is not streaming and no waiting indicator is active. The settled path is reversible; a new live turn returns the thread to live rendering immediately.
- **What is the benchmark fixture?** Create a sanitized replay fixture at `packages/desktop/src/lib/acp/components/agent-panel/components/__fixtures__/finished-session-scroll-benchmark.json` from the same long finished session used in the 2026-04-09 originating investigation. Use that fixture after the thread has fully settled, then reproduce the same ordinary scroll sweep through the populated mid-to-late portion of the conversation where the long compositor stalls were observed.
- **What is the canonical benchmark procedure?** Capture three baseline recordings before Units 1-4 and three comparison recordings after Units 1-4 using the same WebKit timeline recording flow, the same finished-session fixture, the same viewport conditions, and the same sweep direction across the problematic region. Compare median p95 and long-frame behavior across the paired runs, store the raw recordings outside the repo, and summarize the comparison rubric plus environment notes in the PR description.
- **What plan depth fits this work?** Standard. The work is cross-cutting across the conversation thread subtree, but it remains bounded to one surface and one reproduction path.

### Deferred to Implementation

- Which exact settled-row simplifications remove the most compositor cost for the benchmark session; the plan defines the seams and guardrails, but implementation-time profiling will choose the cheapest effective subset within the explicit affordance allowlist above.
- Which specific benchmark-proven tool-call components need settled-mode treatment beyond `tool-call-router.svelte`; shared tool-call components may be edited only when the canonical fixture shows them contributing materially to the remaining cost after Unit 3.
- Whether any lightweight helper extraction becomes necessary while editing the row subtree; helper extraction is allowed only if an existing file becomes materially harder to reason about.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

| Thread state | Row rendering path | Follow / reveal behavior |
|---|---|---|
| Live (`turnState === "streaming"` or waiting indicator active) | Existing rich/live row path | Existing `createAutoScroll` + `ThreadFollowController` behavior remains authoritative |
| Settled (not streaming and no waiting indicator) | Cheaper settled row path with stable inspect triggers and less transient chrome | Follow logic remains unchanged; the row subtree simply does less work while being scrolled |

## Success Metrics

- **Primary benchmark:** on the agreed finished-session fixture and the same scroll sweep, the after trace must bring p95 frame time down to **50ms or lower**.
- **Stall elimination:** on that same trace, there must be **no repeated run of 2 or more consecutive frames above 100ms**.
- **Outlier guardrail:** across the canonical after recordings, no single run may contain a frame above **150ms** inside the benchmark sweep.
- **User outcome:** a reviewer can scroll through the same long finished session while keeping context and still reach prior tool/file inspection affordances without noticeable interruption or mode confusion.
- **Secondary validation:** if the canonical fixture is not tool-heavy, run one additional finished-session sweep on a tool-heavy transcript slice and confirm there is no new hitch cluster and no loss of the settled inspection contract.
- **Safety outcome:** existing live-thread regression scenarios for detach, reattach, send-time reveal, and synthetic thinking target handling remain green.

## Alternative Approaches Considered

- **Buffer-only tuning inside Virtua** — rejected as the whole plan because the trace localizes the main problem to row-subtree compositor cost, not only to offscreen retention.
- **Full virtualization or follow-model rewrite** — rejected for this effort because the repo recently converged on Virtua for smoother scrolling and more reliable follow behavior, and the current diagnosis does not justify reopening that architecture inside a bounded fix.
- **Pure memoization without presentation-path changes** — deferred as a supporting tactic only. Memoization is allowed when it directly reduces settled-row remount cost, but it is not the headline strategy because the measured problem is mainly compositor cost in the rendered subtree.

## Implementation Units

- [ ] **Unit 1: Add a settled-thread render contract to the conversation viewport**

**Goal:** Make live versus settled rendering explicit in the main conversation thread so nested rows can branch without touching follow semantics.

**Requirements:** R1, R6, R7, R8, R9

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte`
- Modify: `packages/desktop/src/lib/acp/hooks/use-session-context.ts`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/virtualized-entry-list.svelte.vitest.ts`

**Approach:**
- Derive a reversible thread render mode at the `VirtualizedEntryList` boundary from existing thread state rather than inventing a new store-level scroll system.
- Propagate that mode through the existing session context so message and tool-call rows can opt into a settled path without prop-drilling.
- Keep the render mode as a conversation-viewport-only contract. If a type helper is needed, define it beside the session-context seam rather than broadening shared session/store semantics, and treat any non-thread consumer branching on the field as out of scope.
- Keep `createAutoScroll`, `ThreadFollowController`, and `virtualized-entry-display` behavior unchanged in this unit; this unit is about render-mode definition and containment only.

**Execution note:** Start with characterization coverage around render-mode switching before changing nested rows.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/hooks/use-session-context.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte`

**Test scenarios:**
- Happy path — a streaming or waiting thread exposes the live render mode.
- Happy path — an idle/completed/interrupted/error thread with no waiting indicator exposes the settled render mode.
- Edge case — starting a new streaming turn after a settled state returns the thread to live mode immediately.
- Edge case — visible markdown or badge enhancement work still in flight keeps the thread on the live path until the enhancement signals go quiet.
- Integration — existing detach/follow exports and near-bottom callbacks behave the same across the mode switch.

**Verification:**
- Nested row components can tell whether they are live or settled without any change to follow-controller ownership or reveal semantics, and no unrelated session consumer gains a new branching contract.

- [ ] **Unit 2: Define the minimum finished-session inspection contract**

**Goal:** Preserve the row-level capabilities users still need in finished sessions while making hover-only or transient affordances optional.

**Requirements:** R3, R4, R5, R6

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte`
- Modify: `packages/desktop/src/lib/acp/components/messages/user-message.svelte`
- Modify: `packages/desktop/src/lib/acp/components/messages/copy-button.svelte`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/tool-call-router.svelte`
- Modify: `packages/ui/src/components/agent-panel/agent-tool-thinking.svelte`
- Test: `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte.vitest.ts`
- Test: `packages/desktop/src/lib/acp/components/messages/user-message.svelte.vitest.ts`
- Test: `packages/desktop/src/lib/acp/components/tool-calls/__tests__/tool-call-router-settled-render.svelte.vitest.ts`

**Approach:**
- Explicitly preserve the minimum finished-session inspection capabilities that are in scope for this fix: readable message content, existing file-token access, existing tool-context access, copy/open actions where they already exist, and command-output readability.
- Define one shared settled-session interaction contract across assistant rows, user rows, and tool rows: a stable row-level action anchor remains visible or focus-reachable without hover timing, carries the preserved inspect actions, and is the only pattern this plan may introduce for finished-session inspection.
- Convert any settled-session affordance that was effectively hover-only within that allowlist into the shared stable action anchor or another presentation that remains keyboard reachable, focus visible, and semantically labeled.
- Keep the live path visually and behaviorally unchanged; only the settled path may simplify or relocate transient chrome.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte`
- `packages/desktop/src/lib/acp/components/messages/user-message.svelte`
- `packages/desktop/src/lib/acp/components/tool-calls/tool-call-router.svelte`
- `packages/ui/src/components/agent-panel/agent-tool-thinking.svelte`

**Test scenarios:**
- Happy path — settled assistant rows still expose copy or equivalent inspect actions without relying on hover timing.
- Happy path — settled user rows still preserve file-token interaction and command-output readability.
- Happy path — settled tool-call rows still preserve the existing tool-context access through the same action-anchor pattern as message rows, even if deeper tool optimization is deferred.
- Edge case — affordances suppressed during active scroll return through a stable non-hover trigger once scrolling stops.
- Integration — live streaming assistant rows continue to use the existing thinking and copy affordance behavior while settled rows remain keyboard discoverable.

**Verification:**
- The settled path is cheaper in chrome but still clearly inspectable, and users do not need a manual mode switch or pointer hover to understand how to inspect finished content.

- [ ] **Unit 3: Reduce settled-row cost in message and markdown/token renderers**

**Goal:** Make settled assistant and user rows cheaper to mount and scroll by bypassing live-only work in the heaviest row-level renderers.

**Requirements:** R2, R3, R4, R8, R9

**Dependencies:** Units 1-2

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte`
- Modify: `packages/desktop/src/lib/acp/components/messages/user-message.svelte`
- Modify: `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte`
- Modify: `packages/ui/src/components/rich-token-text/rich-token-text.svelte`
- Modify: `packages/ui/src/components/inline-artefact-badge/inline-artefact-badge.svelte`
- Test: `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte.vitest.ts`
- Test: `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte.vitest.ts`
- Test: `packages/desktop/src/lib/acp/components/messages/rich-token-text-settled-render.svelte.vitest.ts`

**Approach:**
- Keep rendered meaning intact while removing or bypassing work that only matters during live output: repeated follow observers, transient visual effects, and remount-heavy live-only wrappers inside settled rows.
- Use the existing sync-versus-async markdown separation and tokenization boundaries to keep data flow explicit; only introduce memoization where it directly lowers settled-row remount cost and remains local to the rendering seam.
- Bias toward simplifying the DOM and behavior of settled rows before introducing deeper caching machinery.
- Keep any token-interaction regression at a desktop-consumed seam so the standard desktop verification path proves the behavior that the conversation thread actually uses.
- Treat reversibility as an invariant: any settled-only memoization, cached render output, or skipped observer path must be invalidated cleanly when the thread returns to live mode so markdown, badges, and reveal-related helpers recompute from fresh state.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte`
- `packages/ui/src/components/rich-token-text/rich-token-text.svelte`
- `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte`

**Test scenarios:**
- Happy path — settled markdown content still renders the same user-visible text and badges as the live path.
- Happy path — settled rich-token text still preserves token click/open behavior.
- Edge case — switching from live to settled mode after a completed turn does not lose content or duplicate badges.
- Edge case — switching from settled back to live on a new turn re-enables the live rendering path without stale markdown, stale badges, or skipped observers.
- Error path — markdown fallback behavior remains safe when async rendering or badge enhancement cannot run.
- Integration — settled assistant rows do less active follow work while live assistant rows continue to coalesce thinking growth updates correctly.

**Verification:**
- The settled message subtree remains semantically equivalent for reading/inspection while removing measurable work from the benchmark trace.

- [ ] **Unit 4: Apply the same settled-mode contract to heavy tool-call surfaces and make one bounded Virtua tuning pass**

**Goal:** Bring the rest of the benchmark-heavy thread surfaces under the same cheaper settled-session contract and tune only the virtualizer settings that materially affect the measured trace.

**Requirements:** R2, R3, R5, R8, R9

**Dependencies:** Units 1-3

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/tool-call-router.svelte`
- Modify if the canonical fixture proves they remain material after Unit 3: `packages/desktop/src/lib/acp/components/tool-calls/tool-call-task.svelte`
- Modify if the canonical fixture proves they remain material after Unit 3: `packages/desktop/src/lib/acp/components/tool-calls/shared/collapsible-tool.svelte`
- Modify if the canonical fixture proves they remain material after Unit 3: `packages/desktop/src/lib/acp/components/tool-calls/tool-call-execute/components/execute-tool-content.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte`
- Test: `packages/desktop/src/lib/acp/components/tool-calls/__tests__/tool-call-task.svelte.vitest.ts`
- Test: `packages/desktop/src/lib/acp/components/tool-calls/__tests__/tool-call-router-settled-render.svelte.vitest.ts`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/virtualized-entry-list.svelte.vitest.ts`

**Approach:**
- Enter this unit only if, after Unit 3, the canonical benchmark still misses the budget and the timeline shows either tool-call rows or local virtualizer retention behavior as material remaining contributors.
- Apply the settled-mode simplification rules only to benchmark-proven tool-call surfaces, and require any shared tool-call component change to be a no-op outside the main conversation thread's settled render mode.
- Keep tool-call surfaces on the same settled inspection contract defined in Unit 2 even when deeper performance simplification is deferred.
- Make one bounded tuning pass on the Virtua viewport after the row subtree is cheaper: restrict changes to thread-local retained offscreen work, the local `bufferSize`/equivalent viewport tuning, or related row-estimation constants that directly move the benchmark. Replacing the virtualizer, rewriting fallback behavior, or changing follow ownership is out of scope.
- Keep hydration fallback, native fallback, stable display-key identity, and reveal-target fallback behavior intact.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/components/tool-calls/tool-call-router.svelte`
- `packages/desktop/src/lib/acp/components/tool-calls/shared/collapsible-tool.svelte`
- `packages/desktop/src/lib/acp/components/virtual-session-list.svelte`
- `packages/desktop/src/lib/acp/components/virtualization-tuning.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte`

**Test scenarios:**
- Happy path — settled tool-call rows remain readable and inspectable after simplification.
- Happy path — a bounded Virtua tuning change keeps the list rendering correctly in the standard path.
- Edge case — hydration fallback and native fallback still activate when Virtua cannot size or render the viewport correctly.
- Integration — live tool growth with a trailing thinking row still follows the latest revealable content and respects detach behavior.

**Verification:**
- The benchmark trace improves further after the tool-call/tuning pass without introducing new scroll fights or fallback regressions.

- [ ] **Unit 5: Lock the benchmark and live-thread safety net**

**Goal:** Prove the finished-session benchmark improved on the same reproduction path and harden the live-thread regression suite around the render-mode split.

**Requirements:** R1, R2, R7, R9

**Dependencies:** Pre-change benchmark capture has no code dependency; final comparison and safety-net confirmation depend on Units 1-4.

**Files:**
- Create: `packages/desktop/src/lib/acp/components/agent-panel/components/__fixtures__/finished-session-scroll-benchmark.json`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/virtualized-entry-list.svelte.vitest.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/create-auto-scroll.test.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/thread-follow-controller.test.ts`
- Modify: `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte.vitest.ts`
- Modify: `packages/desktop/src/lib/acp/components/messages/__tests__/message-wrapper.resize-observer.test.ts`
- Test: `packages/desktop/src/lib/acp/components/virtualization-tuning.test.ts`

**Approach:**
- Preserve the existing follow/detach/thinking-target regressions as must-pass coverage and extend them only where the settled render mode could leak into live behavior.
- Capture the pre-change baseline before Units 1-4 against the sanitized fixture at `packages/desktop/src/lib/acp/components/agent-panel/components/__fixtures__/finished-session-scroll-benchmark.json`, then repeat the same recording after Units 1-4.
- Use the same WebKit timeline recording flow, the same viewport conditions, and the same scroll sweep through the problematic mid-to-late region for all six canonical recordings so the pass/fail budget stays comparable.
- Compare median p95, repeated long-frame runs, and worst single-frame outliers across the before/after recordings, then run one secondary tool-heavy sweep when the canonical fixture underrepresents tool-call content.
- Enforce the explicit escalation rule: if the benchmark still misses the frame budget after Units 2-4, stop this line of work and open a separate architecture plan rather than adding more structural churn here.

**Execution note:** Start with characterization of the benchmark and existing live-thread tests before final tuning changes.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/virtualized-entry-list.svelte.vitest.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/create-auto-scroll.test.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/thread-follow-controller.test.ts`
- `packages/desktop/src/lib/acp/components/messages/__tests__/message-wrapper.resize-observer.test.ts`

**Test scenarios:**
- Happy path — the agreed finished-session benchmark trace meets the p95 and long-frame thresholds on the same reproduction path.
- Happy path — live send-time reveal, trailing thinking indicator reveal, and latest-tool growth scenarios still pass.
- Edge case — detached live threads remain detached while content grows, even after settled-mode changes exist.
- Edge case — session switches and fallback reveal paths still clear pending work safely.
- Edge case — one secondary tool-heavy finished-session sweep still respects the settled inspection contract and does not reintroduce the same hitch pattern.
- Integration — settled-mode activation and reversion do not change thread-follow semantics when a new turn begins.

**Verification:**
- The benchmark and regression suite together show a real finished-session performance improvement without reopening live-thread correctness problems, and the review artifact includes the multi-run before/after rubric used to compare the recordings.

## System-Wide Impact

- **Interaction graph:** `VirtualizedEntryList` derives render mode -> conversation-scoped session context exposes it -> message/tool-call rows choose live versus settled rendering -> shared UI components (`RichTokenText`, `InlineArtefactBadge`, thinking shells, copy/open affordances) adapt accordingly.
- **Error propagation:** Rendering simplifications must remain fail-safe. If a cheaper settled path cannot enhance badges or async markdown, the row still renders readable content rather than hiding inspection data.
- **State lifecycle risks:** The render mode is reversible. A thread can move from settled back to live on a new turn, so no settled-only cache may orphan or stale live content.
- **API surface parity:** This work stays local to the main conversation thread. It must not silently change unrelated scroll surfaces or store-level session semantics, and any shared component edits must default to existing behavior unless invoked from the conversation thread's settled render mode.
- **Integration coverage:** The most important cross-layer checks are render-mode switching through session context, synthetic thinking-row behavior while live, and fallback/native viewport behavior after tuning.
- **Unchanged invariants:** Stable display keys, reveal-target versus resize-follow split, hydration fallback, native fallback, detach semantics, and forced send-time reveal remain authoritative.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Settled-mode simplification accidentally removes high-value inspection affordances | Define the minimum inspection contract in Unit 2 before optimizing row cost |
| Row-cost work improves one benchmark shape but not the real problem | Use the same originating finished-session fixture, multi-run comparison rubric, and secondary tool-heavy validation sweep in Unit 5 |
| Tuning Virtua reintroduces fallback or reveal regressions | Limit tuning to one bounded pass and keep fallback/native-path tests in the same unit |
| Performance work quietly turns into a broader architecture rewrite | Enforce the explicit escalation threshold and stop the plan if the benchmark still fails after Units 2-4 |

## Documentation / Operational Notes

- If implementation lands a visible finished-session behavior difference, update the changelog entry to frame it as a finished-session reading/performance improvement rather than a general scroll-system rewrite.
- Capture before/after traces or profiling notes outside the repo or in the PR description so reviewers can validate the benchmark movement without baking machine-specific artifacts into source control.

## Sources & References

- **Origin document:** `docs/brainstorms/2026-04-09-finished-session-scroll-performance-requirements.md`
- Related code:
  - `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte`
  - `packages/desktop/src/lib/acp/components/agent-panel/logic/create-auto-scroll.svelte.ts`
  - `packages/desktop/src/lib/acp/components/agent-panel/logic/thread-follow-controller.svelte.ts`
  - `packages/desktop/src/lib/acp/components/agent-panel/logic/virtualized-entry-display.ts`
  - `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte`
  - `packages/desktop/src/lib/acp/components/messages/user-message.svelte`
  - `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte`
  - `packages/ui/src/components/rich-token-text/rich-token-text.svelte`
- Related plans and learnings:
  - `docs/solutions/logic-errors/thinking-indicator-scroll-handoff-2026-04-07.md`
  - `docs/plans/2026-03-31-004-perf-remediate-desktop-thread-hotspots-plan.md`
  - `docs/plans/2026-03-31-005-refactor-agent-thread-follow-redesign-plan.md`
  - `packages/desktop/docs/plans/2026-02-28-refactor-auto-scroll-follow-mode-plan.md`
  - `packages/desktop/docs/plans/2026-02-28-zed-style-scroll-target-follow-plan.md`
  - `packages/desktop/docs/plans/2026-01-31-fix-scroll-anchoring-flickering-plan.md`
