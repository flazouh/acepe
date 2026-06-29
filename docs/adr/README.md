# Architecture Decision Records

Each file records **one** significant architectural decision: the context, the decision, and the consequences. ADRs are **append-only** — never edit an accepted record to reflect a new decision. Instead write a new ADR that supersedes it, and update the old one's `Status` to `Superseded by ADR-NNNN`.

Read the ADRs that touch an area **before** working in it (see `CLAUDE.md` → Architecture). Write a new ADR when you make a significant or hard-to-reverse choice: a new abstraction, an error-handling standard, a data-flow change.

## Format

```markdown
# ADR-NNNN: <short title>

## Status
Proposed | Accepted | Superseded by ADR-NNNN | Deprecated

## Context
The forces at play; what makes this a real decision.

## Decision
What we will do.

## Consequences
What gets better, what gets worse, what we now owe.
```

## Index

- [ADR-0001](0001-neverthrow-not-effect.md) — Keep neverthrow for TS error handling; do not adopt Effect
- [ADR-0002](0002-composed-sub-stores-for-reactive-decomposition.md) — Decompose god reactive stores into composed sub-stores, not free functions
- [ADR-0003](0003-dom-authority-transcript-viewport.md) — Use DOM-authority scrolling for the transcript viewport
