---
title: "perf: remediate desktop thread scroll, streaming reveal, and IPC hotspots"
type: refactor
status: active
date: 2026-03-31
deepened: 2026-03-31
---

# Desktop Thread Performance Hotspots Remediation Plan

> Source of truth: the 2026-03-31 audit of `/Users/alex/Downloads/aweful-perf.json`. There is no upstream requirements document for this work, so this plan uses the measured trace findings and current repo patterns as its planning input.

**Goal:** move the agent-thread interaction path from visibly janky to predictably smooth by collapsing redundant project-level IPC, making GitHub context and badge enhancement demand-driven, and reducing DOM-observer and scroll churn during streaming without changing the visible semantics of thread follow, git status display, or markdown output.

**Architecture:** keep the existing `git-status-cache`, `github-service`, `AutoScrollLogic`, and `ThreadFollowController` as the primary seams. Start with characterization-first coverage and shared data access. Then narrow streaming observer and scroll work. Only escalate into paint/compositing cleanup if a fresh trace still shows the thread is composite-bound after the first two passes.

**Tech stack:** Svelte 5, Tauri 2, neverthrow `ResultAsync`, Vitest/Bun, Virtua-based virtualization, Safari/WebKit timeline traces.

**External research decision:** skipped. The hot path is dominated by local component wiring, shared frontend services, and measured trace evidence already present in this repo.

## Problem frame

Measured findings from the audited trace:

- 26.4 second capture, 185 rendered frames, roughly 7 FPS effective.
- p50 frame time 98ms, p95 284ms, p99 867ms.
- 6,810ms of `composite` time and 1,145ms of `recalculate-styles` time.
- 1,208ms in `scroll` event handlers and 620ms in `MutationObserver` callbacks.
- One 318ms full-GC pause during the interaction window.
- 30 `get_project_git_status` calls and 27 `get_github_repo_context` calls during a single interaction sequence.

Matching code paths already confirmed in the repo:

- direct git-status IPC in `packages/desktop/src/lib/acp/components/file-panel/file-panel.svelte` and `packages/desktop/src/lib/acp/components/tool-calls/tool-call-read.svelte`
- cache-backed but still fan-out-prone git-status reads in `packages/desktop/src/lib/components/main-app-view/components/content/agent-attached-file-pane.svelte` and `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte`
- unconditional repo-context fetch-on-mount behavior in `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte`
- broad subtree `MutationObserver` usage in `packages/desktop/src/lib/acp/components/messages/logic/text-reveal.ts` and `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte`
- scroll, wheel, and reveal follow work split across `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte`, `packages/desktop/src/lib/acp/components/agent-panel/logic/create-auto-scroll.svelte.ts`, `packages/desktop/src/lib/acp/components/agent-panel/logic/thread-follow-controller.svelte.ts`, and `packages/desktop/src/lib/acp/components/browser-panel/logic/scroll-sync.ts`

Hotspot-to-unit traceability:

- git-status IPC fan-out and local state cloning map to Units 1 and 2
- repo-context request fan-out and badge-loading races map to Units 1 and 3
- `text-reveal` observer churn and mutation-driven reindexing map to Units 1 and 4
- thinking-block subtree observation maps to Units 1 and 5
- thread scroll and follow overhead map to Units 1 and 6
- remaining composite-heavy rendering work maps to Unit 7
- GC pressure is treated as a secondary signal to watch during Units 1, 2, and 4 rather than as an isolated standalone unit

## Requirements traceability

- `R1` Eliminate redundant per-project git-status IPC during steady-state thread rendering and file preview updates.
- `R2` Make repo-context lookup lazy and shared so markdown rendering does not fetch GitHub state for every message mount.
- `R3` Preserve current text-reveal correctness while substantially reducing DOM tree walks, mutation reindexing, and fade-related DOM churn.
- `R4` Preserve thinking auto-scroll and thread follow semantics while capping scroll-driven main-thread work to at most one meaningful pass per frame.
- `R5` Keep git diff badges, gutter information, PR badges, and commit badge interactivity correct.
- `R6` Use characterization-first tests and before/after trace verification instead of speculative fixes.

## Scope and non-goals

In scope:

- `packages/desktop` frontend hot paths involved in the audited trace
- shared frontend services that feed the thread and file preview UI
- targeted thread-follow and scroll coordination changes
- targeted CSS and message-wrapper cleanup only if post-fix traces remain composite-bound
- characterization tests, regression tests, and a trace-based verification pass

Out of scope:

- Rust/Tauri backend changes unless frontend call consolidation proves insufficient
- broad replacement of Virtua or the current thread-follow architecture before smaller fixes are exhausted
- unrelated cleanup of every `$effect` in the workspace
- global design or animation refreshes outside the active thread path

## Success criteria

- In the same manual scenario used for the original trace, `get_project_git_status` completes at most once per active project per invalidation window and no more than three times per project path for the whole scenario.
- In the same scenario, `get_github_repo_context` completes at most once per project path per session and does not run for markdown messages that do not render GitHub references.
- The rerun trace cuts `composite` time by at least 50 percent and reduces total `scroll` handler cost below 300ms.
- The rerun trace reduces observer callback time below 150ms and removes full-GC spikes from the common scroll path.
- Post-fix frame targets on the same machine are at least: p50 under 33ms, p95 under 100ms, and no post-warmup frame above 250ms.
- Existing thread-follow, text-reveal, markdown badge, and file-panel behavior remains covered by automated tests and passes `bun run check`.

## Execution posture

- Treat this as characterization-first performance work.
- For each implementation unit below, add or extend the failing regression coverage first, then make the minimum production change needed to satisfy that coverage.
- Re-profile after Unit 3 and again after Unit 6 before deciding whether Unit 7 is necessary.

## Implementation units

### Unit 1: Add characterization coverage and shared-service test seams

**Goal:** prove request fan-out and observer behavior with executable tests before changing production code.

**Files:**

- Modify `packages/desktop/src/lib/acp/services/git-status-cache.svelte.ts`
- Modify `packages/desktop/src/lib/acp/services/__tests__/git-status-cache.test.ts`
- Modify `packages/desktop/src/lib/acp/services/github-service.ts`
- Modify `packages/desktop/src/lib/acp/services/__tests__/github-service.test.ts`
- Modify `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte.vitest.ts`
- Add `packages/desktop/src/lib/acp/components/tool-calls/__tests__/tool-call-read.svelte.vitest.ts`
- Add `packages/desktop/src/lib/acp/components/file-panel/__tests__/file-panel-git-status.svelte.vitest.ts`

**Design:**

- Extend the service modules with testable seams rather than UI-only mocks. The existing cache modules already support injection in places; continue that pattern so repeated mounts can be simulated without patching internals.
- Add focused tests that mount multiple concurrent consumers for the same `projectPath` and assert one underlying fetch, not N parallel requests.
- Add cache reset helpers only where tests need deterministic state isolation. Do not add production-only instrumentation APIs that the app never uses.
- Preserve the `ResultAsync` shape so existing call sites can migrate without changing their error-handling model.

**Required scenarios:**

- multiple concurrent git-status requests for one project reuse the same in-flight work and the same post-resolution cache entry
- repeated git-status reads after invalidation fetch once and then stabilize again
- repeated repo-context reads for one project reuse the same in-flight work and the same cached context
- multiple `MarkdownText` mounts for one project do not trigger repo-context fetching unless the rendered content actually needs GitHub enhancement
- `ToolCallRead` and `FilePanel` tests prove that future refactors can change the data source without losing displayed additions/deletions
- characterization coverage records observer-callback counts and repeated request counts for the audited hot path so later units can prove the counts went down
- characterization coverage records whether the existing hot path still creates bursty allocation pressure or full-GC regressions when many markdown or file consumers mount together

**Exit criteria:** the tests fail under the current fan-out behavior and clearly express the target request counts before any production refactor begins.

### Unit 2: Centralize git-status consumption behind the shared cache

**Goal:** stop bypassing the existing coalescing cache and remove component-local request storms.

**Files:**

- Modify `packages/desktop/src/lib/acp/services/git-status-cache.svelte.ts`
- Modify `packages/desktop/src/lib/components/main-app-view/components/content/agent-attached-file-pane.svelte`
- Modify `packages/desktop/src/lib/acp/components/file-panel/file-panel.svelte`
- Modify `packages/desktop/src/lib/acp/components/tool-calls/tool-call-read.svelte`
- Modify `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte`
- Verify in `packages/desktop/src/lib/acp/services/__tests__/git-status-cache.test.ts`
- Verify in `packages/desktop/src/lib/acp/components/tool-calls/tool-call-read.svelte.vitest.ts`
- Verify in `packages/desktop/src/lib/acp/components/file-panel/__tests__/file-panel-git-status.svelte.vitest.ts`

**Design:**

- Expand `git-status-cache` so it supports the actual lookup shapes the UI needs, especially file-level lookups and reusable project maps, instead of forcing components to call Tauri directly or to rebuild array snapshots for every consumer.
- Replace direct `tauriClient.fileIndex.getProjectGitStatus(...)` calls in `FilePanel` and `ToolCallRead` with cache-backed lookups.
- Remove the write-heavy local record cloning in `agent-attached-file-pane.svelte` where possible. Prefer shared read-only maps or derived selectors over duplicating full git-status arrays into per-component state.
- Preserve explicit invalidation behavior at real file-change boundaries. Do not reduce TTL or force eager refreshes to hide redundant callers.
- Keep `FilePanel` git gutter semantics unchanged. This unit changes the source and timing of status data, not the meaning of additions/deletions. Acceptable timing changes are limited to removing redundant fetches; gutter badges must not flicker, reorder, or visibly clear and refill on a stable file selection.
- `agent-attached-file-pane.svelte` stays in scope because it was already identified as a project-level git-status consumer that mirrors full project maps into component-local state.

**Required scenarios:**

- opening one file panel and one tool-call read for the same project performs one project-level git-status load
- opening multiple attached file tabs for the same project does not multiply underlying project-status requests
- changing file selection inside one project reuses the already-fetched project map
- switching to a different project path performs a new fetch exactly once for that project

**Exit criteria:** all git-status consumers read through the shared cache path and the direct Tauri command no longer appears in component-level git-status effects.

### Unit 3: Make repo-context loading demand-driven and session-shared

**Goal:** stop fetching GitHub repo context on every markdown mount and keep badge enhancement lazy.

**Files:**

- Modify `packages/desktop/src/lib/acp/services/github-service.ts`
- Modify `packages/desktop/src/lib/acp/services/__tests__/github-service.test.ts`
- Modify `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte`
- Modify `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte.vitest.ts`
- Modify `packages/desktop/src/lib/acp/components/messages/logic/mount-github-badges.ts`
- Verify call-site behavior in `packages/desktop/src/lib/acp/components/git-panel/git-panel.svelte`

**Design:**

- Replace the unconditional `if (projectPath && !repoContext)` fetch in `MarkdownText` with a demand-driven trigger.
- Use a cheap eligibility check before requesting repo context. The default mechanism should be a synchronous pattern scan over the source markdown or rendered placeholder output for GitHub badge tokens or references already handled by `mount-github-badges.ts`; do not fetch repo context speculatively for plain markdown.
- Keep the service-level cache indefinite for a session, but add deterministic test reset hooks so repeated test runs do not share cached state.
- Add explicit `clearRepoContextCache()` and `clearRepoContextInflight()` test-reset exports alongside the existing diff-cache reset path so Unit 3 tests can isolate module state deterministically.
- Preserve the explicit on-demand behavior already present in `GitPanel`; that panel is not the problem unless the rerun trace shows otherwise.
- Treat the current 27-call trace count as a planning concern to explain, not an assumption to hand-wave away. If service-level dedupe tests pass but the trace still shows fan-out, instrument the real call sites before broadening the fix.
- Badge interactivity remains required. During the lazy load window, GitHub badges must either render as explicit non-interactive placeholders or stay absent until data is ready; they must not appear interactive and then fail clicks while repo context is still loading.
- Eligibility for repo-context loading should be based on the same GitHub-reference patterns the message layer already enhances: PR references, commit or SHA badge tokens, and repo-scoped shorthand that `mount-github-badges.ts` converts into interactive badges. Plain markdown, ordinary external URLs, and file-path badge rendering must not trigger repo-context loading.

**Required scenarios:**

- `MarkdownText` with plain markdown does not request repo context
- multiple concurrent markdown mounts that do need GitHub enhancement still result in one shared repo-context fetch per project path
- rerendering the same text after repo context resolves does not trigger another service call
- git panel flows continue to fetch repo context once and reuse the cached result across commit and PR actions
- GitHub badge rendering remains stable during the lazy-load window and does not present a clickable-but-broken intermediate state

**Decision gate after Unit 3:** rerun the manual trace. If repo-context requests remain unexpectedly high, add one narrow diagnostic pass at the real call sites before touching unrelated rendering code. If IPC metrics are down but `composite` still exceeds roughly 5,000ms for the same scenario, pull Unit 7 forward before Units 4 through 6 instead of waiting until the end.

### Unit 4: Reduce text-reveal mutation pressure without changing reveal semantics

**Goal:** keep the typewriter effect correct while removing avoidable subtree walks and mutation-driven reindex churn.

**Files:**

- Modify `packages/desktop/src/lib/acp/components/messages/logic/text-reveal.ts`
- Modify `packages/desktop/src/lib/acp/components/messages/logic/text-reveal-model.ts` only if the reveal-state contract needs a new explicit gate
- Modify `packages/desktop/src/lib/acp/components/messages/logic/typewriter-reveal-controller.ts` only if streaming lifecycle signals need to become more explicit
- Verify in `packages/desktop/src/lib/acp/components/messages/logic/__tests__/text-reveal.vitest.ts`
- Verify in `packages/desktop/src/lib/acp/components/messages/logic/__tests__/text-reveal-markdown-integration.vitest.ts`
- Verify in `packages/desktop/src/lib/acp/components/messages/logic/__tests__/text-reveal-model.vitest.ts`

**Design:**

- Preserve the existing correctness contract captured in the tests and the repository learning about masked DOM reindexing.
- Separate mutation classes that truly require reindexing from benign child mutations inside `data-reveal-skip` content and the reveal-fade span path.
- Coalesce repeated mutation bursts into one meaningful reindex/update per frame instead of repeatedly walking the full tree on every observer callback.
- Stop doing work once streaming ends. The observer should not remain active on settled content.
- Avoid turning this into a rewrite of the typewriter feature. The default bias is to keep the current model and remove unnecessary work around it.
- This unit is specifically for streaming message-body text reveal. It does not replace the thinking-block growth strategy from Unit 5.

**Required scenarios:**

- placeholder or badge mounting inside `data-reveal-skip` content does not regress reveal progress or trigger unnecessary full reindexing
- real `characterData` changes still update the reveal source of truth correctly
- rapid DOM mutation bursts during streaming result in one visible update path per frame, not a full-tree pass per mutation
- all existing list, table, blockquote, and badge reveal semantics remain intact in the integration tests

**Exit criteria:** the reveal implementation still satisfies the full existing test matrix while performing less observer-driven tree work in the fresh trace.

### Unit 5: Replace thinking-block subtree observation with bounded follow-on-growth logic

**Goal:** preserve the “thinking” block’s auto-follow behavior without a broad `MutationObserver` over every text mutation in the subtree.

**Files:**

- Modify `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte`
- Modify `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte.vitest.ts`
- Modify `packages/desktop/src/lib/acp/components/messages/content-block-router.svelte` only if a more explicit growth signal is needed

**Design:**

- Replace subtree-plus-`characterData` observation with a narrower growth trigger that can run at most once per frame while the thinking block is visible and streaming.
- Prefer `ResizeObserver` on the thinking content container or its immediate rendered child wrapper as the primary signal, with a tiny `requestAnimationFrame` fallback only if the runtime or test environment cannot surface the same growth semantics reliably.
- Avoid scrolling when the container is already pinned to the bottom.
- Disconnect all growth observation the moment streaming stops or the thinking block collapses.

**Required scenarios:**

- the current “growing inside the same subtree” test still passes
- multiple rapid growth events do not produce repeated redundant `scrollTop` writes in the same frame window
- finished or collapsed thinking blocks stop reacting to content mutations

**Exit criteria:** the assistant-message growth path no longer uses a broad subtree observer during steady streaming, and the fresh trace shows the thinking-block path no longer contributes meaningful observer CPU on the hot scroll scenario.

### Unit 6: Narrow thread scroll work before widening scope to browser-panel cleanup

**Goal:** make the agent thread scroll/follow path do no more work than necessary during rapid wheel and scroll sequences.

**Files:**

- Modify `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte`
- Modify `packages/desktop/src/lib/acp/components/agent-panel/logic/create-auto-scroll.svelte.ts`
- Modify `packages/desktop/src/lib/acp/components/agent-panel/logic/thread-follow-controller.svelte.ts` only if retry scheduling is proven to contribute materially to scroll storms
- Modify `packages/desktop/src/lib/acp/components/browser-panel/logic/scroll-sync.ts` only if the rerun trace still shows browser-panel listeners on the same hot path
- Verify in `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/virtualized-entry-list.svelte.vitest.ts`
- Verify in `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/create-auto-scroll.test.ts`
- Verify in `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/thread-follow-controller.test.ts`
- Verify in `packages/desktop/src/lib/acp/components/browser-panel/logic/scroll-sync.test.ts` if that file changes

**Design:**

- Keep the current follow-vs-detached behavior. The goal is less scroll work, not a new scrolling model.
- Ensure `handleScroll()` and related follow callbacks do not perform repeated meaningful work more than once per animation frame under rapid wheel and scroll input.
- Preserve the existing historical hydration fallback and native fallback safeguards in `virtualized-entry-list.svelte`.
- Touch `scroll-sync.ts` only if a rerun trace still places browser-panel parent listeners on the hot path after Units 2 through 5. Do not widen scope preemptively.

**Required scenarios:**

- detached mode still prevents forced reveals unless explicitly requested
- follow mode still keeps the latest content in view during streaming and post-measurement growth
- historical session hydration and native fallback behavior remain intact
- nested scrollable wheel consumption rules in `create-auto-scroll.svelte.ts` remain unchanged unless a failing test proves they are part of the problem

**Decision gate after Unit 6:** rerun the manual trace. If frame quality now meets the success targets and `composite` is below roughly 3,500ms for the scenario, stop. If the trace is still dominated by `composite`, proceed to Unit 7. If it is still dominated by request fan-out or reveal observers, do not start a paint cleanup yet; fix the still-hot script path first.

### Unit 7: Composite-bound cleanup only if the fresh trace still demands it

**Goal:** address remaining paint/compositing cost after the obvious script and observer overhead has been removed.

**Files:**

- Modify `packages/desktop/src/lib/acp/components/messages/message-wrapper.svelte`
- Modify `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte`
- Modify `packages/desktop/src/lib/acp/components/messages/logic/text-reveal.ts`
- Modify `packages/ui/src/components/markdown/markdown-prose.css` only if styling or containment changes are necessary

**Design:**

- Use the rerun trace to identify the remaining composite-heavy nodes before changing CSS or wrappers.
- Prefer removing unnecessary animated or visibility-toggling work in the thread path over adding new layer hints.
- Avoid speculative `will-change` additions. Only keep paint/compositing changes that are trace-backed and measurable.

**Required scenarios:**

- message layout and markdown readability remain unchanged
- hover and copy affordances still work as before
- text reveal and badge visibility stay visually correct

**Exit criteria:** a post-Unit-7 trace shows the thread is no longer composite-bound in the audited interaction.

## Risks and mitigations

### Risk 1: stale git-status data after centralization

Mitigation:

- keep invalidation explicit and close to real file-changing workflows
- add characterization coverage for invalidate-then-refetch behavior

### Risk 2: text-reveal correctness regressions

Mitigation:

- treat the existing `text-reveal` suites as blocking coverage, not optional regression checks
- preserve the repository learning about masked DOM reindex behavior when narrowing observer scope

### Risk 3: scroll fights or lost follow behavior

Mitigation:

- keep `AutoScrollLogic` and `ThreadFollowController` semantics intact unless tests prove the model is wrong
- use logic tests and component tests together before touching fallback behavior

### Risk 4: optimizing the wrong layer first

Mitigation:

- re-profile after Unit 3 and Unit 6
- only start paint/composite cleanup if the fresh trace still points there after IPC and observer churn are down

## Verification plan

- Run targeted Vitest/Bun suites for every file group touched above, starting with the characterization tests and then the specific thread-follow, markdown, and text-reveal suites.
- Run `bun run check` in `packages/desktop` after the TypeScript/Svelte changes land.
- Re-record the same manual interaction trace that produced `aweful-perf.json` and compare request counts, frame percentiles, composite time, scroll-handler time, and observer time against the success criteria.
- If Unit 7 runs, capture one final validation trace after the paint/compositing cleanup instead of relying on the earlier rerun.

## Suggested execution order

1. Unit 1
2. Unit 2
3. Unit 3
4. Re-profile
5. Unit 4
6. Unit 5
7. Unit 6
8. Re-profile
9. Unit 7 only if still composite-bound
