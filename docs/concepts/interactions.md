# Interactions

An **interaction** is the canonical record of something the system is waiting on from a human or decision path.

In Acepe, interactions are the durable state behind things like:

- permission requests,
- questions,
- plan/apply approvals,
- other explicit action gates tied to runtime work.

## Why interactions matter

Without a canonical interaction model, these flows tend to collapse into transient UI state:

- a prompt appears,
- a component decides whether it is visible,
- reconnect happens,
- the prompt disappears or reattaches incorrectly.

Interactions prevent that by making the gate itself part of the session graph.

## Interaction vs operation

The split is:

- **operation** = the runtime work item
- **interaction** = the decision or input gate related to that work

They are linked, but they are not the same thing.

This matters because the same operation can be:

- blocked by a permission,
- waiting on a plan approval,
- associated with a question,
- resumed later with the gate still intact.

## What interactions own

Interactions should own:

- their stable identity,
- session ownership,
- interaction type,
- pending/resolved state,
- linkage to the relevant operation or tool call,
- enough metadata to render the right UX after reconnect.

Interactions also participate in graph-backed session activity.

When an interaction is pending, the session-level activity summary may legitimately become `waiting_for_user`, even if operations are still active underneath. That dominance must be decided in canonical graph-backed state so reopen, reconnect, queue, tab, and panel surfaces all agree.

## What the UI should not do

The UI should not treat permissions, questions, or plan approvals as purely local component state.

It should render from canonical interaction state and reply through store/controller paths that mutate the underlying graph-backed model.

## Association rules

Interaction association must be deterministic.

That means shared code should prefer:

- canonical operation linkage,
- stable session + tool-call identity,
- provider-projected request identity,

over:

- matching by visible text,
- transcript row timing,
- component-local guesses.

## Reconnect consequence

If interactions are canonical:

- blocked operations remain blocked after reconnect,
- pending prompts can re-render correctly,
- keyboard shortcuts and action buttons can resolve the same pending interaction,
- late-arriving operation data can still attach to the existing gate.

And because the blocking interaction is linked into session activity, UI surfaces can explain why a session is waiting without inventing a second authority path from local modal state.

If interactions are not canonical, reconnect becomes a race between UI timing and transport timing.
