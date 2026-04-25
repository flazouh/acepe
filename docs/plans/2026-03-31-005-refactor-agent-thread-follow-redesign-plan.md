---
title: "refactor: Redesign agent thread follow behavior"
type: refactor
status: active
date: 2026-03-31
origin: docs/brainstorms/2026-03-31-agent-thread-follow-redesign-requirements.md
deepened: 2026-03-31
---

# Agent Thread Follow Redesign Plan

## Overview

Redesign the desktop agent thread follow system so detach, reattach, send, and panel-return behavior are explicit and predictable. The implementation should keep the existing live-thread affordances and virtualization fallback paths, but remove the current ambiguity where near-bottom geometry and deferred reveal work can override real user detaches.

## Problem Frame

The current agent thread mixes explicit follow state with geometry-based suppression and deferred reveal scheduling. That split allows user intent to be lost near the bottom during streaming, because programmatic-settling heuristics can still classify real user movement as auto-scroll. The origin requirements document calls for a clearer contract: detaching must stick, any manual return to bottom must reattach, send must force-follow, and returning to a panel must also force-follow the live conversation rather than restoring stale detached state.

## Requirements Trace

- R1. Detached versus following must be explicit UI state, not an incidental geometry side effect.
- R2. Assistant, tool, thinking, streaming, and layout churn must not reattach the thread after detach.
- R3. Small manual movements away from bottom must count as a real detach.
- R4. Any manual return to bottom must re-enable follow, regardless of input method.
- R5. Sending a new user message while detached must force-follow the new live turn.
- R6. Returning to a previously detached panel must auto-follow the live bottom.
- R7. Detached state must otherwise persist until manual return to bottom.
- R8. While following, the newest live content must remain revealed as the thread grows.
- R9. While detached, incoming content may update state but must not move the viewport.
- R10. The existing explicit reattach affordance must remain available while detached.
- R11. Behavior must stay consistent across wheel, trackpad, scrollbar, direct scroll-position changes, and virtualization fallback.
- R12. Follow decisions must not depend on timing-sensitive races between scroll handlers, resize observers, and deferred reveal scheduling.

## Scope Boundaries

- Limit this redesign to the main agent conversation thread.
- Keep review-mode diff scrolling and unrelated panels out of scope unless a shared helper must change for thread correctness.
- Do not add a new user preference matrix or detached-state chrome beyond the current scroll-to-bottom affordance.
- Do not change provider/session protocol behavior; this is a desktop UI follow-model redesign.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src/lib/acp/components/agent-panel/logic/create-auto-scroll.svelte.ts` currently owns follow state, wheel handling, geometry checks, and programmatic-scroll suppression.
- `packages/desktop/src/lib/acp/components/agent-panel/logic/thread-follow-controller.svelte.ts` owns semantic reveal routing, reveal target registration, and RAF-batched reveal retries.
- `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte` wires wheel events, scroll events, reveal targets, virtualization fallback, and the `ThreadFollowController` to `AutoScrollLogic`.
- `packages/desktop/src/lib/acp/components/messages/message-wrapper.svelte` uses `ResizeObserver` to request reveal work whenever a rendered entry grows.
- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte` currently force-follows on send, but only does a non-forced scroll on panel switch.
- Existing tests already cover core behavior in:
  - `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/create-auto-scroll.test.ts`
  - `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/thread-follow-controller.test.ts`
  - `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/virtualized-entry-list.svelte.vitest.ts`
  - `packages/desktop/src/lib/acp/components/agent-panel/logic/should-auto-scroll-on-panel-activation.vitest.ts`
- Prior design intent is documented in:
  - `packages/desktop/docs/plans/2026-01-31-fix-scroll-anchoring-flickering-plan.md`
  - `packages/desktop/docs/plans/2026-02-28-zed-style-scroll-target-follow-plan.md`

### Institutional Learnings

- The thread hot-path learnings already established that scroll geometry should be measured once per frame and that resize-driven follow work should batch through one RAF frame instead of broad synchronous rescans.
- The current wrapper-level design is already optimized around a single authoritative scroller with virtualization fallback; the redesign should preserve that shape rather than introducing a second competing scroll state source.

### External References

- Not used. The repo already contains strong local patterns and prior design work for this subsystem.

## Key Technical Decisions

- **Keep the ownership split, but tighten the contract:** `AutoScrollLogic` remains the sole owner of follow state and user-driven transitions; `ThreadFollowController` remains a reveal router and must never decide when detached state ends. This preserves the existing architecture while removing the current ambiguity between reveal scheduling and follow state.
- **Reattach on geometry, not only wheel intent:** Manual return to bottom must be recognized from scroll position changes as well as wheel deltas so scrollbar drags, trackpad gestures, and fallback-native scrolling all satisfy R4.
- **Treat force-follow as one shared reveal pathway:** The scroll-to-bottom button, send flow, and panel-return flow should all re-enter follow mode through the same force-follow semantics instead of bespoke direct scroll writes.
- **Panel return becomes an explicit force-follow event:** The existing panel-activation effect should continue to gate initial activation versus panel switching, but switching back to a panel should route through the force-follow path instead of a best-effort non-forced reveal.
- **Programmatic scroll suppression must never mask user movement away from bottom:** Suppression may absorb virtualization settling after a reveal, but any genuine move away from the bottom must clear or bypass the suppression window quickly enough that detach always wins.
- **Keep the existing 10px bottom threshold as the shared bottom definition:** The redesign changes detach precedence and reveal ownership, not the geometry constant that defines being back at the live bottom across Virtua and fallback-native scrolling.
- **Keep the current detached affordance model:** The scroll-to-bottom button remains the explicit detached-state affordance for this change; no new detached badge or toolbar state is required.
- **Panel return intentionally prioritizes liveness over preserving stale detached position:** This change adopts the chosen product rule that switching back to a panel returns the user to the live conversation, even if they had previously detached to read history.

## Open Questions

### Resolved During Planning

- **Should the redesign collapse `AutoScrollLogic` and `ThreadFollowController` into one unit?** No. Keep the split, but narrow the controller to reveal routing and keep follow-state authority in `AutoScrollLogic`.
- **How should panel-return auto-follow be triggered?** Reuse the existing panel-activation effect after the panel switch settles, but route the action through the same force-follow pipeline used for explicit reattach flows.
- **Should `should-auto-scroll-on-panel-activation.ts` grow beyond a pure boolean gate?** No. Keep it focused on detecting actual panel-boundary crossings; the force-follow decision stays in `agent-panel.svelte`.
- **What suppression strategy should Unit 2 pursue first?** Clear or bypass programmatic suppression as soon as genuine user movement away from the bottom is detected, while keeping the current 10px bottom threshold as the shared geometry contract. If regression tests show that virtualization settling still needs more state, refine inside Unit 2 rather than broadening the architecture mid-execution.
- **Does the redesign need a new affordance beyond the scroll-to-bottom button?** No. Keep the existing button and make its behavior more reliable under explicit detach.

### Deferred to Implementation

- The exact helper names and exported surface needed to express explicit reattach or force-follow semantics once `create-auto-scroll.svelte.ts` is edited.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

| Event | Follow-state owner decision | Reveal behavior |
|---|---|---|
| Manual move away from bottom | `AutoScrollLogic` transitions to detached immediately once movement leaves the shared 10px bottom threshold, even for small near-bottom moves | Any pending non-forced reveal becomes a no-op |
| Assistant/tool/thinking growth while following | Follow state unchanged | `ThreadFollowController` may reveal the latest target or fall back to list bottom |
| Assistant/tool/thinking growth while detached | Follow state unchanged | Reveal request is ignored unless explicitly forced |
| Manual return to bottom | `AutoScrollLogic` transitions back to following from scroll geometry, regardless of input method | Normal follow resumes for subsequent growth |
| User sends a new message | Force-follow enters through the existing send preparation path before the new user turn is revealed | The latest user turn is shown in the same force-follow sequence even if previously detached |
| User returns to a panel | A real panel-boundary crossing queues a force-follow after the next settled frame | Live bottom is restored instead of stale detached position unless the user manually detaches again before the queued force-follow flushes |
| User clicks scroll-to-bottom | Force-follow enters through the explicit affordance | Latest content is revealed and follow resumes |

ResizeObserver-driven reveal requests should continue to batch through one frame, but the follow snapshot must be checked at flush time rather than callback time so a detach that happens mid-frame cancels every non-forced reveal queued in that frame.

## Implementation Units

- [ ] **Unit 1: Capture the redesigned follow contract in failing tests**

**Goal:** Lock in the intended detach, reattach, send, and panel-return rules before reshaping the logic.

**Requirements:** R1-R12

**Dependencies:** None.

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/create-auto-scroll.test.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/thread-follow-controller.test.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/virtualized-entry-list.svelte.vitest.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/should-auto-scroll-on-panel-activation.vitest.ts`
- Create: `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/agent-panel-follow-overrides.vitest.ts`

**Approach:** Add characterization coverage for the redesigned contract at the logic and integration seams before changing implementation. Keep the first pass focused on observable behavior so the later refactor can move internals without weakening coverage.

**Execution note:** Start with failing tests.

**Patterns to follow:** Existing deterministic RAF mocking in `thread-follow-controller.test.ts`; existing detach/send integration coverage in `virtualized-entry-list.svelte.vitest.ts`; existing small pure-helper tests in `should-auto-scroll-on-panel-activation.vitest.ts`.

**Test scenarios:**
- Happy path: A small manual move away from bottom while following transitions to detached and prevents subsequent non-forced reveal work.
- Happy path: Manual return to bottom through scroll-position changes re-enables following without requiring a wheel-specific path.
- Happy path: Sending a new user message while detached force-follows the new user turn.
- Happy path: Switching away from a panel and returning force-follows the live bottom.
- Edge case: Near-bottom detaches just outside the bottom threshold still detach instead of being treated as programmatic settling.
- Edge case: Returning to the same panel without an actual panel switch does not trigger panel-return force-follow.
- Error path: Missing or unmounted reveal targets continue to fall back safely without breaking detached state.
- Integration: Resize-driven entry growth while detached does not move the viewport even if reveal requests are queued.
- Integration: The explicit scroll-to-bottom affordance still force-follows from detached state.

**Verification:** The new tests fail on the current behavior for near-bottom detach and panel-return follow semantics, while existing send-force-follow coverage remains preserved.

- [ ] **Unit 2: Make `AutoScrollLogic` the unambiguous owner of detach and reattach state**

**Goal:** Reshape the scroll-state machine so user input and geometry transitions define follow state directly, without suppression-window logic overriding them.

**Requirements:** R1-R4, R7, R11-R12

**Dependencies:** Unit 1.

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/create-auto-scroll.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/create-auto-scroll.test.ts`

**Approach:** Keep `AutoScrollLogic` as the authoritative follow-state owner, but simplify its rules so genuine user movement away from bottom always detaches and manual return-to-bottom always reattaches. Preserve per-frame geometry measurement and virtualization-settling protections, but ensure suppression is bounded to programmatic reveal aftermath instead of swallowing real user movement. This unit also establishes the minimal explicit follow-control surface that later units consume, even though the exact helper names stay as an execution detail.

**Patterns to follow:** Existing `AutoScrollStateSnapshot` shape and single-measurement-per-frame wrapper in `create-auto-scroll.svelte.ts`; the prior repo design intent that follow state remains thread-owned while geometry is only an input.

**Test scenarios:**
- Happy path: Wheel, trackpad-like scroll-position changes, and fallback scroll container movement all produce the same detach/reattach outcome.
- Happy path: Returning to bottom from detached state reattaches follow and allows later growth to reveal normally.
- Edge case: A small upward movement near the bottom detaches immediately.
- Edge case: The shared 10px bottom threshold remains the definition of being back at the live bottom.
- Edge case: Content that fits within the viewport resets to following without leaving stale detached state behind.
- Error path: Clearing the provider or switching sessions leaves the logic in a safe default state without stale RAF or suppression state.
- Integration: Programmatic reveal settling after virtualization remeasurement stays ignored while genuine user movement away from bottom still wins.

**Verification:** `AutoScrollLogic` exposes a consistent follow snapshot where detach and reattach no longer depend on reveal scheduling races.

- [ ] **Unit 3: Narrow reveal scheduling so it respects explicit detached state and forced overrides only**

**Goal:** Keep resize-driven live follow responsive while ensuring reveal routing can never silently reattach detached users.

**Requirements:** R2, R5, R7-R9, R11-R12

**Dependencies:** Units 1 and 2.

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/thread-follow-controller.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/thread-follow-controller.test.ts`
- Modify: `packages/desktop/src/lib/acp/components/messages/message-wrapper.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/virtualized-entry-list.svelte.vitest.ts`

**Approach:** Preserve the reveal-target registry and RAF-batched settling loop, but make reveal routing depend on the explicit follow snapshot from `AutoScrollLogic` rather than any implicit near-bottom assumption. Keep force-follow support for send and explicit reattach actions, and ensure queued reveal work is canceled or ignored when detach wins. Limit `message-wrapper.svelte` changes to how agent-thread ResizeObserver requests are forwarded; review-mode and other non-thread surfaces remain unchanged. The fallback native scroll container (`fallbackViewportRef`) must keep the same reveal semantics as the Virtua path.

**Patterns to follow:** Existing target registration in `message-wrapper.svelte`; current provider reset and generation-guard handling in `thread-follow-controller.svelte.ts`; virtualization fallback parity already maintained in `virtualized-entry-list.svelte`.

**Test scenarios:**
- Happy path: Latest assistant or tool growth while following reveals the newest target and preserves live behavior.
- Happy path: A forced reveal still succeeds while detached for send and explicit reattach flows.
- Edge case: Queued reveal frames after a detach do not pull the viewport back live.
- Edge case: Reveal-target remounts or unmounted latest targets fall back safely to list-bottom reveal without changing detached state.
- Edge case: Virtua and the fallback native scroll container use the same 10px bottom threshold and force-follow semantics.
- Error path: Resetting the controller during session/provider changes clears pending reveal work without stale callbacks mutating the new session.
- Error path: Resetting the provider or session while forced reveal work is pending leaves stale callbacks inert.
- Integration: ResizeObserver growth requests while detached are ignored unless the request is explicitly forced.
- Integration: Detaching during a batch of ResizeObserver callbacks causes every non-forced reveal queued in that frame to be ignored.

**Verification:** Reveal routing remains responsive while following, but detached state is no longer vulnerable to resize- or RAF-driven snap-back.

- [ ] **Unit 4: Align panel-level overrides and detached affordances with the redesigned contract**

**Goal:** Ensure send, panel return, and explicit scroll-to-bottom all use the same reliable force-follow semantics.

**Requirements:** R5-R6, R10-R12

**Dependencies:** Units 1 through 3.

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-content.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/should-auto-scroll-on-panel-activation.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/should-auto-scroll-on-panel-activation.vitest.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/scroll-to-bottom-button.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/agent-panel-content.svelte.vitest.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/agent-panel-follow-overrides.vitest.ts`

**Approach:** Keep send behavior force-following through the existing pre-send hook, change panel-return behavior to use an explicit force-follow path after a real panel switch settles, and verify the scroll-to-bottom button continues to act as the canonical detached-state recovery control. Keep `should-auto-scroll-on-panel-activation.ts` as a pure gate for actual panel-boundary crossings; all force-follow orchestration stays in `agent-panel.svelte`. The panel-return sequence should be: detect panel switch, wait for the next settled frame, confirm the same panel is still active, then issue force-follow unless a fresh manual detach has already happened.

**Patterns to follow:** Existing `prepareForNextUserReveal({ force: true })` path in `agent-panel.svelte`; existing pass-through exports in `agent-panel-content.svelte`; current minimal helper testing pattern in `should-auto-scroll-on-panel-activation.vitest.ts`.

**Test scenarios:**
- Happy path: Sending from detached state force-follows through the existing panel-to-content delegation path.
- Happy path: Returning to a different panel after a tab switch force-follows the live bottom.
- Edge case: Initial panel activation does not trigger panel-return follow.
- Edge case: Remaining on the same panel does not trigger an extra force-follow.
- Edge case: Manual scrolling during the panel-return settle window cancels the pending non-user force-follow.
- Edge case: The scroll-to-bottom button remains visible while detached, remains keyboard accessible, and reattaches correctly when clicked.
- Integration: New content arriving while a panel-return force-follow is pending resolves to the latest live content rather than a stale target.
- Integration: Panel-return force-follow reuses the same reveal pipeline as other force-follow actions rather than writing a separate raw scroll path.

**Verification:** All panel-level override events converge on one explicit force-follow contract, and detached-state recovery stays available through the existing affordance.

## System-Wide Impact

- **Interaction graph:** Wheel and scroll events feed `AutoScrollLogic`; `AutoScrollLogic` state feeds `ThreadFollowController`; `MessageWrapper` `ResizeObserver` callbacks feed reveal requests; `AgentPanel` and `AgentPanelContent` inject force-follow overrides for send and panel return.
- **Error propagation:** This subsystem should continue to fail soft. Missing providers, unmounted reveal targets, or stale RAF callbacks should degrade to skipped reveal work rather than exceptions or corrupted session state.
- **State lifecycle risks:** Pending reveal frames, virtualization fallback provider swaps, and panel-switch timing all cross session and mount boundaries; the redesign must preserve existing reset and generation-guard behavior while making detached state win deterministically.
- **API surface parity:** The public `scrollToBottom` and `prepareForNextUserReveal` entry points should remain the panel-level API surface, even if their underlying implementation becomes more explicit about force-follow semantics.
- **Integration coverage:** Manual near-bottom detach, manual return to bottom, detached resize growth, send-while-detached, panel-return force-follow, nested scrollable wheel isolation, and fallback-native scrolling all need cross-layer regression coverage.
- **Protocol boundary:** Provider resets and generation guards in this plan refer only to UI-layer scroll-provider swaps and session-view bookkeeping; no ACP, provider, or persisted session protocol changes are in scope.
- **Unchanged invariants:** The scroll-to-bottom button remains the detached-state affordance; review-mode scrolling remains out of scope; virtualization fallback continues to provide a safe scroll provider when Virtua fails.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Panel-return force-follow could become too aggressive on first mount or same-panel rerenders. | Keep the existing activation gate semantics under test and only force-follow on actual panel switches after layout settles. |
| Suppression-window changes could reintroduce flicker during programmatic reveal settling. | Preserve one-geometry-snapshot-per-frame handling and add explicit tests that separate true programmatic settling from user movement away from bottom. |
| Pending reveal RAFs could still race with detach or session reset. | Keep generation-guard resets in `ThreadFollowController` and add integration tests that queued reveal work becomes inert after detach or provider reset. |
| New component-level tests around `agent-panel.svelte` may become expensive or brittle. | Keep orchestration coverage targeted and rely on existing pure-logic tests for most state-machine behavior. |

## Documentation / Operational Notes

- No rollout or operational changes are expected.
- If implementation uncovers a simpler long-term follow architecture than the current split, capture that as a follow-up solution note rather than expanding this redesign during execution.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-03-31-agent-thread-follow-redesign-requirements.md](docs/brainstorms/2026-03-31-agent-thread-follow-redesign-requirements.md)
- Related design: `packages/desktop/docs/plans/2026-01-31-fix-scroll-anchoring-flickering-plan.md`
- Related design: `packages/desktop/docs/plans/2026-02-28-zed-style-scroll-target-follow-plan.md`
- Related code: `packages/desktop/src/lib/acp/components/agent-panel/logic/create-auto-scroll.svelte.ts`
- Related code: `packages/desktop/src/lib/acp/components/agent-panel/logic/thread-follow-controller.svelte.ts`
- Related code: `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte`