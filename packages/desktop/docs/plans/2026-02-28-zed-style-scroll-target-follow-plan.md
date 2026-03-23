---
title: Zed-Style Scroll Target Follow Refactor
type: refactor
date: 2026-02-28
status: proposed
---

# Zed-Style Scroll Target Follow Refactor

## Goal

Replace the remaining list-growth heuristic in the agent thread with a thread-owned, explicit
follow system modeled after Zed:

- the thread view owns follow mode
- the latest visible content can ask to be kept revealed
- user-send can force follow
- assistant and tool growth respect detach
- list-bottom reveal becomes a fallback, not the primary semantic trigger

This plan assumes the current refactor state already exists:

- `AutoScrollLogic` now models explicit internal `following` state
- `VirtualizedEntryList` owns reveal scheduling
- store-level `tailChange` plumbing has been removed

The remaining gap versus Zed is finer-grained reveal targeting.

## Current Gap

Today we are much better than before, but the thread still follows growth indirectly:

- the thread observes the latest rendered row
- row measurement changes schedule reveal work
- reveal still means `scrollToIndex(last, { align: "end" })`

That is deterministic enough for row-level growth, but it is still less direct than Zed.

Zed's stronger model is:

- explicit follow state in the thread view
- per-entry or per-chunk reveal handles
- latest content asks the thread to stay revealed
- the thread decides whether that request is honored

That is the target architecture here.

## Design Principles

1. The thread view is the only owner of reveal decisions.
2. Child content may request reveal, but may not decide follow mode.
3. Follow state stays local to the UI layer.
4. Stable display keys matter more than DOM references or raw indexes.
5. Virtualization churn must degrade to fallback behavior, not break follow mode.
6. User-send is the only content event that forcefully re-enters follow mode.

## Target Architecture

### 1. Thread Follow Controller

Introduce one thread-scoped controller, likely beside
`virtualized-entry-list.svelte`, that owns:

- `following`
- `nearBottom`
- `latestTargetKey`
- `registerTarget(targetKey, handle)`
- `unregisterTarget(targetKey)`
- `requestReveal(targetKey, options?)`
- `requestLatestReveal(options?)`
- `revealListBottom(options?)`
- `detach()` / `reset()`

This controller does not replace `AutoScrollLogic`.
It composes it.

Responsibilities split:

- `AutoScrollLogic`: user intent, detach/reattach, bottom geometry, auto-scroll suppression
- `ThreadFollowController`: semantic reveal routing and target ownership

### 2. Reveal Target Registry

The thread holds a registry of reveal targets keyed by stable display keys.

Each target entry contains:

- `key`
- `reveal(): void`
- `isMounted(): boolean`
- `kind: "assistant" | "tool_call" | "thinking" | "list_fallback"`

The registry must tolerate remounts and virtualization churn.

Important rule:

- if a requested target is absent or unmounted, the controller falls back to `revealListBottom()`

### 3. Stable Target Identity

Target identity must be based on rendered display keys, not array indexes.

Candidate key sources:

- assistant display entry key from `getVirtualizedDisplayEntryKey(...)`
- tool call display entry key
- synthetic thinking row key

This avoids bugs when:

- rows remount
- indexes shift
- assistant entries merge
- tool entries mutate in place

### 4. Child-to-Thread Reveal Requests

Rendered latest content registers a reveal handle with the thread.

Primary producers:

- `assistant-message.svelte`
- tool call renderers under `src/lib/acp/components/tool-calls`
- thinking row or its wrapper if needed

Each producer only reports:

- I exist
- I am the latest revealable thing
- my visible tail changed

It does not check `following`.
That remains a thread decision.

### 5. Two Reveal Layers

#### Fine-Grained Reveal

Used when a concrete latest target exists and is mounted.

Examples:

- assistant thought block grows
- assistant message block grows
- tool body appears under an already-rendered header
- task/subagent content grows

#### List-Bottom Fallback

Used when:

- no fine-grained target is registered
- the latest target is currently virtualized out
- the latest visible thing is a synthetic row
- a send event requires immediate force-follow before target registration settles

Fallback primitive can continue to be `scrollToIndex(last, { align: "end" })`.

## Proposed File Shape

### Keep

- `packages/desktop/src/lib/acp/components/agent-panel/logic/create-auto-scroll.svelte.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte`

### Add

- `packages/desktop/src/lib/acp/components/agent-panel/logic/thread-follow-controller.svelte.ts`

Optional if needed after implementation begins:

- `packages/desktop/src/lib/acp/components/agent-panel/logic/reveal-target-registry.ts`

Bias:

- keep this in one controller unless the file becomes clearly unreadable

### Likely Touch

- `packages/desktop/src/lib/acp/components/messages/assistant-message.svelte`
- tool call components that own expanding content
- `packages/desktop/src/lib/acp/components/messages/message-wrapper.svelte` only if context delivery is needed

## Control Flow

### Send Message

1. User message becomes the latest display entry.
2. Thread sees latest display key changed.
3. Thread requests force-follow.
4. Thread reveals newest target if available, else list bottom.
5. Follow mode remains engaged.

### Assistant Growth While Following

1. Latest assistant target is registered.
2. Assistant content grows.
3. Assistant target emits `requestReveal(targetKey)`.
4. Thread checks `following`.
5. If following, reveal target.
6. If target unavailable, reveal list bottom.

### Tool Header Then Body

1. Tool entry renders header and registers target.
2. Body appears later inside same target.
3. Tool target emits `requestReveal(targetKey)`.
4. Thread reveals it while following.
5. If detached, request is ignored.

### Detached User Scroll

1. `AutoScrollLogic` transitions to detached.
2. Child reveal requests continue to arrive.
3. Thread ignores them unless request is `force: true`.
4. Returning to bottom re-enables follow.

## Virtualization Rules

### Rule 1: Never Trust Raw Index As Identity

Indexes are allowed for momentary fallback reveal only.
They are not allowed as stable target identity.

### Rule 2: Targets Must Be Re-Registerable

If a row unmounts and remounts:

- old handle is discarded
- new handle registers under the same stable key
- thread continues to treat it as the same semantic latest target

### Rule 3: Missing Target Must Not Stall Reveal

If the latest target is not mounted when a reveal is requested:

- do not drop the request silently
- fall back to list-bottom reveal

### Rule 4: Assistant Merging Must Preserve Semantic Identity

Merged assistant display entries are the hardest case.

Requirement:

- the reveal target key must correspond to the merged display entry, not the raw session entry id

Otherwise follow behavior will break when thought/message chunks merge differently across renders.

## Testing Strategy

Write tests before implementation.

### Controller-Level Tests

New tests for the thread follow controller:

1. Honors reveal requests while following.
2. Ignores non-forced reveal requests while detached.
3. Uses fallback reveal when target is unregistered.
4. Force-follow requests re-enter follow mode.
5. Unregister/remount under same key still works.

### Component-Level Tests

Expand the Vitest component suite around `VirtualizedEntryList`.

Required scenarios:

1. Sending a new user message force-follows while detached.
2. Latest assistant row growth remains revealed while following.
3. Latest tool row growth remains revealed while following.
4. Detached mode ignores assistant growth.
5. Detached mode ignores tool growth.
6. Returning to bottom re-enables follow.
7. Target missing from registry falls back to list-bottom reveal.
8. Virtualized remount of the latest target does not break follow behavior.

### Child Producer Tests

For `assistant-message.svelte` and the first tool-call producer we wire:

1. Registers target on mount.
2. Unregisters on destroy.
3. Emits reveal request when its visible tail changes.
4. Does not own follow state itself.

## Implementation Phases

### Phase 0: Lock The Current Baseline

- keep current green tests
- add new red tests for target-based reveal behavior
- do not start by editing store code

### Phase 1: Introduce Thread Follow Controller

- add `thread-follow-controller.svelte.ts`
- compose it into `VirtualizedEntryList`
- route existing `AutoScrollLogic` state through it
- keep list-bottom fallback only at first

Success condition:

- no behavior regression
- no child target registration yet

### Phase 2: Wire Assistant Targets

- register one assistant reveal target for the latest rendered assistant display entry
- assistant content emits reveal requests on growth
- thread follows that target while following

Success condition:

- assistant growth no longer depends on generic latest-row measurement

### Phase 3: Wire Tool Targets

- start with the most common expanding tool body path
- tool body growth emits reveal requests
- thread honors them while following

Success condition:

- tool header then body is fully covered by target-based reveal

### Phase 4: Shrink List-Level Measurement Heuristics

Once assistant and tool targets are live:

- remove latest-row-driven reveal scheduling from `VirtualizedEntryList`
- keep only measurement needed for virtualizer correctness and fallback reveal

Success condition:

- row growth is no longer the primary semantic trigger

### Phase 5: Cleanup

- simplify comments to match final architecture
- remove obsolete tests tied to intermediate list-growth assumptions
- verify no store-level scroll semantics remain

## Acceptance Criteria

### Functional

1. Sending a user message always reveals that message fully.
2. Tool header then body growth stays revealed while following.
3. Assistant growth stays revealed while following.
4. Detached mode is never overridden by assistant or tool growth.
5. Returning to bottom re-enables follow.
6. Missing or unmounted targets fall back safely to list-bottom reveal.

### Architectural

1. The thread view is the single owner of reveal decisions.
2. Child components only publish reveal requests and registration lifecycle.
3. Store types do not contain scroll semantics.
4. Raw row resize is not the main semantic trigger once the refactor is complete.

## Main Risks

### Risk 1: Too Many Child Components Need Wiring

Mitigation:

- start with assistant and one high-value tool renderer
- keep list-bottom fallback while coverage expands

### Risk 2: Merged Assistant Display Entries Break Target Identity

Mitigation:

- derive target keys from display-entry identity, not session-entry identity
- add explicit regression tests for merged-thought entries

### Risk 3: Virtualization Churn Produces Lost Handles

Mitigation:

- registry keyed by stable identity
- remount-safe registration lifecycle
- fallback reveal when target is absent

### Risk 4: We Reintroduce Scroll Fighting

Mitigation:

- keep detach/follow authority in `AutoScrollLogic`
- allow only force-follow requests to override detached mode

## Recommended Starting Point

Start with this exact order:

1. Add red tests for target registration and target-based reveal.
2. Add `thread-follow-controller.svelte.ts`.
3. Keep current bottom fallback working.
4. Wire `assistant-message.svelte`.
5. Wire one tool-call growth path.
6. Remove row-growth scheduling only after those pass.

This gets us as close to Zed's logic as our Svelte/virtualizer stack reasonably allows, while
keeping the refactor testable and bounded.
