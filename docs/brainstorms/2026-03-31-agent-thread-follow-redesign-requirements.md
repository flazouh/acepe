---
date: 2026-03-31
topic: agent-thread-follow-redesign
---

# Agent Thread Follow Redesign

## Problem Frame
The current agent thread auto-follow behavior is not predictable enough when a user tries to leave the live bottom and read earlier content. In practice, the thread can reattach too aggressively, especially near the bottom during streaming or other layout churn, which makes the interface feel like it is fighting the user. We want a clearer, more durable follow model where detach, reattach, send, and panel-return behavior are explicit user-facing rules instead of emergent behavior from scroll heuristics.

## Requirements

**Detach and Follow Contract**
- R1. The agent thread must treat detached versus following as an explicit UI state with user-visible consequences, not as an incidental byproduct of transient near-bottom geometry.
- R2. Once the user detaches from the live bottom, normal assistant output, tool output, thinking updates, streaming growth, and layout remeasurement must not pull the thread back to the live bottom.
- R3. Small manual movements away from the bottom must count as a real detach; the system must not require a large upward move before respecting user control.
- R4. Auto-follow must resume when the user manually returns the thread to the bottom, regardless of whether they used wheel input, a trackpad gesture, a scrollbar drag, or another ordinary manual scroll interaction.

**Explicit Override Events**
- R5. Sending a new user message while detached must force the thread to follow the new live turn.
- R6. Returning to a previously detached panel after switching away must auto-follow the live bottom rather than restoring the old detached reading position.
- R7. Other than the explicit overrides in R5 and R6, detached state must be preserved until the user manually returns to the bottom.

**Live Thread Behavior**
- R8. While the thread is following, the newest live content must remain revealed as assistant and tool output grows.
- R9. While the thread is detached, the system may continue to observe and process incoming content, but those updates must not change the viewport position.
- R10. The thread must keep the scroll-to-bottom affordance or equivalent explicit reattach action available when the user is detached.

**Predictability and Robustness**
- R11. The behavior must be consistent across the main thread scroller inputs already supported by the app, including wheel-based scrolling, trackpad scrolling, direct scroll-position changes, and virtualization-driven remeasurement.
- R12. Auto-follow decisions must not depend on timing-sensitive races between scroll handlers, resize observers, or deferred reveal scheduling such that the same user gesture sometimes detaches and sometimes snaps back.

## Success Criteria
- A user can leave the live bottom during streaming or other active output without the thread snapping back unexpectedly.
- Returning manually to the bottom reliably re-enables follow behavior.
- Sending a new message from a detached state reliably returns the user to the live conversation.
- Switching back to a previously detached panel returns the user to the live conversation instead of trapping them in stale detached state.
- Assistant and tool growth continue to feel live and responsive while following, without breaking detached reading.

## Scope Boundaries
- This work applies to the main agent conversation thread, not every scrollable surface in the app.
- This work does not introduce a user-facing preferences matrix for follow behavior.
- This work does not require redesigning review-mode diff scrolling or unrelated panels unless planning discovers a shared abstraction is necessary.
- This work does not require new provider-specific session semantics; it is about thread viewport behavior in the desktop UI.

## Key Decisions
- Scope: Treat this as a follow-model redesign for the agent thread, not a one-off regression patch.
- Detach semantics: Detach should happen on genuine manual movement away from the bottom, even for small near-bottom movements.
- Reattach semantics: Any manual return to bottom should re-enable follow.
- User-send override: Sending a new user message should force re-follow.
- Panel-return override: Returning to a detached panel should auto-follow the live conversation.
- Background output: Assistant and tool growth should never override detach on their own.

## Dependencies / Assumptions
- The current thread architecture can be evolved to express explicit follow state without changing provider protocols.
- Existing virtualization and resize-observer plumbing can either honor the new contract directly or be wrapped so their updates no longer compete with user intent.

## Outstanding Questions

### Deferred to Planning
- [Affects R1-R4][Technical] Whether the clearest implementation is to simplify the existing `AutoScrollLogic` and `ThreadFollowController` split or keep both with stricter contracts between them.
- [Affects R6][Technical] Whether panel-return auto-follow should happen immediately on focus, after the panel's layout settles, or through the same explicit reveal pipeline used for normal follow mode.
- [Affects R11-R12][Needs research] Which current races are purely caused by suppression-window logic versus deferred reveal scheduling, and whether both need architectural changes.
- [Affects R10][Technical] Whether the existing scroll-to-bottom affordance remains sufficient once detach/follow becomes more explicit.

## Next Steps
-> /ce:plan for structured implementation planning