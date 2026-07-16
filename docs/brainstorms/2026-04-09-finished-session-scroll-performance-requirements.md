---
date: 2026-04-09
topic: finished-session-scroll-performance
---

# Finished Session Scroll Performance

## Problem Frame
Scrolling a long finished agent session can hitch badly even when no live output is occurring. The current trace points to a finished-session reading problem: the dominant cost is compositor work in the rich conversation rows, not follow logic, forced layout, or ordinary scroll handlers.

We want a fix that makes long finished sessions feel smooth again without destabilizing the follow-behavior work already done for live threads. The key product question is not just how to make scrolling cheaper, but which parts of the live conversation surface should still stay active once a session has become a document the user is reading.

## Approach Comparison

| Approach | Description | Pros | Cons | Best suited |
|---|---|---|---|---|
| Tune the current Virtua path | Keep the current architecture and focus on lower-risk knobs such as overscan/buffer tuning and reducing obviously avoidable work during scroll. | Fastest to try, low migration risk, keeps current mental model intact. | May only soften the symptom if row complexity is the real problem. | When we want the smallest possible intervention first. |
| Cheaper finished-session rendering path | Treat finished sessions as a reading surface and reduce the visual/reactive cost of rich rows once live work has ended. This can include suppressing live-only affordances or using a cheaper presentation path for settled content. | Matches the current diagnosis, protects live-thread correctness, and creates a clearer product distinction between live work and historical reading. | Requires deciding what can change in finished sessions without harming inspection value. | **Recommended** when the goal is a durable fix for the reported slowdown. |
| Revisit the virtualization stack more fundamentally | Re-open the current list architecture, potentially changing how virtualization and conversation rendering are split or even replacing the virtualizer choice. | Highest upside if the current stack is fundamentally the wrong fit. | Highest risk, more likely to reopen recent follow/correctness work, and easy to over-scope. | When planning proves row-cost reductions are insufficient. |

**Recommendation:** prioritize a cheaper finished-session rendering path, with small current-path tuning as a supporting measure rather than the whole strategy.

## Requirements

**Problem Target**
- R1. The primary target is ordinary scrolling in finished, non-streaming agent sessions; live-thread follow correctness is a protected behavior, not the first thing to rewrite.
- R2. The fix must address the compositor-bound hitch pattern seen during ordinary scroll on long finished sessions, rather than only making scroll handlers or auto-scroll logic cheaper.
- R3. Finished sessions should behave like stable reading surfaces: once a session is no longer live, the UI should not keep paying for live-only behavior that does not materially help reading or inspection.

**Behavior and UX**
- R4. Any optimization for finished sessions must preserve message readability, tool context, file context, and the ability to inspect prior work without confusion or missing meaning.
- R5. Hover-driven, transient, or animated affordances in the main agent conversation thread for finished sessions should not add meaningful work during active scroll; if any such affordance is suppressed during scrolling, it must reappear through a stable non-hover trigger once scrolling settles.
- R6. If the product uses distinct live versus finished presentation behavior, that distinction must be implicit and non-disruptive; users should not need to learn a manual mode switch just to read an old session.

**Risk Control**
- R7. The chosen fix must not regress detach, follow, or send-time reveal behavior for live threads.
- R8. Planning should prefer localized changes to the finished-session row subtree before reopening broader thread-follow architecture or replacing the virtualization stack.
- R9. Planning must include a verification loop that compares before/after finished-session scrolling on the same reproduction path.

## Success Criteria
- Ordinary scrolling through a representative long finished session no longer produces repeated multi-frame stalls of the kind seen in the current trace.
- Finished sessions feel materially smoother to read without removing core conversation meaning or inspection value.
- A user reviewing a representative long finished session can keep context while scrolling and still inspect prior tool and file activity without noticeable interruption or mode confusion.
- Live-thread follow behavior from the recent thread-follow work remains intact.
- The final change can be explained as a finished-session performance improvement, not as another broad scroll-logic redesign.

## Scope Boundaries
- This work applies to the main agent conversation thread in finished sessions, not every scrollable surface in the app.
- This work does not reopen the user-facing follow contract unless planning proves that is unavoidable.
- This work does not assume that changing virtualization libraries is the default answer; that remains a fallback option if cheaper row rendering is insufficient.

## Key Decisions
- Problem framing: treat this as a finished-session reader performance issue, not primarily an auto-scroll correctness issue.
- Recommended direction: first explore a cheaper finished-session rendering path for rich conversation rows, potentially paired with small virtualization tuning.
- Risk posture: protect recent thread-follow correctness work unless planning produces evidence that the virtualization stack itself is the blocker.

## Dependencies / Assumptions
- The current trace is representative of the user-reported slowdown in long finished sessions.
- The product can tolerate some difference between live-session chrome and finished-session chrome if reading gets smoother and the conversation remains inspectable.

## Outstanding Questions

### Deferred to Planning
- [Affects R3-R6][Technical] Should planning pursue a dedicated finished-session presentation path, aggressive memoization within the existing row components, or both?
- [Affects R5][Needs research] Which current row-level affordances or wrappers contribute the most compositor cost during active scroll?
- [Affects R8-R9][Technical] What is the smallest virtualization tuning change that helps enough to keep alongside row-cost reductions?
- [Affects R7][Needs research] What regression coverage is needed to prove live follow behavior remains intact while the finished-session path changes?

## Next Steps
-> Create a structured implementation plan in docs/plans/