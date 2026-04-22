# Acepe Concepts

This section is the **architecture reference** for Acepe's core product concepts.

It also acts as the closest thing this repository has to a local architecture wiki: if there is no separate wiki tree, these pages are the canonical long-form concept surface.

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

## Core concepts

- [Session graph](./session-graph.md) — the canonical product-state model
- [Session lifecycle](./session-lifecycle.md) — the seven-state authority model, public flows, and recovery semantics
- [Operations](./operations.md) — durable runtime work state
- [Interactions](./interactions.md) — permissions, questions, and approvals
- [Reconnect and resume](./reconnect-and-resume.md) — how state survives reopen, reconnect, and refresh

## Related references

- [`docs/solutions/architectural/revisioned-session-graph-authority-2026-04-20.md`](../solutions/architectural/revisioned-session-graph-authority-2026-04-20.md)
- [`docs/solutions/architectural/provider-owned-semantic-tool-pipeline-2026-04-18.md`](../solutions/architectural/provider-owned-semantic-tool-pipeline-2026-04-18.md)
- [`docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md`](../solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md)
