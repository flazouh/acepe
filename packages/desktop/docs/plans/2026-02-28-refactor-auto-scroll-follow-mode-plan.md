---
title: Simplify Auto Scroll With A Minimal-First Refactor
type: refactor
date: 2026-02-28
---

# Simplify Auto Scroll With A Minimal-First Refactor

## Overview

The original diagnosis still stands: our agent thread scroll behavior is flaky because it does not reliably keep the newest relevant content revealed.

The original big-bang refactor proposal does **not** stand.

After review, the better direction is:

- keep the good diagnosis
- keep the current `AutoScrollLogic` unless tests prove it is the wrong abstraction
- start with the smallest change that could plausibly fix the real bugs
- only introduce a new controller if the minimal path fails

This plan supersedes the earlier “explicit follow mode” rewrite proposal with a simpler, test-first plan.

## What We Keep From The Original Diagnosis

The current user-visible failures are still real:

- sending a user message does not always reveal that message fully
- tool call headers can appear, then their body grows, and the viewport does not follow
- nested scrollables can steal wheel intent at boundaries
- the overall behavior feels timing-sensitive and flaky

The most important underlying insight is also still correct:

> The thread should behave like it is either following the latest content or respecting user control.

But the review feedback is right that we do **not** need a new event bus, three new modules, or DTO-level scroll revisions to express that.

## Review Synthesis

### 1. `AutoScrollLogic` Already Models Follow vs Detached

The current abstraction is already close to the right one:

- `_userScrolledAway = false` means we are following
- `_userScrolledAway = true` means we are detached

That is already an explicit two-state system, even if it is not named `FollowMode`.

The problem is not primarily that the abstraction is missing.
The problem is that the thread view wires too many heuristics around it.

### 2. The Previous Plan Was Overbuilt

The following ideas are not justified at this stage:

- six named reveal event types
- `RevealReason`
- `display-change-detector.ts`
- `reveal-latest-target.ts`
- `renderRevision` or `contentRevision` on `SessionEntry`
- running old and new systems in parallel during migration

Those changes would add indirection before proving the small fix is insufficient.

### 3. The ResizeObserver Gate Is The Best Minimal Hypothesis

The strongest concrete hypothesis from review is that the `ResizeObserver` guard in
`virtualized-entry-list.svelte` is too restrictive:

```ts
if (!isStreaming && !isWaitingForResponse) return;
```

That gate blocks follow behavior when the newest tool output continues to grow after
streaming/thinking state has already ended.

This matches the observed bug:

- tool header appears while active work is still happening
- content/body appears after that state flips
- observer sees growth but refuses to reveal it

### 4. The Hard Problem Is Measurement Settlement

If “send a message” scroll happens before the last row is fully measured, the user can still
end up with a partially hidden bubble even though we technically scrolled.

This is the hardest problem in the system and must be addressed through tests and careful
retries, not architecture theater.

### 5. The Existing 300ms Stop Delay Must Be Respected

The current stop-transition delay exists for a reason and cannot be casually deleted.

The minimal plan should keep it until tests show it is unnecessary or we replace it with a
clearer mechanism.

## Refactor Principles

1. Prefer modifying existing abstractions over introducing new ones.
2. Do not move UI scroll semantics into DTO/store types unless forced.
3. Do not run “old and new” scroll systems in parallel.
4. Make the failing user journeys executable before changing architecture.
5. Escalate to a larger rewrite only if the minimal path demonstrably fails.

## Minimal Hypothesis

The current system may be repairable with a small number of targeted changes:

1. Relax or remove the `isStreaming || isWaitingForResponse` gate in the `ResizeObserver` path.
2. Ensure the latest-item reveal path survives one or more post-measurement growth steps.
3. Preserve the current follow/detached model in `AutoScrollLogic`.
4. Keep the 300ms stop-delay behavior unless tests show it is the source of failure.

If these changes satisfy the failing journeys, we should stop there.

## Implementation Plan

### Phase 0: Write The 7 Failing Tests First

Write tests against the **existing interfaces** and component surface.

Required scenarios:

1. Sending a user message reveals the full new user bubble.
2. The latest tool call header appears, then its content grows, and the viewport keeps following.
3. The latest assistant output grows and remains revealed while following.
4. Detached mode preserves viewport position while the latest content grows.
5. Returning to bottom re-enables follow mode.
6. Nested scrollables only swallow wheel deltas they can actually consume.
7. Session switches do not inherit pending reveal work from another session.

This phase must include component-level tests around `virtualized-entry-list.svelte`.
Pure logic tests alone are not enough.

### Phase 1: Try The Minimal Fix First

Start with the current implementation and make the smallest change set that could satisfy the tests.

Primary target:

- `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte`

Primary hypothesis to test:

- relax the `ResizeObserver` guard so latest-entry growth can still reveal content after
  `isStreaming` / `isWaitingForResponse` goes false

Likely shape:

- remove the unconditional guard, or
- narrow it so it only blocks resize-driven reveal when there is clearly no latest-entry growth

The default bias should be to change as little code as possible.

### Phase 2: Add The Smallest Necessary Measurement Retry

If the user-message scenario still fails after Phase 1, add the smallest possible retry mechanism
inside the existing component/controller relationship.

Constraints:

- no new event taxonomy
- no new store fields
- no new helper files unless a file becomes obviously too large to read

Acceptable options:

- one additional `requestAnimationFrame`-based follow retry after reveal
- one latest-item growth recheck in the existing observer path
- a small UI-layer `latestEntrySignature` derived from the last rendered display item

### Phase 3: Reassess

If all 7 tests pass, stop.

If they do not, then and only then consider replacing `AutoScrollLogic` with a **single**
new controller that owns follow behavior for the thread.

That escalation path must:

- replace the current controller, not sit beside it
- avoid extra wrapper modules unless they pay for themselves immediately
- remain local to the agent panel UI layer

## Escalation Path If Minimal Fix Fails

Only escalate if the minimal fix plus small measurement retries cannot satisfy the tests.

### Allowed Escalation

- one singular replacement controller, e.g. `thread-follow-controller.ts`

### Not Allowed Unless Re-Proven Necessary

- DTO/store-level `renderRevision`
- separate `display-change-detector.ts`
- separate `reveal-latest-target.ts`
- `RevealReason`
- parallel old/new behavior during migration

If escalation becomes necessary, first try a UI-layer `latestEntrySignature` derived from existing
data before touching `SessionEntry`.

## Precise Behavior Contract

These definitions tighten the previously vague acceptance criteria.

### “Fully Revealed”

For the newest relevant display item:

- the item’s bottom edge must be within the viewport after measurement settles
- allow a small tolerance for virtualizer rounding, e.g. 8-16px

### “Returning To Bottom”

Use the existing near-bottom threshold first.

Do not invent a new threshold unless tests prove the current one is wrong.

### “Send While Mid-Scroll”

Sending a new user message should force the thread back into follow behavior and reveal that
message, even if the user was previously detached.

That is an intentional product override, not a scroll bug.

### “Tool Output Growth”

If the latest visible entry grows and the thread is following, keep that latest entry revealed even
if active streaming/thinking status already ended.

## Risks

### Risk 1: We Patch The Wrong Trigger

The resize gate may not be the whole problem.

Mitigation:

- write the failing tests first
- keep the first code change extremely small

### Risk 2: We Accidentally Reintroduce Scroll Fights

Any new retries can bring back the original flicker pattern if they ignore detached state.

Mitigation:

- keep follow/detached ownership inside the existing `AutoScrollLogic`
- never reveal when the user is detached unless explicitly forced

### Risk 3: We Overreact And Rewrite Too Much

The previous plan made this risk obvious.

Mitigation:

- stop after the first passing implementation
- do not create new modules to “clarify” code that is still changing

## Acceptance Criteria

- [ ] Sending a user message reveals the entire new message bubble within the viewport, with only a small measurement tolerance.
- [ ] Latest tool call output remains visible as it grows, including after streaming/thinking has already ended.
- [ ] Latest assistant output remains visible while following.
- [ ] Detached mode never fights the user.
- [ ] Returning to bottom re-enables follow behavior using the existing threshold unless tests prove otherwise.
- [ ] Session switches do not cause stray reveal jumps.
- [ ] Nested scrollables no longer make detach/re-attach behavior depend on pointer position.
- [ ] The final solution uses the fewest abstractions needed to satisfy the tests.

## Recommended Execution Order

1. Write the 7 failing tests against current interfaces.
2. Try the minimal `ResizeObserver` guard change.
3. Add the smallest measurement-settlement retry needed.
4. Re-run the full test matrix.
5. Only if still failing, replace `AutoScrollLogic` with one singular controller.

## Files Most Likely To Change

- `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte`
- `packages/desktop/src/lib/acp/components/agent-panel/logic/create-auto-scroll.svelte.ts`

Possible only-if-needed addition:

- `packages/desktop/src/lib/acp/components/agent-panel/logic/thread-follow-controller.ts`

## References

- Existing stabilization plan:
  `packages/desktop/docs/plans/2026-01-31-fix-scroll-anchoring-flickering-plan.md`
- Current thread implementation:
  `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte`
- Current auto-scroll logic:
  `packages/desktop/src/lib/acp/components/agent-panel/logic/create-auto-scroll.svelte.ts`
- Zed thread view:
  `/tmp/zed/crates/agent_ui/src/connection_view/thread_view.rs`
- Zed entry state:
  `/tmp/zed/crates/agent_ui/src/entry_view_state.rs`
