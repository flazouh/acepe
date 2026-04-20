# Interactions

An **interaction** is the canonical record of something the system is waiting on from a human or decision path.

In Acepe, interactions are the durable state behind things like:

- permission requests,
- questions,
- plan/apply approvals,
- other explicit action gates tied to runtime work.

## Interaction in one picture

## Interaction in one picture

```mermaid
%%{init: {'theme':'base','flowchart': {'curve': 'basis', 'nodeSpacing': 26, 'rankSpacing': 32}, 'themeVariables': {'fontFamily': 'Inter, ui-sans-serif, system-ui', 'primaryTextColor': '#1f2937', 'primaryBorderColor': '#9ca3af', 'lineColor': '#6b7280', 'tertiaryColor': '#ffffff', 'background': '#ffffff'}}}%%
flowchart TD
    n_operation("Operation") --> n_interaction("Interaction")
    n_interaction --> n_permission("Permission UI")
    n_interaction --> n_question("Question UI")
    n_interaction --> n_approval("Approval UI")

    classDef green fill:#B4E6C8,stroke:#8FB9A2,color:#1f2937,stroke-width:1px;
    classDef yellow fill:#FFEBB4,stroke:#D8C58E,color:#1f2937,stroke-width:1px;
    classDef purple fill:#D2BEF0,stroke:#A999C4,color:#1f2937,stroke-width:1px;

    class n_operation green;
    class n_interaction purple;
    class n_permission,n_question,n_approval yellow;
```

## Why interactions matter

Without a canonical interaction model, these flows tend to collapse into transient UI state:

- a prompt appears,
- a component decides whether it is visible,
- reconnect happens,
- the prompt disappears or reattaches incorrectly.

Interactions prevent that by making the gate itself part of the session graph.

## Ownership table

| Concern | Owned by interaction? | Notes |
|---|---|---|
| Pending permission state | Yes | Should survive reconnect |
| Question/approval identity | Yes | Must not depend on render timing |
| Link to work being blocked | Yes | Deterministic association beats UI guessing |
| "Is this popup open?" | No | That is a view concern over canonical state |
| Button styling/placement | No | Presentation concern only |

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

## Relationship table

| Concept | Purpose |
|---|---|
| Operation | The work item being executed |
| Interaction | The gate or decision tied to that work |
| Transcript | The visible conversation/history surface |

## What interactions own

Interactions should own:

- their stable identity,
- session ownership,
- interaction type,
- pending/resolved state,
- linkage to the relevant operation or tool call,
- enough metadata to render the right UX after reconnect.

## Association hierarchy

```mermaid
%%{init: {'theme':'base','flowchart': {'curve': 'basis', 'nodeSpacing': 22, 'rankSpacing': 28}, 'themeVariables': {'fontFamily': 'Inter, ui-sans-serif, system-ui', 'primaryTextColor': '#1f2937', 'primaryBorderColor': '#9ca3af', 'lineColor': '#6b7280', 'tertiaryColor': '#ffffff', 'background': '#ffffff'}}}%%
flowchart TB
    n_best("Best match") --> n_operationLink("Canonical operation link")
    n_operationLink --> n_sessionIdentity("Stable session + tool-call identity")
    n_sessionIdentity --> n_providerIdentity("Provider-projected request identity")
    n_providerIdentity --> n_bad("Local guesses")

    classDef green fill:#B4E6C8,stroke:#8FB9A2,color:#1f2937,stroke-width:1px;
    classDef orange fill:#FFD2AA,stroke:#D7AE89,color:#1f2937,stroke-width:1px;

    class n_best,n_operationLink,n_sessionIdentity,n_providerIdentity green;
    class n_bad orange;
```

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

## Failure modes

| Symptom | Likely cause |
|---|---|
| Prompt disappears after reconnect | Interaction was transient, not canonical |
| Shortcut cannot resolve the pending request | UI re-looked up a narrower identity path than the rendered interaction |
| Permission attaches to wrong tool | Association used heuristic timing or text instead of canonical linkage |
| Plan approval is visible in one surface but not another | Multiple render paths are not reading the same interaction state |

## Reconnect consequence

If interactions are canonical:

- blocked operations remain blocked after reconnect,
- pending prompts can re-render correctly,
- keyboard shortcuts and action buttons can resolve the same pending interaction,
- late-arriving operation data can still attach to the existing gate.

If interactions are not canonical, reconnect becomes a race between UI timing and transport timing.
