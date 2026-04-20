# Acepe Concepts

This section is the **architecture reference** for Acepe's core product concepts.

```mermaid
%%{init: {'theme':'base','flowchart': {'curve': 'basis', 'nodeSpacing': 28, 'rankSpacing': 34}, 'themeVariables': {'fontFamily': 'Inter, ui-sans-serif, system-ui', 'primaryTextColor': '#1f2937', 'primaryBorderColor': '#9ca3af', 'lineColor': '#6b7280', 'tertiaryColor': '#ffffff', 'background': '#ffffff'}}}%%
flowchart TD
    n_provider("Provider signal") --> n_projection("Backend projection")
    n_projection --> n_sessionGraph("Canonical session graph")
    n_sessionGraph --> n_operations("Operations")
    n_sessionGraph --> n_interactions("Interactions")
    n_operations --> n_stores("Desktop stores")
    n_interactions --> n_stores
    n_stores --> n_views("UI selectors / views")

    classDef blue fill:#B4D2F0,stroke:#8BA7C0,color:#1f2937,stroke-width:1px;
    classDef green fill:#B4E6C8,stroke:#8FB9A2,color:#1f2937,stroke-width:1px;
    classDef yellow fill:#FFEBB4,stroke:#D8C58E,color:#1f2937,stroke-width:1px;
    classDef orange fill:#FFD2AA,stroke:#D7AE89,color:#1f2937,stroke-width:1px;
    classDef purple fill:#D2BEF0,stroke:#A999C4,color:#1f2937,stroke-width:1px;

    class n_provider,n_projection blue;
    class n_sessionGraph purple;
    class n_operations,n_interactions green;
    class n_stores yellow;
    class n_views orange;
```

Use it when you need to answer questions like:

- What is the canonical session graph?
- What is an operation versus an interaction?
- What is transcript history allowed to own?
- How should reconnect and resume rebuild state?
- Where is provider-specific logic allowed to live?

## How to use these docs

Treat these pages as the **source of truth for intended architecture**, not as loose notes.

When code and concepts disagree:

1. assume the concept doc describes the intended model,
2. confirm the code path and the mismatch,
3. update the code to match the concept or explicitly revise the concept doc in the same change.

The goal is to stop the codebase from drifting into multiple hidden authorities.

## Mental model

| Concept | What it is | What it is not |
|---|---|---|
| Session graph | The canonical product-state model for a session | A loose cache of whatever the UI last saw |
| Transcript | Renderable conversation history | The sole authority for runtime tool state |
| Operation | Durable runtime work record | Just a prettified transcript tool row |
| Interaction | Durable decision/input gate | A transient popup owned by a component |
| Reconnect/resume | Rehydration of canonical state | A best-effort replay of raw transport events |

## Core concepts

| Page | Focus | Read when |
|---|---|---|
| [Session graph](./session-graph.md) | Overall ownership model | You need to know what is authoritative |
| [Operations](./operations.md) | Durable runtime work state | You are touching tool execution or lifecycle |
| [Interactions](./interactions.md) | Permissions, questions, approvals | You are touching blocked/awaiting-user flows |
| [Reconnect and resume](./reconnect-and-resume.md) | Restore and survival rules | You are debugging reopen/reconnect drift |

## Canonical ownership at a glance

| Surface | Canonical owner |
|---|---|
| Transcript history | `SessionEntryStore` materialized from the session graph |
| Runtime work | `OperationStore` |
| Human / policy gates | Interaction, permission, and question stores |
| Session truth stream | Revisioned session graph envelopes |
| UI rendering | Selectors over canonical stores |

| If you are asking... | Look here first |
|---|---|
| "What is the current tool?" | Operation-backed selectors |
| "Why is this blocked?" | Interaction + operation linkage |
| "What should survive reopen?" | Session graph + restore model |
| "Can the UI infer this from transcript?" | Usually no; check ownership docs |

## Related references

- [`docs/solutions/architectural/revisioned-session-graph-authority-2026-04-20.md`](../solutions/architectural/revisioned-session-graph-authority-2026-04-20.md)
- [`docs/solutions/architectural/provider-owned-semantic-tool-pipeline-2026-04-18.md`](../solutions/architectural/provider-owned-semantic-tool-pipeline-2026-04-18.md)
- [`docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md`](../solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md)
