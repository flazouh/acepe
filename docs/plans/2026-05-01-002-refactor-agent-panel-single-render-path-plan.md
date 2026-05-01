---
title: "refactor: Single canonical render path for agent-panel entries"
type: refactor
status: completed
date: 2026-05-01
---

# refactor: Single canonical render path for agent-panel entries

## Overview

Today the Agent Panel renders conversation entries through **two coexisting tool-call render paths** chosen by a transient flag:

- **Canonical scene path** — `materializeAgentPanelSceneFromGraph` produces `AgentPanelSceneEntryModel[]`, fed into `VirtualizedEntryList` via the `sceneEntries` prop. Tool-call entries are rendered via the shared scene renderer (`AgentPanelConversationEntry` in `@acepe/ui`).
- **Legacy/optimistic tool-call path** — when `hasOptimisticPendingEntry` is `true`, `graphSceneEntries` is forced to `undefined`, which in `VirtualizedEntryList` flips `shouldRenderDesktopTool(...)` to `true` (via `shouldUseOptimisticDesktopToolRenderer` — its only signal is `sceneEntries === undefined`) and routes tool calls through the desktop-only `ToolCallRouter` instead of the shared scene renderer.
- A **third, parallel** optimistic UI exists in `agent-panel-content.svelte` for the "no `sessionId` yet" case, hand-rolled with `MessageWrapper` + `UserMessage` + a `LoadingIcon`/`TextShimmer` block.

> **Scope clarification.** Today, even on the canonical path, `VirtualizedEntryList` renders `user`/`assistant`/`assistant_merged`/`thinking` entries via desktop-local components (`UserMessage`, `AssistantMessage`, etc.), not via `AgentPanelConversationEntry`. Migrating those branches to the shared `@acepe/ui` renderer is a separate, significantly larger MVC migration and is **explicitly out of scope** for this plan. This plan eliminates only the **tool-call dual-path** triggered by `hasOptimisticPendingEntry` and the parallel **pre-session optimistic UI** in `agent-panel-content.svelte`. After this plan, tool-call entries route through one renderer, the optimistic pending entry lives in the scene model, and `ToolCallRouter` is no longer reachable from the live render tree.

This is the same family of problem documented in `docs/solutions/ui-bugs/agent-panel-composer-split-brain-canonical-actionability-2026-04-30.md`: a transient signal silently routing readers onto a parallel rendering path. It is **not** a strict GOD violation (entries are not in the canonical-overlap surface and `pendingUserEntry` is an explicitly-allowed transient affordance), but it violates the broader Acepe principle of "one canonical authority, no parallel paths."

The fix: fold the transient `pendingUserEntry` into `graphMaterializedScene.conversation.entries` inside the desktop scene mapper layer; `VirtualizedEntryList` no longer branches on `sceneEntries === undefined`; `ToolCallRouter` exits the render tree. The pre-session optimistic UI is replaced with the same `VirtualizedEntryList` driven by a scene built from the optimistic entry alone.

## Problem Frame

The dual-path was introduced as a pragmatic bridge during the GOD/canonical migration: when the user submits a message, the panel needs to show it immediately, but the canonical graph hasn't ingested it yet. Rather than teach the canonical-driven scene to understand the optimistic pending entry, the bridge inverts the rendering pipeline entirely for the optimistic window.

Concrete consequences:

1. **Two renderers of conversation entries** — `AgentPanelConversationEntry` (shared, presentational, mockable from `packages/website`) and `ToolCallRouter` (desktop-only, store-coupled). They drift in styling, capability, and bug surface.
2. **Routing logic is implicit** — `shouldUseOptimisticDesktopToolRenderer(entry, sceneEntries !== undefined)` returns `!hasCanonicalSceneEntries`. A reader who only sees `VirtualizedEntryList` cannot tell that the toggle is driven by a transient optimistic flag two components up.
3. **Pre-session optimistic UI is a third path** — `agent-panel-content.svelte`'s `{:else if sessionEntries.length > 0}` branch renders a hand-rolled user-message + thinking shimmer that bypasses both pipelines.
4. **Tests live in two worlds** — `tool-renderer-routing.vitest.ts`, `graph-scene-entry-match.test.ts`, and `desktop-agent-panel-scene.test.ts` collectively assert the dual path's behavior, locking it in.

The fix is upstream: extend the scene mapper to accept `pendingUserEntry` and emit a fully-formed `AgentPanelSceneEntryModel` for it. After that, every consumer reads from one model.

## Requirements Trace

- R1. The Agent Panel renders **tool-call** entries through exactly one path: the `AgentPanelConversationEntry` branch of `VirtualizedEntryList`, driven by `AgentPanelSceneEntryModel[]`. `ToolCallRouter` is removed from the live render tree. (User/assistant rendering routing is unchanged in this plan.)
- R2. Submitting a message produces an immediate optimistic user entry that is visually indistinguishable from a canonical user entry once promoted, with no remount/flash at promotion.
- R3. The pre-session ("no `sessionId` yet") case uses the same `VirtualizedEntryList` + scene-driven flow as the post-session case. The hand-rolled `MessageWrapper`+`UserMessage`+`LoadingIcon`+`TextShimmer` block in `agent-panel-content.svelte` is removed.
- R4. `pendingUserEntry` remains in `SessionTransientProjection` (still GOD-legal). For **render routing**, it is read only by the scene mapper; `VirtualizedEntryList` never branches on it. `agent-panel.svelte` may continue reading it for non-render derivations such as `isConnecting` and composer `canSend` gating.
- R5. `shouldUseOptimisticDesktopToolRenderer`, `shouldRenderDesktopTool`, and the `sceneEntries`-vs-`entries` dual-prop pair are deleted, not just neutralized.
- R6. The pre-session "Planning next moves" thinking indicator continues to render during the window between user submit and `sessionId` establishment. This is **load-bearing UX** and must not be silently dropped.
- R7. Existing scene-mapper, virtualized-list, and content-component tests remain green or are updated to assert the unified behavior; no test asserts dual-path tool-call semantics after this plan.
- R8. No regression in the long-session performance contracts established by `docs/plans/2026-04-29-001-fix-long-session-performance-contracts-plan.md` (the merge-and-virtualize pipeline still drives `VList`).

## Scope Boundaries

- **In scope:** desktop scene mapper (graph materializer), agent-panel controller, `agent-panel-content.svelte`, `VirtualizedEntryList` (tool-call render branch + dual-prop simplification), the two routing logic helpers, the pre-session thinking indicator signal, related unit tests, and any `@acepe/ui` scene-model widening required to mark an entry as optimistic.
- **Not in scope (explicit non-goals):**
  - GOD canonical widening — `pendingUserEntry` is not promoted to canonical.
  - Rust changes — the Rust envelope contract is unchanged.
  - **Migrating `user`/`assistant`/`assistant_merged`/`thinking` render branches in `VirtualizedEntryList` from desktop-local `UserMessage`/`AssistantMessage` to `@acepe/ui`'s `AgentPanelConversationEntry`.** That is a separate MVC migration of significantly larger scope and risk; track as a follow-up plan. This plan deletes only the tool-call dual-render fork.
  - `ToolCallRouter` deletion — it is removed from the live render tree but kept in the codebase if other consumers exist (audited in Unit 4). Confirmed live consumer today: `virtual-session-list.svelte`.
  - Composer/footer optimistic state (`pendingSendIntent`) — separate concern, separate transient field.
  - The `AgentPanelStatePanel` "loading"/"ready"/"error" branches in `agent-panel-content.svelte` — they are scene-driven already.

## Context & Research

### Relevant Code and Patterns

- **Dual-path origin (the surface to remove):**
  - `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte` — defines `hasOptimisticPendingEntry` (line 361), `graphMaterializedScene` (lines 680–698), `graphSceneEntries` (lines 699–701), passes both `sessionEntries` and `sceneEntries` down (line 1945–1946).
  - `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-content.svelte` — passes both props through to `VirtualizedEntryList` (lines 193–206) and contains the third hand-rolled optimistic branch (lines 207–223).
  - `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte` — `getGraphSceneEntry` (line 302), `shouldRenderDesktopTool` (line 308), the `ToolCallRouter` vs `AgentPanelConversationEntry` switch (lines 797–800).
  - `packages/desktop/src/lib/acp/components/agent-panel/logic/tool-renderer-routing.ts` — the helper to delete.
  - `packages/desktop/src/lib/acp/components/agent-panel/logic/graph-scene-entry-match.ts` — index/match helper used by the dual path; will become unconditional after the unification.

- **Scene mapper (the upstream widening site):**
  - `packages/desktop/src/lib/acp/session-state/agent-panel-graph-materializer.ts` — `materializeAgentPanelSceneFromGraph` (line 466), `materializeConversation` (~line 460), `AgentPanelGraphMaterializerInput` (line 48). Add an optional `optimistic: { pendingUserEntry: SessionEntry | null }` input and append it to `conversation.entries` when present.
  - `packages/desktop/src/lib/acp/components/agent-panel/scene/desktop-agent-panel-scene.ts` — `mapSessionEntryToConversationEntry`, `mapVirtualizedDisplayEntryToConversationEntry`. Reuse the user-entry mapper for the pending entry; a single boolean (`isOptimistic`) on `AgentPanelSceneEntryModel` is enough to drive any visual differentiation (e.g. faint opacity).

- **Transient store:**
  - `packages/desktop/src/lib/acp/store/types.ts` — `pendingUserEntry: _SessionEntry | null` stays on `SessionTransientProjection` (allowed by GOD as a transient affordance).
  - `packages/desktop/src/lib/acp/store/panel-store.svelte.ts` — sets/clears `pendingUserEntry`. No changes here.

- **Pre-session optimistic UI to fold in:**
  - `agent-panel-content.svelte` lines 207–223 — replace with a scene-driven branch when the scene mapper supplies the optimistic entry even without `sessionId`. Requires the scene to be materializable from a partial input (no graph, only the optimistic entry + header).

### Institutional Learnings

- `docs/solutions/ui-bugs/agent-panel-composer-split-brain-canonical-actionability-2026-04-30.md` — reinforces "no parallel reader paths" even when the second path *feels* like just a transient bridge. The fix pattern (widen upstream, delete the fallback) applies here at the render layer.
- `docs/plans/2026-04-28-003-refactor-graph-scene-materialization-plan.md` — the canonical scene-materialization refactor that introduced `materializeAgentPanelSceneFromGraph`. This plan is its logical completion: one materializer, one consumer.
- `docs/plans/2026-04-29-001-fix-long-session-performance-contracts-plan.md` — locks in the `VList` virtualization contract on `displayEntries`. Any change must keep `mergedEntries`/`displayEntries` driving `VList` and must not regress per-row hot-path work.

### External References

None — this is a local refactor against well-understood internal seams.

## Key Technical Decisions

- **Fold optimistic entry into the scene at the materializer boundary, not at the controller.** Reason: the scene model is the single contract. If we synthesize at the controller and merge in the controller, every downstream test still has to know the dual shape exists. Materializer-side merging means downstream consumers see one shape.
- **Add `optimistic: { pendingUserEntry: SessionEntry } | null` to `AgentPanelGraphMaterializerInput`** rather than splicing inside `materializeConversation`. Keeps the materializer pure: input → output. The controller passes `pendingUserEntry` in via the existing `materializeAgentPanelSceneFromGraph(...)` call site. (Inline shape — no named type.)
- **Single materializer, optional graph.** `materializeAgentPanelSceneFromGraph` accepts a `graph: SessionStateGraph | null`. When `graph === null`, lifecycle/status default to a pre-session shape and `conversation.entries` contains only the optimistic entry (if present) or is empty. **No sibling `materializeAgentPanelSceneFromOptimistic` builder.** Rationale: the prior plan draft proposed a sibling builder to avoid `if (graph)` complexity, but the call-site conditional shifts the same complexity outward and creates a permanent two-path drift risk at the model layer (flagged by adversarial + product-lens reviewers). A single null-guard in the conversation/lifecycle helpers is narrower than maintaining two builders forever.
- **Dedup by `clearPendingUserEntry` ordering, not by id.** Optimistic and canonical entry ids are independent UUIDs (optimistic: `crypto.randomUUID()` in `pending-user-entry.ts`; canonical: `crypto.randomUUID()` in `session-messaging-service.ts`). They never collide, so id-based dedup is a no-op. The contract is: `panel-store.svelte.ts` clears `pendingUserEntry` no later than the canonical entry being ingested into the graph. The materializer trusts this contract (does not attempt content-based dedup). A regression test in Unit 6 asserts `clearPendingUserEntry` is called by the relevant send path before the canonical entry can land.
- **Visual marker for optimistic entries: a single boolean on the scene-entry model.** Because `AgentPanelSceneEntryModel` is a discriminated union (`AgentUserEntry | AgentAssistantEntry | AgentToolEntry | AgentThinkingEntry`), add `isOptimistic?: boolean` **only to `AgentUserEntry`** (the only entry kind we synthesize optimistically). This avoids polluting other variants and avoids the type-assignment fragility of an intersection wrapper. Renderers that care about the flag pattern-match on `entry.type === "user"`.
- **Pre-session thinking indicator signal: explicit prop override, surfaced from the controller.** `agent-panel-content.svelte`'s `isWaitingForResponse` is structurally `false` when `!sessionId` (its `sessionWorkProjection` returns null without a session). The plan therefore does not rely on the canonical activity channel for the pre-session window. Instead, `agent-panel.svelte` passes an explicit `isWaitingForResponse` prop override when `panelHotState?.pendingUserEntry !== null`. This keeps the indicator load-bearing during the most user-anxious window without re-introducing a hand-rolled shimmer.
- **Adapt the merging pipeline (`buildVirtualizedDisplayEntries`, `findLastAssistantIndex`, `lastAssistantId`, `activeRootToolCallId`) to operate on `AgentPanelSceneEntryModel[]`.** Today these helpers consume `SessionEntry[]`. They are replaced by scene-native equivalents (`buildVirtualizedDisplayEntriesFromScene`, `findLastAssistantSceneIndex`) that read from the scene model. This is a non-trivial sub-task and is given its own implementation unit (Unit 3a) so the perf contract from `2026-04-29-001` can be verified independently. Without this, removing the `entries: SessionEntry[]` prop would not type-check.
- **Delete `tool-renderer-routing.ts`, `shouldUseOptimisticDesktopToolRenderer`, `shouldRenderDesktopTool`, and the `ToolCallRouter` branch in `VirtualizedEntryList`** rather than gating them. The fallback shape is precisely what GOD warns against.
- **Keep `ToolCallRouter` itself** in the codebase. Confirmed live consumer: `virtual-session-list.svelte`. Unit 4 only removes its import from `VirtualizedEntryList`. The audit also confirms whether any agent- or provider-specific dispatch logic lives inside `ToolCallRouter` (product-lens concern); if so, the agent-agnostic dispatch home is the scene-mapper layer (per `agent-adapters/`), not the renderer.
- **Do not change the GOD canonical surface.** `pendingUserEntry` stays transient. This refactor is render-layer only.

## Open Questions

### Resolved During Planning

- **Q: Is the optimistic flag needed on the scene model?** A: Yes — the renderer benefits from a stylistic cue (faint opacity / "sending…" indicator). One boolean field (`isOptimistic?: boolean`) on `AgentUserEntry` only is sufficient.
- **Q: Should we also synthesize an optimistic "thinking" indicator in the scene?** A: No. The thinking indicator is driven by a controller-level `isWaitingForResponse` signal, which the controller will explicitly set to `true` when `pendingUserEntry !== null`, regardless of `sessionId`. (See Key Technical Decisions — adversarial review confirmed `sessionWorkProjection` is null pre-session, so the indicator must be driven via prop override, not the canonical activity channel.)
- **Q: Does `VList` need a flush/key change when an optimistic entry arrives?** A: The materializer change preserves entry identity (`pendingUserEntry.id` is stable from `panel-store`), so `mergedEntries` keying is unaffected. **Caveat:** the pre-session → post-session transition currently triggers a remount via `{#key sessionId}` in the existing render. R2's "no remount/flash at promotion" applies to the entry-id continuity once `sessionId` exists; the `sessionId` boundary itself is a separate concern handled by Unit 5's verification.
- **Q: Sibling materializer vs optional graph?** A: Optional graph (single materializer). The sibling-builder approach was rejected because the call-site conditional and the structural drift risk outweigh the in-function `if (graph)` cost.
- **Q: Dedup mechanism between optimistic and canonical entries?** A: Trust the existing `clearPendingUserEntry` ordering contract — ids are independent UUIDs and never collide, so id-based dedup is impossible. A regression test asserts the contract.

### Deferred to Implementation

- **Q: Are there agent- or provider-specific dispatch behaviors inside `ToolCallRouter` that need a new home before its removal from the render path?** Resolve at Unit 4 by reading `ToolCallRouter.svelte` and tracing its branches. If yes, the dispatch logic moves to the scene-mapper layer (per the agent-adapter architecture) before this plan completes.
- **Q: Does `VirtualizedEntryList.sessionId` need to widen to `string | null`?** Likely yes, since the pre-session path will now drive the same component. Resolve at Unit 5 by enumerating uses of `sessionId` in the component (telemetry keys, autoscroll cache, etc.).
- **Q: Are there focus-management or autoscroll behaviors in the hand-rolled pre-session branch (`agent-panel-content.svelte:207–223`) that `VirtualizedEntryList` does not cover?** Resolve at Unit 5 by manually exercising the flow.
- **Q: Does the `clearPendingUserEntry` contract hold across all send paths (normal send, retry, slash-command, voice)?** Resolve at Unit 6 with a focused test that covers each entry path.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Before (dual path for tool calls):**

```
agent-panel.svelte
  ├─ graphMaterializedScene = materializeAgentPanelSceneFromGraph({ graph, header })
  ├─ hasOptimisticPendingEntry = panelHotState.pendingUserEntry != null
  └─ graphSceneEntries = hasOptimisticPendingEntry ? undefined : scene.conversation.entries
        │
        ▼
   AgentPanelContent
        │ (forwards both `sessionEntries` and `sceneEntries`)
        ├─ if !sessionId && sessionEntries.length > 0  → hand-rolled UserMessage + shimmer
        ▼
   VirtualizedEntryList
        ├─ shouldRenderDesktopTool(entry) := !sceneEntries && entry.type === "tool_call"
        │  ├─ if true  → ToolCallRouter (desktop-only)
        │  └─ if false → AgentPanelConversationEntry (shared @acepe/ui)
        └─ user/assistant/assistant_merged → UserMessage / AssistantMessage (desktop) [unchanged]
```

**After (single tool-call render path + scene-driven pre-session):**

```
agent-panel.svelte
  └─ scene = materializeAgentPanelSceneFromGraph({
       graph: sessionStateGraph,                                   // may be null pre-session
       header,
       optimistic: panelHotState?.pendingUserEntry
                   ? { pendingUserEntry: panelHotState.pendingUserEntry } : null
     })
  └─ isWaitingForResponse override = panelHotState?.pendingUserEntry !== null
        │
        ▼
   AgentPanelContent
        │ (single `sceneEntries` prop; pre-session branch deleted)
        ▼
   VirtualizedEntryList  (sessionId: string | null)
        ├─ tool-call → AgentPanelConversationEntry  ← only renderer for tool calls
        └─ user/assistant/assistant_merged → UserMessage / AssistantMessage [unchanged in this plan]
```

`ToolCallRouter` and the optimistic-routing helpers exit the live render tree. The hand-rolled pre-session UI is gone. `user`/`assistant` rendering is intentionally untouched (separate follow-up plan).

## Implementation Units

- [ ] **Unit 1: Widen `AgentUserEntry` and the materializer to accept an optional optimistic pending entry**

**Goal:** Add `isOptimistic?: boolean` to `AgentUserEntry` (only). Teach `materializeAgentPanelSceneFromGraph` to (a) accept `graph: SessionStateGraph | null`, (b) accept an `optimistic` input, and (c) splice the optimistic user entry into `conversation.entries` (relying on the `clearPendingUserEntry` ordering contract, no id-based dedup).

**Requirements:** R2, R3, R4

**Dependencies:** None.

**Files:**
- Modify: `packages/desktop/src/lib/acp/session-state/agent-panel-graph-materializer.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/scene/desktop-agent-panel-scene.ts`
- Modify: `packages/ui/src/components/agent-panel/types.ts` — add `isOptimistic?: boolean` to the `AgentUserEntry` interface only. Other variants in the `AnyAgentEntry` union are unchanged.
- Test: `packages/desktop/src/lib/acp/session-state/__tests__/agent-panel-graph-materializer.test.ts`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/scene/desktop-agent-panel-scene.test.ts`

**Approach:**
- Widen `AgentPanelGraphMaterializerInput`: change `graph: SessionStateGraph` to `graph: SessionStateGraph | null` and add `readonly optimistic?: { pendingUserEntry: SessionEntry } | null`.
- Inside the function, when `graph === null`, return a scene with: status from a pre-session default (lifecycle = "loading" or equivalent existing state), `conversation.entries = []` plus the optimistic entry if present, `isStreaming: false`. Reuse `materializeLifecycle`-style helpers behind a small null-guard rather than duplicating logic.
- When `graph !== null`, materialize as today via `materializeConversation(graph)`, then if `input.optimistic?.pendingUserEntry` is non-null, append a mapped scene entry built via `mapSessionEntryToConversationEntry` and stamped `isOptimistic: true`. **No id-collision check** — rely on the `clearPendingUserEntry` ordering contract (Unit 6 asserts the contract).
- Update `mapSessionEntryToConversationEntry` to thread the `isOptimistic` flag through for `user`-type entries.

**Patterns to follow:**
- Existing `materializeConversation` shape — keep it pure, return readonly arrays.
- Existing `mapSessionEntryToConversationEntry` for entry → scene conversion.
- The `agent-panel-composer-split-brain` solution doc's "widen upstream, delete the fallback" pattern.

**Test scenarios:**
- Happy path: graph with N user/assistant entries + `optimistic.pendingUserEntry` → output has N + 1 entries, last entry is the optimistic one with `isOptimistic === true`.
- Happy path: graph present, `optimistic` omitted → identical output to today (regression guard against the existing test corpus).
- Edge case: `graph === null` and `optimistic.pendingUserEntry` provided → scene has exactly one conversation entry (the optimistic one), header populated, status is the pre-session default, `isStreaming: false`.
- Edge case: `graph === null` and no optimistic entry → scene has empty `conversation.entries`, header populated, status is the pre-session default. (No crash on the empty-everything case.)
- Integration: scene round-trips through `mapSessionEntryToConversationEntry` so existing message-shape assertions hold.

**Verification:**
- New + existing materializer/scene tests pass.
- `AgentPanelGraphMaterializerInput.graph` is `SessionStateGraph | null`. `AgentUserEntry` has `isOptimistic?: boolean`. Other `AnyAgentEntry` variants are unchanged.
- No `any`/`unknown` introduced; no `try/catch`; no spread.

---

- [ ] **Unit 2: Wire the controller to feed `pendingUserEntry` and emit a single `sceneEntries` prop**

**Goal:** `agent-panel.svelte` always builds the scene via the now-null-tolerant `materializeAgentPanelSceneFromGraph`. Delete the `hasOptimisticPendingEntry ? undefined : ...` ternary on `graphSceneEntries`. Pass an explicit `isWaitingForResponse` override to `AgentPanelContent` when an optimistic entry exists.

**Requirements:** R1, R3, R4, R6

**Dependencies:** Unit 1.

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-content.svelte`

**Approach:**
- Replace the dual-path derivation with a single derivation that always calls the materializer with `graph: sessionStateGraph` (which may be `null`) and `optimistic: panelHotState?.pendingUserEntry ? { pendingUserEntry: panelHotState.pendingUserEntry } : null`.
- `graphSceneEntries` becomes `graphMaterializedScene?.conversation.entries ?? []` — never `undefined`.
- Continue reading `panelHotState.pendingUserEntry` for `isConnecting` and composer `canSend` gating (R4 narrowed scope). These reads stay in `agent-panel.svelte`.
- Pass an `isWaitingForResponse` prop override to `AgentPanelContent` when `panelHotState?.pendingUserEntry !== null`. This satisfies R6 by ensuring the thinking indicator is driven by the controller in the pre-session window without depending on the canonical activity channel (which is structurally null without a session).
- Remove the `sessionEntries` (or equivalent legacy) prop from `AgentPanelContent`'s `Props`; pass only `sceneEntries`.

**Patterns to follow:**
- Existing `$derived.by` patterns in `agent-panel.svelte`.
- Single-prop scene flow already used by `AgentPanelScene` shell.

**Test scenarios:**
- Test expectation: behavioral coverage handled by Units 3/3a (virtualized list) + Unit 5 (content). For this unit, ensure `bun run check` passes and no consumer reads the legacy entries prop on `AgentPanelContent`.

**Verification:**
- `rg "sessionEntries" packages/desktop/src/lib/acp/components/agent-panel` returns no matches in render-routing code (only legitimate non-render uses such as `entriesCount`).
- `bun run check` passes.

---

- [ ] **Unit 3a: Adapt the merging pipeline to operate on `AgentPanelSceneEntryModel[]`**

**Goal:** Replace the `SessionEntry[]`-typed merging helpers with scene-native equivalents so `VirtualizedEntryList` can drop the `entries: SessionEntry[]` prop in Unit 3 without breaking. This unit is split out from Unit 3 because the perf contract from `2026-04-29-001` must be verified independently.

**Requirements:** R1, R5, R8

**Dependencies:** Unit 2.

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/virtualized-entry-display.ts` — add scene-native `buildVirtualizedDisplayEntriesFromScene(sceneEntries: readonly AgentPanelSceneEntryModel[]): VirtualizedDisplayEntry[]`. Either replace the existing `SessionEntry`-typed function or keep it for tests until callers migrate.
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte` — switch internal helpers to scene-native shape:
  - `findLastAssistantIndex` → `findLastAssistantSceneIndex` operating on scene entries (`entry.type === "assistant"`).
  - `lastAssistantId` tracking — read scene-entry id field (no `entry.timestamp` field; if a fallback timestamp is needed, derive from `mergedEntries` instead of raw scene entries, or remove the fallback if unused).
  - `activeRootToolCallId` — the current implementation reads `lastEntry.message.status` from a `SessionEntry` `tool_call`. Replace with a scene-native read from `AgentToolEntry` (its `status` and id surface).
- Test: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/virtualized-entry-display.test.ts` (extend or replace).

**Approach:**
- Implement `buildVirtualizedDisplayEntriesFromScene` to produce the same `VirtualizedDisplayEntry` shape (preserving `MergedAssistantDisplayEntry`, `ThinkingEntry`, etc.) so `VList` keying and the streaming-indicator state machine continue to work without any per-row hot-path additions.
- Update `findLastAssistantSceneIndex` to walk the scene entries from the end and match `entry.type === "assistant"` (or `"assistant_merged"` if that is a scene-native variant; if not, the merging helper produces `MergedAssistantDisplayEntry` from raw assistant entries — confirm in implementation).
- For `activeRootToolCallId`, replace the `SessionEntry.message` read with the corresponding `AgentToolEntry` field; preserve the same downstream semantics.
- Verify `mergedEntries.length` and per-row update cost remain unchanged — same length, same key structure.

**Patterns to follow:**
- Existing `buildVirtualizedDisplayEntries` — keep the same return shape so the rest of `VirtualizedEntryList` is unchanged.
- Existing scene-mapper functions in `desktop-agent-panel-scene.ts` for the `SessionEntry → AgentPanelSceneEntryModel` mapping (already established).

**Test scenarios:**
- Happy path: scene with mixed user/assistant/tool-call entries → produces the same `VirtualizedDisplayEntry[]` shape as the legacy `SessionEntry[]`-driven build (assertion: entry count, kinds, ids, merged-assistant grouping).
- Happy path: scene with consecutive assistant entries → `MergedAssistantDisplayEntry` is produced exactly as before.
- Edge case: scene containing only the optimistic user entry → produces a single user `VirtualizedDisplayEntry` with the `isOptimistic` flag intact (or reachable via the entry, depending on the chosen flag-passing strategy).
- Edge case: empty scene → empty display entries, no crash.
- Performance: per-entry cost of `buildVirtualizedDisplayEntriesFromScene` is `O(n)` with no extra allocations vs the legacy version (verify by reading the implementation, not micro-bench).

**Verification:**
- `bun test` passes on the migrated and any retained legacy tests.
- `bun run check` passes.
- No `any`/`unknown`, no try/catch, no spread.

---

- [ ] **Unit 3: Collapse `VirtualizedEntryList` to a single tool-call renderer**

**Goal:** Remove `ToolCallRouter` from the render switch, delete `shouldRenderDesktopTool`, drop the `entries: SessionEntry[]` prop, drive everything from `sceneEntries` (via Unit 3a's helpers). The `user`/`assistant`/`assistant_merged` branches that route to desktop `UserMessage`/`AssistantMessage` are **intentionally unchanged** (out of scope per Scope Boundaries).

**Requirements:** R1, R5, R8

**Dependencies:** Unit 3a (and transitively Units 1–2).

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte`
- Delete: `packages/desktop/src/lib/acp/components/agent-panel/logic/tool-renderer-routing.ts`
- Delete: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/tool-renderer-routing.vitest.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/graph-scene-entry-match.ts` — `getGraphSceneEntry` now treats a missing scene entry for a renderable display entry as an unexpected state (existing `reportMissingVirtualizedEntry` call remains).
- Test: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/graph-scene-entry-match.test.ts` — drop assertions that depended on `sceneEntries === undefined`.

**Approach:**
- Delete `shouldRenderDesktopTool`, `shouldUseOptimisticDesktopToolRenderer`, the `ToolCallRouter` import, and the `{:else if shouldRenderDesktopTool(entry)}` branch in the render block.
- The remaining tool-call render path is the existing `{:else if entry.type === "tool_call"}` (or equivalent) that routes to `AgentPanelConversationEntry`.
- Remove the `entries: readonly SessionEntry[]` prop from the component's `Props`. All internal state (mergedEntries, lastAssistantId, activeRootToolCallId) is now scene-derived via Unit 3a.
- `getGraphSceneEntry`: if a display entry has no matching scene entry, log via `reportMissingVirtualizedEntry` and skip render. Do not fork.

**Patterns to follow:**
- The existing `MessageWrapper` block stays unchanged; only the inner `{#if}/{:else}` simplifies.
- Existing telemetry / autoscroll callbacks unchanged.

**Test scenarios:**
- Happy path: scene with a tool-call entry → rendered via `AgentPanelConversationEntry`. No `ToolCallRouter` instantiated.
- Happy path: scene with one optimistic user entry → rendered via the existing user branch (desktop `UserMessage`), with the `isOptimistic` flag available for visual cue.
- Edge case: empty scene entries → renders empty state without crash.
- Edge case: scene entry id present in `displayEntries` but missing from the scene index → `reportMissingVirtualizedEntry` invoked, no fallback render path.
- Regression: `user`, `assistant`, `assistant_merged`, and `thinking` rendering are visually identical to today (no scope migration).

**Verification:**
- `rg "ToolCallRouter" packages/desktop/src/lib/acp/components/agent-panel` returns no matches inside the agent-panel render path (the `virtual-session-list.svelte` consumer is outside this directory and unaffected).
- `tool-renderer-routing.*` files are deleted.
- `bun test` and `bun run check` pass.

---

- [ ] **Unit 4: Audit `ToolCallRouter` agent-specificity and prune the agent-panel reachability**

**Goal:** Confirm `ToolCallRouter` has the expected non-agent-panel consumer (`virtual-session-list.svelte`) and confirm whether it contains any agent- or provider-specific dispatch logic that needs to migrate before its render-path removal is final.

**Requirements:** R5

**Dependencies:** Unit 3.

**Files:**
- Inspect: `packages/desktop/src/lib/acp/components/tool-calls/`
- Inspect: `packages/desktop/src/lib/acp/components/agent-panel/components/virtual-session-list.svelte`

**Approach:**
- `rg -n "ToolCallRouter|from \\\".*tool-calls\\\"" packages/desktop/src` to enumerate consumers.
- Read `ToolCallRouter.svelte`'s render branches. If branches dispatch by agent type or provider (e.g., different rendering for Claude vs Gemini tool calls), document the dispatch surface and propose its new home — the scene-mapper layer (`agent-adapters/`) is the natural location, not the renderer. Add a follow-up implementation note if non-trivial migration is needed.
- If `ToolCallRouter` is purely a thin store-coupled wrapper with no agent-specific logic, document that explicitly and leave the file in place for the remaining `virtual-session-list.svelte` consumer.

**Test scenarios:**
- Test expectation: none — pure audit + cleanup. `bun run check` and the existing test suite are the regression guard.

**Verification:**
- No dead imports of `ToolCallRouter` in `agent-panel/`.
- `bun run check`, `bun test`, and `cargo clippy` (no Rust changes expected) all pass.
- Audit conclusion documented inline in the PR description (or as a comment in the file if that is the team norm).

---

- [ ] **Unit 5: Replace the pre-session hand-rolled optimistic UI with the unified scene-driven path**

**Goal:** Remove the `{:else if sessionEntries.length > 0}` block in `agent-panel-content.svelte`. When `sessionId === null` and a `pendingUserEntry` exists, the same `VirtualizedEntryList` renders the scene-folded optimistic entry, and the controller-supplied `isWaitingForResponse` override drives the thinking indicator.

**Requirements:** R1, R3, R6

**Dependencies:** Units 1, 2, 3a, 3.

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-content.svelte`
- Modify (likely): `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte` — widen `sessionId` prop to `string | null`. Audit internal uses (telemetry keys, autoscroll cache, the existing `{#key sessionId}` block) for null safety.

**Approach:**
- Drop the `if (sessionId)` / `else if (sessionEntries.length > 0)` fork. Render the conversation branch whenever `sceneEntries` is non-empty, regardless of `sessionId`. The "loading"/"ready"/"error" placeholder branches remain unchanged.
- Widen `VirtualizedEntryList.sessionId` to `string | null`. For each internal use:
  - Telemetry/keying: gate with `if (sessionId)` or use a stable fallback string.
  - `{#key sessionId}` block: this currently triggers a remount on session establishment. If keeping it, accept the remount at the `null → string` boundary as expected behavior (R2's continuity applies *within* a session, not across the `null → string` transition). If a smoother transition is desired, this is a follow-up.
- The thinking indicator's `isWaitingForResponse` is now controller-driven (Unit 2); confirm the indicator visibly fires with `sessionId === null` and `pendingUserEntry !== null`.
- Audit and preserve any focus/autoscroll behavior the hand-rolled branch had that is not yet covered by `VirtualizedEntryList`.

**Patterns to follow:**
- Existing `{:else if viewState.kind === "conversation"}` branch in `agent-panel-content.svelte`.

**Test scenarios:**
- Happy path: `sessionId === null`, `pendingUserEntry` present → user message renders via the existing user branch in `VirtualizedEntryList`, thinking indicator visible (controller override).
- Happy path: once the canonical session graph arrives and absorbs the entry, the optimistic flag flips off; entry id continuity preserved within the post-session window.
- Edge case: `sessionId === null` and no `pendingUserEntry` → existing "ready" placeholder renders unchanged.
- Edge case: `pendingUserEntry` is set then cleared without a canonical entry arriving (e.g., aborted send) → list goes back to empty without crash.
- Manual smoke: send a message in a fresh panel; confirm visual continuity and that the thinking indicator does not flash off-then-on at the `null → string` boundary.

**Verification:**
- `agent-panel-content.svelte` no longer contains the `MessageWrapper` + `UserMessage` + `LoadingIcon` block in the pre-session branch.
- `VirtualizedEntryList.sessionId` accepts `string | null` and all internal uses are null-safe.
- Manual flow exercise confirms R6 (thinking indicator visible during pre-session window).

---

- [ ] **Unit 6: Lock the unified contract in tests + assert the `clearPendingUserEntry` ordering invariant**

**Goal:** Lock the new contract in the test suite, assert that `clearPendingUserEntry` is called by all send paths before a canonical user entry can land (the dedup-by-ordering invariant the materializer trusts), and capture the learning.

**Requirements:** R7

**Dependencies:** Units 1–5.

**Files:**
- Modify: `packages/desktop/src/lib/acp/session-state/__tests__/agent-panel-graph-materializer.test.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/graph-scene-entry-match.test.ts`
- Add or extend: a test that exercises the full send → optimistic-set → canonical-arrive → optimistic-cleared sequence and asserts no duplicate user entry appears in the materialized scene at any step. Likely target: `packages/desktop/src/lib/acp/store/__tests__/` or a new integration-style scene test.
- Create (conditional): `docs/solutions/architectural/agent-panel-single-render-path-2026-05-01.md` if execution surfaces a meaningful learning.

**Approach:**
- Add a focused materializer test: given `pendingUserEntry`, the scene contains an `isOptimistic === true` `AgentUserEntry` as the last conversation entry; given a graph that already contains a user entry with id `X` and an optimistic entry with id `Y` (independent UUIDs), both appear (this is the expected behavior — clearance is what prevents duplicates, not id matching). Document this in the test name and comment.
- Add an ordering invariant test: simulate the send flow and assert `clearPendingUserEntry` is invoked before or atomically with the canonical user entry being ingested. Cover normal send, retry, slash-command, and voice paths.
- Update `graph-scene-entry-match.test.ts` to drop any assertions that depended on `sceneEntries === undefined` semantics.
- Run `bun run check`, `bun test`, and a smoke build.

**Test scenarios:**
- Happy path: ordering — optimistic entry is appended after canonical entries, never inserted mid-list.
- Happy path: empty graph + optimistic entry — single-entry scene.
- Invariant: across all send paths, `clearPendingUserEntry` fires before/with the canonical user entry being ingested. (If any path violates the invariant, fix the path, not the materializer.)
- Regression: existing tests for `mapSessionEntryToConversationEntry` and `materializeConversation` continue to pass without modification.

**Verification:**
- `bun test` (desktop) green.
- `bun run check` (desktop) green.
- Optional: take a tauri-driver screenshot of the pre-session optimistic render to attach to the PR.

## System-Wide Impact

- **Interaction graph:** `panel-store.svelte.ts` writes `pendingUserEntry`; only the materializer reads it for render. The agent-input send flow continues to set/clear it.
- **Error propagation:** unchanged — error/loading branches in `agent-panel-content.svelte` are scene-driven already.
- **State lifecycle risks:** the optimistic-to-canonical transition must preserve entry identity so `VList` does not remount. Dedup logic in Unit 1 handles id collisions.
- **API surface parity:** `AgentPanelSceneEntryModel` gains an optional `isOptimistic` boolean — additive, safe for `packages/website` mock data.
- **Integration coverage:** the scene mapper tests + virtualized-entry-list tests jointly cover the unified path. No additional integration harness needed.
- **Unchanged invariants:** `pendingUserEntry` stays on `SessionTransientProjection` (GOD-legal). Canonical projection contract is unchanged. Rust envelope contract is unchanged. The `VList` virtualization contract from `2026-04-29-001` is preserved.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Removing `entries: SessionEntry[]` from `VirtualizedEntryList` breaks the merging pipeline (`buildVirtualizedDisplayEntries`, `findLastAssistantIndex`, `lastAssistantId`, `activeRootToolCallId`). | Unit 3a is a dedicated implementation unit that replaces these helpers with scene-native equivalents before Unit 3 deletes the prop. Type-check and unit tests gate the cutover. |
| `clearPendingUserEntry` ordering invariant fails on a code path (e.g., retry, slash-command, voice), producing a duplicate user entry in the materialized scene. | Unit 6 adds an explicit invariant test covering all send paths. The materializer trusts the invariant; if a path violates it, the path is fixed (not the materializer). |
| `materializeAgentPanelSceneFromGraph` becomes a tangle of `if (graph)` branches. | Single-materializer decision narrows the conditional to the conversation/lifecycle helpers behind a small null-guard. The alternative (sibling builder) was rejected for structural drift. |
| Pre-session "Planning next moves" indicator stops firing after the hand-rolled branch is removed. | Unit 2 explicitly passes `isWaitingForResponse: true` to `AgentPanelContent` when `pendingUserEntry !== null`, controller-driven. Unit 5 verifies visibly. R6 names this load-bearing UX. |
| `isOptimistic` flag on `AgentUserEntry` is read by an unaware consumer (mock data, copy-to-clipboard, message-id ref) before clearance. | The flag is optional and additive; consumers that don't read it are unaffected. Mock data in `packages/website` continues to omit the flag (treated as `false`). |
| Optimistic entry id and canonical entry id are independent UUIDs, so id-based dedup is impossible. | Acknowledged in Key Technical Decisions. Dedup is delegated to `clearPendingUserEntry` ordering; Unit 6 asserts the invariant; the materializer no longer attempts id-collision dedup. |
| `VirtualizedEntryList`'s `{#key sessionId}` block remounts at the `null → string` boundary, causing a visual flash at session establishment. | R2's continuity is scoped to within-a-session entry id stability. The `null → string` remount is acknowledged and accepted; smoothing it is a follow-up if user-visible. |
| `ToolCallRouter` contains agent-specific dispatch logic that gets stranded when removed from the agent-panel render path. | Unit 4 audits `ToolCallRouter` content (not just consumers). If agent-specific dispatch exists, it migrates to the scene-mapper / agent-adapter layer before Unit 3 ships. |
| Sibling-or-not decision regresses later. | Architectural test in Unit 6 (or the materializer test file) asserts `materializeAgentPanelSceneFromGraph({ graph: null, ... })` produces a structurally complete scene; future drift is detected. |
| Pre-session `VirtualizedEntryList.sessionId === null` breaks an internal use (telemetry, autoscroll cache). | Unit 5 audits all internal uses and gates on `sessionId !== null` or uses a stable fallback. `bun run check` proves type safety. |

## Documentation / Operational Notes

- After Unit 6, consider adding a one-paragraph note to `docs/solutions/architectural/` documenting the "scene-as-single-render-source" pattern for future Agent Panel work.
- No rollout, monitoring, or migration concerns — this is a pure render-layer refactor with no persisted state changes.

## Sequencing Rationale

This is the third render-layer plan in four days (`2026-04-28-003` introduced `materializeAgentPanelSceneFromGraph`; `2026-04-29-001` locked in the long-session perf contract; this plan removes the last dual-path inside `VirtualizedEntryList`). The work compounds rather than churns:

- It directly **closes a known render-routing surface** that has produced the same family of bug as the documented composer split-brain (`agent-panel-composer-split-brain-canonical-actionability-2026-04-30.md`). Leaving `shouldUseOptimisticDesktopToolRenderer` in place keeps a parallel render path that any future change to tool-call rendering must reason about.
- It **unblocks the larger MVC migration** (out-of-scope user/assistant/assistant_merged → `AgentPanelConversationEntry`). That follow-up cannot proceed cleanly while a transient flag inverts the rendering pipeline.
- It is **scoped to one PR** (six units, no Rust, no GOD widening). The cost of doing it now versus shipping a user-visible feature first is bounded, and the engineering-time saved on every future render-layer change in this area compounds.

## Sources & References

- Origin (analysis turn): conversation context — dual-path identification in `agent-panel.svelte` (lines 361, 699–701) and `virtualized-entry-list.svelte` (lines 308, 797–800).
- Related plan: `docs/plans/2026-04-28-003-refactor-graph-scene-materialization-plan.md` — the materializer this plan completes.
- Related plan: `docs/plans/2026-04-29-001-fix-long-session-performance-contracts-plan.md` — the perf contract this plan must not regress.
- Related solution: `docs/solutions/ui-bugs/agent-panel-composer-split-brain-canonical-actionability-2026-04-30.md` — same family of "transient signal silently routes a parallel path" problem.
- Acepe MVC rule: `CLAUDE.md` / agent-panel architecture section — UI in `@acepe/ui` is presentational; controllers in desktop pass scene-derived data via props.
