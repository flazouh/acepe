---
title: "refactor: Stabilize agent-panel content viewport"
type: refactor
status: active
date: 2026-05-01
origin: docs/brainstorms/2026-05-01-agent-panel-content-reliability-rewrite-requirements.md
---

# refactor: Stabilize agent-panel content viewport

## Overview

The agent-panel content area is still structurally fragile after the successful Plan 002 and Plan 003 tool-rendering migrations. Tool calls now render through the shared scene path, but `VirtualizedEntryList` remains an 800+ line adapter that combines scene lookup, desktop user/assistant rendering, Virtua integration, native fallback, scroll-follow policy, hydration gates, resize probes, diagnostics, and edit theme plumbing.

This plan makes the next tranche explicit:

1. Characterize the existing blank/missing-row failures and inventory desktop-local message behavior.
2. Complete the remaining scene-render migration for user, assistant, merged assistant, thinking, and degraded/missing entries.
3. Replace the brittle viewport adapter with a smaller scene-driven viewport whose virtualization/fallback/follow behavior is isolated and testable.

Plan-level acceptance criterion: after this work, the panel must not show an empty conversation area when canonical scene entries exist for the active session and the selected renderer is expected to cover the requested scroll window. If a specific row cannot be rendered, the user sees an explicit degraded row or bounded placeholder instead of a blank panel.

This is not a replacement for the canonical graph-to-scene architecture. It preserves graph materialization as the content authority and removes the remaining render-path residue around it.

## Problem Frame

The user-visible failure is reliability: rows sometimes do not load while scrolling, the panel can show a blank conversation, and the current stack feels too dirty to trust. The code audit found real causes:

- `VirtualizedEntryList` intentionally feeds `[]` into Virtua for one hydration frame on historical loads.
- The component can remain blank if hydration/fallback guards see `displayEntries.length === 0` and never recover.
- Fallback probes are fixed-frame heuristics (`MAX_VIEWPORT_RECOVERY_FRAMES`, `MAX_EMPTY_RENDER_FRAMES`) that can false-trigger on slow frames.
- Destructive display-row changes are not keyed by ordered row shape, so stale virtual rows can still reach render snippets.
- User and assistant entries still bypass `AgentPanelConversationEntry` even though graph scene entries already exist for them.
- Missing scene entries silently reconstruct from transcript-shaped DTOs through `mapVirtualizedDisplayEntryToConversationEntry`, hiding architecture violations.

The origin requirements intentionally relaxed migration-first sequencing: independent blank-state stabilization may land before the full user/assistant migration if it does not deepen the split path (see origin: `docs/brainstorms/2026-05-01-agent-panel-content-reliability-rewrite-requirements.md`).

## Requirements Trace

- R1-R2. Inventory desktop-local user/assistant behavior and classify the migration surface before removing those branches.
- R3-R5. Characterize current blank/missing-row behavior and unblock render-path Svelte checks without sprawling into unrelated GOD/sidebar work.
- R6-R12. Route all content rows through the shared scene-entry renderer, make missing scene data explicit, and prevent a half-migrated intermediate state.
- R13-R24. Rewrite the viewport adapter around a narrow scene-driven contract with non-blank guarantees, bounded/recoverable fallback, stable scene-derived display keys, scroll-detach reliability, and isolated thinking timers.
- R25-R28. Add characterization tests before changing the mixed pipeline, then add behavior-oriented real-component tests where the current stub-heavy suite cannot catch regressions.

## Scope Boundaries

- Preserve `materializeAgentPanelSceneFromGraph` as the canonical content authority.
- Do not reintroduce `ToolCallRouter`, per-kind desktop tool components, or transcript-derived tool semantics as live render fallbacks.
- Do not make native fallback unbounded.
- Do not redesign every tool card. Visual changes are limited to preserving behavior through the shared scene renderer and adding a low-drama degraded row.
- Do not fix unrelated GOD/sidebar/session-list Svelte errors unless a render-path file directly requires a local fix.
- Do not replace Virtua unless implementation evidence shows the adapter cannot satisfy the viewport reliability contracts with Virtua.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte` is the current content viewport. It owns display-entry derivation, Virtua setup, native fallback, scroll-follow integration, theme plumbing, and direct user/assistant rendering.
- `packages/desktop/src/lib/acp/components/agent-panel/logic/virtualized-entry-display.ts` builds `VirtualizedDisplayEntry[]` from scene entries. It already has scene-native merging helpers, but it still produces synthetic `SessionEntry`-compatible rows for user/tool display.
- `packages/desktop/src/lib/acp/components/agent-panel/logic/create-auto-scroll.svelte.ts` and `thread-follow-controller.svelte.ts` contain the tested scroll/follow policies. They are better kept as isolated logic than rewritten wholesale.
- `packages/desktop/src/lib/acp/components/agent-panel/logic/graph-scene-entry-match.ts` currently returns `undefined` for `thinking` and `assistant_merged`, and the viewport silently falls back when no canonical scene entry is found.
- `packages/desktop/src/lib/acp/session-state/agent-panel-graph-materializer.ts` materializes transcript user/assistant rows and operation-backed tool rows. It already produces degraded tool rows when a transcript tool lacks canonical operation evidence.
- `packages/ui/src/components/agent-panel/agent-panel-conversation-entry.svelte` is the shared dispatch renderer. It handles user, assistant, thinking, and tool entries, but desktop currently bypasses it for user/assistant rows in the main viewport.
- `packages/ui/src/components/agent-panel/agent-assistant-message.svelte` contains shared assistant rendering with optional `renderBlock` snippets for host-specific streaming reveal behavior.
- `packages/ui/src/components/agent-panel/types.ts` defines the current scene entry union. It lacks a first-class missing/degraded non-tool row variant.

Terminology note: `VirtualizedDisplayEntry` is the current legacy/current viewport data type. Target "display rows" are scene-derived layout rows that carry grouping/windowing metadata and keys, but not independent content semantics.

### Institutional Learnings

- `docs/plans/2026-05-01-002-refactor-agent-panel-single-render-path-plan.md` explicitly deferred migrating user/assistant render branches from desktop-local messages to the shared scene renderer.
- `docs/plans/2026-05-01-003-retire-toolcallrouter-plan.md` completed tool-call path unification and removed `ToolCallRouter`; this plan must not regress it.
- `docs/solutions/ui-bugs/agent-panel-graph-materialization-rendering-bug-2026-04-28.md` documents why transcript rows are only the ordering spine; semantics must come from the canonical graph scene.
- `docs/plans/2026-04-25-001-fix-agent-panel-virtualized-reveal-crash-plan.md` intended to guard Virtua snippet boundaries and remount on destructive display-entry changes. The audit found those intentions are not fully present in current code.
- `docs/brainstorms/2026-04-29-long-session-performance-requirements.md` requires virtualization/fallback behavior to stay bounded and performance work to avoid parallel canonical authority.

### External References

No external research is required for the initial plan. The failure modes are local to Acepe's Svelte 5 / Virtua adapter, canonical scene model, and desktop message components. If implementation proves Virtua itself cannot satisfy the contracts, external research into alternative virtualizers belongs to the deferred implementation decision in Unit 5.

## Key Technical Decisions

- **Plan starts with inventory and characterization.** Removing user/assistant branches without knowing what behavior they own risks a worse intermediate state. Blank-state tests should be written against the current mixed pipeline before either migration or viewport changes.
- **Migration and viewport rewrite are dependency-aware, not strictly serial.** Independent viewport fixes that reduce blank panels may land before full migration if they do not create new render authority or preserve the split path as a target architecture.
- **Scene entries are content authority; display rows are viewport layout.** Display rows may merge assistant scene entries, append thinking rows, and carry viewport keys. They must not own message/tool content semantics.
- **Missing scene data is canonical degraded data, not transcript fallback.** The graph/scene layer should emit a first-class degraded/missing scene entry so the renderer never reconstructs content from transcript DTOs to hide the problem. User-facing copy should say "Message unavailable" or "This message could not be loaded"; architecture details such as missing scene ids belong in diagnostics only.
- **Assistant reveal keys are part of the shared rendering contract.** The shared assistant renderer must receive a stable `revealMessageKey` derived from the scene/display-row key scheme before desktop `AssistantMessage` branches are removed, otherwise later viewport remounts can replay streaming reveal animations.
- **Thinking duration is a timer decoration.** Scene entries should carry stable start/timestamp data, including `startedAtMs` for active thinking rows; the visible elapsed label can be derived locally by the thinking row/component so one timer tick does not invalidate every visible row.
- **Keep scroll/follow logic classes; replace the adapter around them.** `create-auto-scroll` and `ThreadFollowController` are already tested. The brittle part is their integration with Virtua hydration, fallback probes, and display-row shape changes.
- **Bounded native fallback remains a safety path.** It must be recoverable, observable, and explicit about out-of-window placeholders. It must not become an unbounded transcript renderer.

## Open Questions

### Resolved During Planning

- **Should we rewrite from the ground up?** No. Preserve graph-to-scene materialization and the tested scroll/follow logic. Rewrite the viewport adapter and complete the remaining scene renderer migration.
- **Should Phase 2 wait for all of Phase 1?** Not always. Independent blank-state/fallback stabilization can land first if it does not deepen or bless the split render path.
- **Should degraded/missing rows be production-visible?** Yes, but low-drama: muted warning treatment, no destructive action, diagnostic log, and recovery through the next materialization cycle or user refresh/reopen.
- **Should thinking duration flow through full graph materialization every second?** No. Treat it as a local timer decoration seeded from scene timestamp data.
- **Should `revealMessageKey` be entry data or viewport-only prop?** Add it to `AgentAssistantEntry` as optional presentational metadata, populated from the scene-derived display key. This keeps the shared `AgentPanelConversationEntry` contract complete after desktop `AssistantMessage` is removed.
- **Should active thinking rows carry a start timestamp?** Yes. Add `startedAtMs?: number | null` to `AgentThinkingEntry`, matching the existing desktop display-entry precedent, so local timers survive remounts without resetting to component mount time.

### Deferred to Implementation

- **Exact behavior inventory classification:** Unit 1 must classify every desktop `UserMessage` / `AssistantMessage` behavior before migration work proceeds.
- **Fallback trigger mechanism:** Unit 5 should choose the simplest event/state signal that proves Virtua failed without relying on frame-count guesses.
- **Scroll-detach heuristic:** Unit 6 should adjust only if characterization proves the current 400ms auto-mark window misclassifies user scroll during streaming.
- **Virtualizer replacement:** Only revisit Virtua if the adapter rewrite cannot satisfy the tests with Virtua.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
flowchart TD
    Graph[SessionStateGraph] --> Materializer[Graph scene materializer]
    Materializer --> SceneEntries[Canonical scene entries]
    SceneEntries --> DisplayRows[Viewport display rows: grouping, thinking row, keys]
    DisplayRows --> Viewport[SceneContentViewport]
    Viewport --> Renderer[AgentPanelConversationEntry]
    Renderer --> UI[@acepe/ui presentational rows]

    Viewport --> AutoScroll[AutoScrollLogic]
    Viewport --> Follow[ThreadFollowController]
    Viewport --> Virtua[Virtua primary renderer]
    Viewport --> Fallback[Bounded native fallback]

    Missing[Missing scene row] --> Materializer
```

Target split:

| Layer | Owns | Must not own |
|---|---|---|
| Graph materializer | Canonical row content, degraded/missing scene entries, operation-backed tool state | Scroll/window policy |
| Display-row builder | Grouping, display keys, thinking-row placement | Message/tool semantics |
| Viewport adapter | Virtualization, fallback, scroll/follow wiring | Domain mapping or transcript fallbacks |
| `@acepe/ui` renderer | Presentational rendering for all row kinds | Desktop stores or Tauri calls |

## Implementation Units

- [x] **Unit 1: Inventory desktop message behavior and characterize current failures**

**Goal:** Establish the migration surface and red/characterization tests before changing render behavior.

**Requirements:** R1-R5, R25 as characterization coverage only

**Dependencies:** None

**Files:**
- Modify: `docs/plans/2026-05-01-004-refactor-agent-panel-content-viewport-plan.md` if the inventory changes sequencing materially
- Modify/Test: `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/virtualized-entry-list.svelte.vitest.ts`
- Modify/Test: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/virtualized-entry-display.test.ts`
- Inspect: `packages/desktop/src/lib/acp/components/messages/user-message.svelte`
- Inspect: `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte`
- Inspect: `packages/ui/src/components/agent-panel/agent-user-message.svelte`
- Inspect: `packages/ui/src/components/agent-panel/agent-assistant-message.svelte`

**Approach:**
- Build a behavior inventory table for desktop-local `UserMessage` and `AssistantMessage`.
- Classify each behavior as already represented in scene/shared UI, scene-model widening, injected callback/service, or intentionally dropped.
- The inventory is mechanically complete only when every output branch and conditional in `virtualized-entry-list.svelte`, `user-message.svelte`, `assistant-message.svelte`, and their directly rendered content-block chain has been classified. Include streaming reveal keys, content-block rendering, model metadata, markdown behavior, copy controls, project/file interactions, optimistic/error states, and accessibility affordances.
- Add a minimal Virtua isolation characterization test that mounts the real Virtua boundary or the least-mocked available boundary and proves how undefined/empty rendered children reach the viewport snippet.
- Add characterization tests for the currently plausible viewport failures using the existing mixed pipeline:
  - blank historical load / hydration handoff,
  - session switch while waiting/streaming,
  - destructive row-shape changes,
  - native fallback entry and bounded tail behavior,
  - no-error-only scroll tests upgraded to scroll-call assertions.
- If a failure cannot be made deterministic, capture the closest stable behavior and mark the nondeterministic gap in the test name or comments.
- Resolve render-path `check:svelte` issues only where local render-path fixes are enough. Do not widen into unrelated GOD/sidebar migration.

**Execution note:** Characterization-first. Tests may start as passing characterization when the exact production failure is nondeterministic, but they must make the intended post-change contract explicit before later units rely on them.

**Patterns to follow:**
- Existing `setDefaultViewportSize`, `setSuppressRenderedChildren`, `setUndefinedRenderedIndexes`, and `scrollToIndexCalls` harnesses in `virtualized-entry-list.svelte.vitest.ts`.
- Pure logic tests in `virtualized-entry-display.test.ts`.
- Existing message/reveal tests under `packages/desktop/src/lib/acp/components/messages/`.

**Test scenarios:**
- Integration: historical scene entries initially hydrate through the current path and must not remain at zero rows after the hydration frame sequence.
- Integration: rerender with a new `sessionId` while `isWaitingForResponse=true`; assert data does not remain empty and scroll calls target the new session's tail only.
- Edge case: force Virtua to render no children and assert bounded native fallback appears with the expected tail count.
- Edge case: destructive display rows shrink/reorder; assert no stale row reaches a real or prop-reading message component.
- Integration: user scroll detach/follow tests assert expected `scrollToIndexCalls`, not only "no throw".

**Verification:**
- The inventory contains no unclassified desktop message branch or conditional in the current viewport/message chain.
- The tests make current reliability behavior observable and will fail if the viewport silently goes blank, over-scrolls, or mounts unbounded fallback.

**Behavior inventory:**

| Current owner | Branch / conditional | Classification for migration |
|---|---|---|
| `virtualized-entry-list.svelte` | `entry.type === "user"` renders desktop `UserMessage` with synthetic `SessionEntry.message` from scene text | Requires scene/shared UI parity: shared user row already handles rich token text, but desktop-only command-output chunks, generic content blocks, file-panel token clicks, and command-output-card treatment must be either modeled or intentionally dropped before branch removal. |
| `virtualized-entry-list.svelte` | `entry.type === "assistant"` renders desktop `AssistantMessage` | Requires shared renderer widening: assistant markdown/text exists in shared UI, but desktop branch currently supplies `revealMessageKey`, `projectPath`, `streamingAnimationMode`, content-block routing, copy behavior, repo/file badges, and streaming reveal callbacks. |
| `virtualized-entry-list.svelte` | `entry.type === "assistant_merged"` renders desktop `AssistantMessage` from merged chunks | Requires canonical scene/display-row contract: merged rows need deterministic member-id selection or materialized merged assistant scene data; reveal key must stay stable across remounts. |
| `virtualized-entry-list.svelte` | non-user/assistant rows render `AgentPanelConversationEntry` via `getSharedEntry()` | Already shared renderer for tools/thinking, but `getSharedEntry()` currently falls back to transcript-derived mapping and must be replaced by first-class degraded scene data. |
| `virtualized-entry-list.svelte` | missing/undefined virtual row branch only calls `reportMissingVirtualizedEntry()` | Requires explicit degraded/placeholder behavior before final viewport rewrite; current behavior is diagnostic-only and can render nothing for the row. |
| `virtualized-entry-list.svelte` | initial hydration gates non-empty raw entries to `[]` for one frame | Migration-independent viewport stabilization; tests must preserve the observable handoff and prevent permanent zero-row state. |
| `virtualized-entry-list.svelte` | zero viewport and empty rendered-entry probes enter native fallback after fixed frame budgets | Migration-independent fallback stabilization; current tests should characterize bounded fallback and sticky/false-trigger risk. |
| `virtualized-entry-list.svelte` | session switch resets auto-scroll, follow controller, fallback, nudge offset, historical scroll flag | Migration-independent stabilization; stale RAF/probe cleanup must be preserved and tested. |
| `user-message.svelte` | `isOnlyCommandOutput` renders command output without user card wrapper | Requires scene/shared UI parity or explicit product drop; current shared `AgentUserMessage` only renders rich text inside `UserMessageContainer`. |
| `user-message.svelte` | mixed chunks render `CommandOutputCard`, `RichTokenText`, or `ContentBlockRouter` inside `MessageInputContainer` | Requires scene-model widening for chunks/content blocks or deliberate simplification to text-only user rows. |
| `user-message.svelte` | file/image rich-token click opens desktop file panel using `panelStore.openFilePanel()` | Requires injected callback/service from desktop host; cannot move Tauri/store access into `@acepe/ui`. |
| `assistant-message.svelte` | thought groups render through `AgentToolThinking` and desktop `ContentBlockRouter` | Shared UI has equivalent thinking shell, but desktop content-block rendering and local follow/resize behavior must be preserved through `renderBlock` or scene data. |
| `assistant-message.svelte` | message groups render through desktop `ContentBlockRouter` with streaming reveal keys and activity callbacks | Requires `revealMessageKey` on shared assistant entries plus host-provided block rendering/snippet support. |
| `assistant-message.svelte` | copy affordance uses desktop `CopyButton` over message text | Shared UI has a copy button path, but parity should be verified with real shared component tests. |
| `assistant-message.svelte` | invalid message prop falls back to empty message and emits dev warning | Shared renderer should avoid silent data repair for missing scene entries; invalid/missing canonical data belongs in degraded row diagnostics. |
| `ContentBlockRouter` chain | validates text/image/audio/resource/resource_link blocks and renders unknown/invalid fallback text | Requires host-provided renderer or shared block contract before removing desktop assistant/user content-block branches. |
| `markdown-text.svelte` | renders markdown sync/async, file badges, GitHub badges, streaming reveal, repo context, git status, file-panel opens, and Tauri `openUrl` | Requires injected desktop services/snippets; this is the largest desktop-only assistant behavior surface and must not be hidden by a plain markdown scene string. |
| `message-wrapper.svelte` | registers reveal targets, ResizeObserver reveal follow, fullscreen width, `data-entry-key`, `data-message-id` | Viewport responsibility; must carry forward around shared renderer or into replacement viewport rows. |

- [x] **Unit 2: Complete shared renderer coverage for user, assistant, thinking, and missing rows**

**Goal:** Make `AgentPanelConversationEntry` capable of rendering every conversation row currently handled by desktop-local branches, including a first-class degraded/missing scene row.

**Requirements:** R6-R12, R26

**Dependencies:** Unit 1 inventory

**Files:**
- Modify: `packages/ui/src/components/agent-panel/types.ts`
- Modify: `packages/ui/src/components/agent-panel/agent-panel-conversation-entry.svelte`
- Modify: `packages/ui/src/components/agent-panel/agent-assistant-message.svelte`
- Modify: `packages/ui/src/components/agent-panel/agent-user-message.svelte`
- Create or Modify: `packages/ui/src/components/agent-panel/agent-missing-scene-entry.svelte`
- Test: `packages/ui/src/components/agent-panel/__tests__/agent-panel-conversation-entry.svelte.vitest.ts`
- Modify/Test: `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/planning-labels.svelte.vitest.ts`

**Approach:**
- Extend the scene-entry union only as required by the Unit 1 inventory.
- Add a first-class degraded/missing row variant or a clearly typed degraded entry shape that the shared renderer owns.
- Add optional `revealMessageKey` metadata to `AgentAssistantEntry`, thread it through `AgentPanelConversationEntry` into `AgentAssistantMessage`, and ensure desktop scene mapping can populate it from the stable scene-derived display key.
- Add `startedAtMs?: number | null` to `AgentThinkingEntry` so active thinking rows can derive local elapsed duration from materialized scene data instead of component mount time.
- Preserve assistant markdown/reveal behavior by using existing shared `AgentAssistantMessage` extension points rather than re-creating desktop branches.
- Keep the degraded row low-drama and production-visible: muted warning row, "Message unavailable" or "This message could not be loaded" copy, diagnostic-friendly metadata, no retry button in this unit.
- Add accessible semantics for degraded/missing rows: readable text, no icon-only meaning, and a stable label/role that does not imply an action is available.
- Ensure thinking entries can derive elapsed duration locally from stable scene timestamp/duration data without invalidating unrelated rows.

**Execution note:** Test-first for new shared renderer variants. This unit changes the shared UI contract, so tests should render real `AgentPanelConversationEntry` instances rather than export-smoke checks.

**Patterns to follow:**
- Current `AgentPanelConversationEntry` dispatch style.
- Existing `AgentToolOther`/degraded tool presentation for muted diagnostic tone.
- `AgentAssistantMessage`'s `renderBlock` prop for host-specific streaming behavior.

**Test scenarios:**
- Happy path: render a user entry through `AgentPanelConversationEntry` and assert message text appears.
- Happy path: render an assistant entry through `AgentPanelConversationEntry` and assert markdown text appears.
- Happy path: render a streaming assistant entry with `revealMessageKey` and assert the key reaches `AgentAssistantMessage` without forcing desktop `AssistantMessage`.
- Happy path: render a thinking entry and assert the planning/thinking label appears with stable duration behavior.
- Error path: render a missing/degraded scene entry and assert the muted warning copy appears without throwing.
- Integration: render representative tool, user, assistant, thinking, and missing rows in one suite with real shared components.

**Verification:**
- Shared UI has real rendering coverage for all row kinds needed by the desktop viewport.
- No desktop stores, Tauri APIs, or app-specific logic are introduced into `packages/ui`.

- [ ] **Unit 3: Remove desktop-local message branches from the content viewport**

**Goal:** Make the main agent-panel viewport render every row through scene entries and remove silent transcript-derived fallback.

**Requirements:** R6-R12, R18

**Dependencies:** Unit 2

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/virtualized-entry-display.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/graph-scene-entry-match.ts`
- Modify: `packages/desktop/src/lib/acp/session-state/agent-panel-graph-materializer.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/scene/desktop-agent-panel-scene.ts`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/virtualized-entry-list.svelte.vitest.ts`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/virtualized-entry-display.test.ts`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/graph-scene-entry-match.test.ts`
- Test: `packages/desktop/src/lib/acp/session-state/__tests__/agent-panel-graph-materializer.test.ts`

**Approach:**
- Remove direct imports of desktop `UserMessage` and `AssistantMessage` from the viewport.
- Convert display rows into scene-derived layout rows that reference canonical scene ids/member ids and carry grouping metadata only.
- Teach assistant-merged display rows to render via the shared renderer using canonical assistant scene data rather than a desktop `AssistantMessage` branch. The selection rule must be deterministic: a merged row either references one canonical merged assistant scene entry, or it carries ordered member scene ids and materializes an explicit merged assistant scene entry before rendering. It must not choose a member by array index at render time; incompatible member sets should stay separate or degrade with diagnostics.
- Replace `getSharedEntry()` silent fallback with a hard degraded scene entry path. Missing scene data must come from graph/materializer logic or an explicit viewport-level degraded row type that does not reconstruct transcript semantics.
- Establish and document the stable scene-derived display key scheme for Unit 5. This is why R18 is owned by Unit 3: the final viewport rewrite depends on keys created after transcript fallback and desktop branch removal, not legacy `SessionEntry` keys.
- Narrow `mapVirtualizedDisplayEntryToConversationEntry` and `mapSessionEntryToConversationEntry` live usage. If any remain, they must be non-render/test utilities or explicitly marked for deletion before Unit 5.

**Execution note:** Test-first for branch removal. Existing tests that mock `AgentPanelConversationEntry` should be paired with at least one real-component path from Unit 2.

**Patterns to follow:**
- `createGraphSceneEntryIndex` id-based matching pattern, but no silent fallback.
- `materializeMissingToolEntry` as a precedent for canonical degraded scene output.
- Plan 002's single-render-path tests and Plan 003's ToolCallRouter retirement tests.

**Test scenarios:**
- Integration: user, assistant, assistant-merged, thinking, and tool rows all render through the `AgentPanelConversationEntry` path.
- Integration: assistant reveal animation receives the same stable key before and after branch removal, and does not replay on non-content remounts.
- Error path: a display row with no matching canonical scene entry renders the degraded/missing row and logs a diagnostic.
- Edge case: assistant rows merge before a tool row; scene id matching still selects the correct tool and assistant content.
- Edge case: duplicate scene ids remain deterministic and diagnostic rather than selecting by index.
- Regression: `ToolCallRouter`, desktop tool components, desktop `UserMessage`, and desktop `AssistantMessage` are not imported by the viewport.

**Verification:**
- The content viewport has one renderer dispatch path for all row kinds.
- Transcript-derived scene helpers no longer produce live rendered output in the main viewport.

- [ ] **Unit 4: Land migration-independent blank-state stabilization**

**Goal:** Fix blank-state failure modes that do not depend on the full viewport rewrite.

**Requirements:** R3-R5, R14-R16, R20-R21, R25, R27

**Dependencies:** Unit 1. Unit 3 only if the specific fix depends on scene-derived keys.

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/virtualized-entry-list.svelte.vitest.ts`

**Approach:**
- Remove or constrain the hydration state that can hold `displayEntries` empty indefinitely while `sceneEntries` are non-empty.
- Make fallback entry observable and bounded, but avoid permanent fallback after a single slow frame.
- Guard undefined virtual rows at the `VList` snippet boundary before any row subtree is instantiated.
- Ensure session switch cleanup cancels prior probes/RAFs and does not let stale probes flip the next session into fallback.
- Classify each fix before landing it:
  - Scene-key-independent fixes may land early: hydration cannot hold non-empty scene entries at zero rows indefinitely; stale RAF/probe cleanup is session-bound; undefined virtual children are guarded; fallback is bounded and recoverable.
  - Scene-key-dependent fixes wait for Unit 3: destructive key-sequence remount/reset and any assistant-merged key behavior.
- Preserve current scroll/follow behavior unless a test proves it is part of the blank-state failure.

**Execution note:** This unit may land before Unit 3 if planning confirms the fixes are data-source independent. Keep changes surgical; do not deepen the split render path.

**Patterns to follow:**
- Existing native fallback provider and bounded tail-window tests.
- `ThreadFollowController.reset()` generation-guard pattern for stale RAF invalidation.

**Test scenarios:**
- Edge case: component unmounts or rerenders before hydration RAF; new mount/session does not remain blank.
- Edge case: a single delayed render/probe cycle does not permanently switch to native fallback.
- Edge case: fallback remains bounded to the configured tail window.
- Integration: `children` snippet receives `undefined`; no message/tool component is instantiated.
- Integration: session switch clears stale fallback/probe state.

**Verification:**
- The most direct blank-panel risks are covered and fixed without waiting for the full adapter rewrite.
- Unit 5 can port or delete each Unit 4 stabilization test with an equivalent guarantee; no blank-state guarantee is allowed to disappear during the replacement.

- [ ] **Unit 5: Replace `VirtualizedEntryList` with a narrow scene content viewport**

**Goal:** Split viewport responsibilities into focused pieces and make virtualization/fallback behavior testable.

**Requirements:** R13-R21, R24, R26-R28

**Dependencies:** Units 2 and 3. Unit 4 may already have delivered some stabilization.

**Files:**
- Create or Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte`
- Create or Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/scene-display-rows.ts`
- Create or Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/viewport-fallback-controller.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-content.svelte`
- Modify or Delete: `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte`
- Modify or Delete: `packages/desktop/src/lib/acp/components/agent-panel/logic/virtualized-entry-display.ts`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/scene-content-viewport.svelte.vitest.ts`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/scene-display-rows.test.ts`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/viewport-fallback-controller.test.ts`

**Approach:**
- Extract display-row construction into pure logic: scene entries in, display rows out, stable keys out.
- Replace or narrow `virtualized-entry-display.ts`. If retained temporarily, it must become a compatibility wrapper over `scene-display-rows.ts` with no transcript-derived render authority.
- Keep Virtua as the primary renderer initially, but isolate it behind a small adapter boundary.
- Replace frame-count fallback probes with a controller that reasons about observed viewport size and rendered-row presence without irreversible false positives.
- Implement destructive display-row shape detection against Unit 3's scene-derived keys. Remount/reset for shrink or non-prefix replacement; preserve instance for append-only changes.
- Preserve previous painted content or show a deliberate bounded placeholder during remount/reset until at least one valid row paints.
- Keep native fallback tail-bounded and add an explicit out-of-window placeholder when the user is outside retained fallback content. Suggested copy: "Older messages are outside the fallback window"; visual treatment should be muted, non-clickable, and accessible as status/help text rather than an empty region.
- Port or replace all Unit 4 blank-state guarantees in the new viewport tests. The repeated R14-R21 coverage in Units 4 and 5 is intentional: Unit 4 stabilizes the current adapter; Unit 5 must preserve the same guarantees after replacement.
- Keep `create-auto-scroll` and `ThreadFollowController` as dependencies, but wire them through the new viewport rather than interleaving them with domain rendering code.
- Extract helper modules only where they make behavior independently testable, especially display-row key comparison and fallback state transitions. Do not create speculative reusable abstractions.

**Execution note:** Characterization-to-refactor. Start with pure logic tests for display keys and fallback controller transitions, then move the Svelte viewport.

**Patterns to follow:**
- Existing pure logic test style in `virtualized-entry-display.test.ts`.
- Existing `create-auto-scroll` and `thread-follow-controller` APIs.
- `NATIVE_FALLBACK_ENTRY_LIMIT` tail-window behavior from the current viewport.

**Test scenarios:**
- Happy path: append-only scene entries preserve the virtualizer instance and reveal the latest row.
- Edge case: destructive key sequence remounts/resets before stale rows reach the renderer.
- Edge case: bounded fallback shows only tail rows and an out-of-window placeholder when appropriate.
- Edge case: fallback can recover on session switch and does not remain sticky across unrelated sessions.
- Error path: a confirmed primary renderer failure enters fallback once with a diagnostic, not on a single delayed frame.
- Integration: long mixed user/assistant/tool session scrolls through visible windows without holes or blank viewport.
- Regression: each Unit 4 blank-state stabilization test has an equivalent passing assertion against the replacement viewport.

**Verification:**
- `agent-panel-content.svelte` uses the new viewport.
- The old `VirtualizedEntryList` is deleted or reduced to a temporary compatibility wrapper with no domain/render logic.
- Viewport code is small enough that virtualization/fallback/follow behavior is inspectable in isolation.

- [ ] **Unit 6: Tighten scroll-follow, thinking timer isolation, and real-component coverage**

**Goal:** Close remaining reliability gaps after the viewport rewrite.

**Requirements:** R22-R28. R22/R23 are intentionally post-rewrite tuning and timer-isolation work; they are not prerequisites for Unit 5 completion unless Unit 5 tests expose the exact failure.

**Dependencies:** Unit 5

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/create-auto-scroll.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/thread-follow-controller.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte`
- Modify: `packages/ui/src/components/agent-panel/agent-tool-thinking.svelte`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/create-auto-scroll.test.ts`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/thread-follow-controller.test.ts`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/scene-content-viewport.svelte.vitest.ts`
- Test: `packages/ui/src/components/agent-panel/__tests__/agent-panel-conversation-entry.svelte.vitest.ts`

**Approach:**
- Use Unit 1/5 tests to determine whether the current 400ms auto-mark window misclassifies deliberate upward scrolls.
- If needed, adjust scroll-intent logic so user scroll up detaches within one RAF while programmatic settling remains suppressed.
- Move live thinking-duration updates to the thinking row/component using scene-seeded timestamp/duration data.
- Add real-component integration coverage for the full scene viewport path after the migration: user, assistant, thinking, tool, missing/degraded, and long mixed sessions.
- Preserve existing scroll-to-bottom/follow affordances; do not introduce new UX unless tests prove no existing affordance can satisfy detach/follow requirements.

**Execution note:** Test-first for any scroll heuristic change. Do not tune constants without a test that proves the user-visible failure mode.

**Patterns to follow:**
- Current `create-auto-scroll.test.ts` geometry tests.
- `ThreadFollowController` generation-counter pattern.
- Shared UI thinking/tool components for local timer rendering.

**Test scenarios:**
- Edge case: deliberate upward wheel event during rapid streaming detaches from follow within one RAF.
- Edge case: programmatic scroll settling does not incorrectly detach follow.
- Integration: thinking duration updates without re-rendering unrelated rows each second.
- Integration: real scene viewport path renders user, assistant, thinking, tool, and degraded rows in one mixed session.
- Regression: scroll-to-bottom public API still reveals the latest row in primary and fallback modes.

**Verification:**
- The viewport reliability suite covers the failure modes from the audit with real components where relevant.
- No timer or scroll change reintroduces unbounded work across the full transcript.

## System-Wide Impact

- **Interaction graph:** The affected path is `SessionStateGraph` -> `materializeAgentPanelSceneFromGraph` -> scene entries -> display rows -> viewport -> `AgentPanelConversationEntry`. The plan removes transcript-derived render fallbacks from this path.
- **Error propagation:** Missing canonical scene data becomes an explicit degraded scene row plus diagnostic log, not a silent transcript reconstruction.
- **State lifecycle risks:** Hydration/fallback RAFs, ResizeObserver callbacks, session switches, and scroll-follow RAFs must be generation- or session-bound so stale callbacks cannot mutate the new viewport.
- **API surface parity:** `AgentPanelConversationEntry` becomes the shared renderer for all row kinds in desktop and website/mock contexts. Any new row fields must remain presentational and app-agnostic.
- **Integration coverage:** Unit tests for logic are not enough; Svelte component tests must mount real row components for the crash-prone viewport paths.
- **Unchanged invariants:** Canonical graph/materializer remains authoritative. Native fallback remains bounded. `SessionEntry[]` may remain for non-render derivations but not viewport content authority.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Desktop assistant behavior inventory reveals missing scene fields | Unit 1 makes this explicit; Unit 3 cannot merge until gaps are scoped or resolved |
| Independent blank-state fix accidentally blesses split renderer | Unit 4 is limited to viewport mechanics and cannot add render authority |
| Unit 4 and Unit 5 conflict if developed in parallel | Prefer landing Unit 4 before Unit 5 or port Unit 4 tests first in the Unit 5 branch; treat Unit 4 edits as current-adapter stabilization, not the final adapter shape |
| Degraded/missing row is noisy in production | Use low-drama muted treatment, no retry action, and diagnostic log; materializer recovery or refresh clears it |
| Virtua itself cannot satisfy scroll reliability | Keep Virtua behind Unit 5 adapter boundary; replace only if tests prove the adapter cannot meet contracts |
| Tests stay too mocked to catch regressions | Units 2, 5, and 6 require real-component integration paths |
| Long-session fallback hides older history | Bounded fallback must show an explicit out-of-window placeholder rather than pretending older rows are loaded |
| Svelte check fixes sprawl into unrelated GOD migration | R5 limits fixes to files directly on the viewport/render path |

## Documentation / Operational Notes

- Update this plan if Unit 1 inventory changes sequencing or reveals required scene-model widening not captured here.
- If Unit 5 replaces `VirtualizedEntryList`, update any developer docs or comments that name it as the transcript viewport.
- If new diagnostics are added for missing scene entries or fallback transitions, use stable event names suitable for future debugging.
- No production rollout flag is required by default, but Unit 5 may introduce a local development diagnostic toggle if tests show fallback decisions need visibility during manual QA.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-01-agent-panel-content-reliability-rewrite-requirements.md](../brainstorms/2026-05-01-agent-panel-content-reliability-rewrite-requirements.md)
- `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte`
- `packages/desktop/src/lib/acp/components/agent-panel/logic/virtualized-entry-display.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/logic/create-auto-scroll.svelte.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/logic/thread-follow-controller.svelte.ts`
- `packages/desktop/src/lib/acp/session-state/agent-panel-graph-materializer.ts`
- `packages/ui/src/components/agent-panel/agent-panel-conversation-entry.svelte`
- `docs/plans/2026-05-01-002-refactor-agent-panel-single-render-path-plan.md`
- `docs/plans/2026-05-01-003-retire-toolcallrouter-plan.md`
- `docs/plans/2026-04-25-001-fix-agent-panel-virtualized-reveal-crash-plan.md`
- `docs/solutions/ui-bugs/agent-panel-graph-materialization-rendering-bug-2026-04-28.md`
