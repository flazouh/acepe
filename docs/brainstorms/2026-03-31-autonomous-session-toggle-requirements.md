---
date: 2026-03-31
topic: autonomous-session-toggle
---

# Autonomous Session Toggle

## Problem Frame
Some users want the agent to work on its own without repeated permission interruptions. The current approval model supports per-request allowances and some agent-specific approval modes, but it still centers Acepe as the mediator for risky actions. We want a deliberately high-autonomy session mode that a power user can flip on instantly from the main session chrome, so the selected agent can run with minimal wrapper friction during a live session.

## Requirements

**Primary UI**
- R1. The session UI must expose a single dedicated text-labeled toggle button near the mode picker for entering and exiting the high-autonomy state.
- R2. The toggle must use a muted visual treatment when off and a red visual treatment when on.
- R3. The active-state indication must stay minimal; this change must not require banners, modal warnings, or additional session-wide warning chrome.
- R4. The button must remain visible in the main session UI rather than being hidden in settings, menus, or a secondary flow.
- R5. The button text must remain a static "Autonomous" label across states rather than changing copy when toggled.
- R6. For supported agents, the button must expose concise tooltip copy that explains the behavior of the mode without adding extra persistent UI chrome.

**Activation and Lifetime**
- R7. Turning the toggle on must take effect immediately, with no confirmation step.
- R8. The toggle must apply at the session level while that session remains open.
- R9. The toggle must remain on across multiple turns in the same live session until the user explicitly turns it off.
- R10. Reopening a previous session must reset the toggle to off rather than restoring the prior autonomous state.
- R11. Turning the toggle off must take effect immediately.
- R12. If the user turns the toggle off while the agent is already running, future approval-worthy actions in that same turn must return to normal approval handling without forcibly interrupting the turn.

**Autonomous Behavior**
- R13. When the toggle is on, Acepe must stop interrupting the session with its normal permission approval flow.
- R14. This mode is intended to be fully hands-off during the live session; it must not preserve separate always-ask guardrails for shell actions, file edits, browser or network actions, or other tool classes.
- R15. Acepe must treat this as a wrapper-level autonomy mode rather than inventing its own generic answer policy for agent questions.
- R16. When autonomous mode is active, question-handling behavior must defer to the selected agent mode and provider behavior; Acepe must not add an extra confirmation layer solely because the session is autonomous.

**Capability and Compatibility**
- R17. If the selected agent cannot fully support this autonomous mode, the toggle must remain visible but disabled.
- R18. When disabled for the selected agent, the UI must explain that the mode is unavailable for that agent through tooltip copy rather than hiding the control or relying on click-time failure.
- R19. If autonomous mode is currently on and the user switches the session to an unsupported agent, Acepe must turn autonomous mode off immediately.

## Success Criteria
- A user can start a live session, click one button near the mode picker, and immediately place that session into a hands-off autonomous state.
- While the button stays on, the session can continue across multiple turns without Acepe surfacing its normal permission interruptions.
- Turning the button off during a live run restores normal approval behavior for subsequent approval-worthy actions without requiring a session restart.
- Reopening the same conversation later starts in the safe default off state.
- Users on unsupported agents can still discover the feature, but they are clearly told why it is unavailable.
- Switching from a supported agent to an unsupported one immediately returns the session to the safe default off state.

## Scope Boundaries
- No repo-wide, worktree-wide, or global persistence for this mode in this change.
- No activation modal, typed confirmation, or multi-step warning flow in this change.
- No additional banners, full-session warning themes, or other heavy safety chrome beyond the button state itself.
- No Acepe-specific auto-answer engine for agent questions in this change.
- No attempt to create a best-effort degraded autonomy mode for unsupported agents in this change.

## Key Decisions
- Scope: Autonomous mode is per live session, not global.
- Entry: Activation is a single click with no confirmation.
- Exit: Deactivation is a single click and applies immediately.
- Visibility: The control lives near the mode picker and communicates state primarily through its own muted versus red treatment.
- Presentation: The control is a labeled toolbar button rather than an icon-only affordance.
- Copy: The button label stays "Autonomous" in both on and off states.
- Supported hover help: Use concise tooltip copy to explain the mode's behavior.
- Persistence: The mode stays on only while the current session remains open and resets on reopen.
- Unsupported agents: Show the control in a disabled state with an explanation instead of hiding it.
- Disabled explanation: Use tooltip copy rather than persistent helper text or click-triggered messaging.
- Agent switching: Changing from a supported agent to an unsupported one forces autonomous mode off immediately.
- Question handling: Defer to the underlying agent mode rather than building Acepe-managed generic auto-answering.

## Dependencies / Assumptions
- At least some supported agent backends expose a real high-autonomy mode that Acepe can map this toggle onto.
- Acepe can determine whether the currently selected agent supports this mode before or during session use well enough to disable the control with an explanation.

## Outstanding Questions

### Deferred to Planning
- [Affects R11][Technical] How this session-level UI state maps onto each provider's concrete permission and question-handling controls without introducing provider-specific behavior leaks into the shared UI layer.
- [Affects R10][Technical] How to apply immediate toggle-off semantics safely when a provider is already mid-stream and some tool requests may already be in flight.
- [Affects R15][Needs research] What capability signal should drive the disabled state so unsupported-agent detection is accurate before the user tries to rely on autonomous mode.
- [Affects R2][Technical] What exact red and muted treatments satisfy accessibility and contrast requirements without adding heavier warning chrome.

## Next Steps
-> Create a structured implementation plan in docs/plans/