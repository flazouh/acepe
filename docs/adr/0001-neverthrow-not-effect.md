# ADR-0001: Keep neverthrow for TS error handling; do not adopt Effect

## Status
Accepted — 2026-06-07

## Context
While scoping a monolith-decomposition effort, we considered migrating TypeScript code to Effect-TS as part of the same pass. Current reality:

- `neverthrow` is in use across **~220 files**.
- `CLAUDE.md` already mandates it: "NEVER use `try/catch` — use neverthrow `ResultAsync`."
- Effect has **zero** adoption: no imports, not in any `package.json`.

Adopting Effect would be a repo-wide error-handling **architecture switch** that contradicts the existing house standard, not a refactor. Bundled with decomposition it would produce a half-neverthrow / half-Effect codebase and an uncontrollably large diff. No concrete problem with neverthrow was identified that Effect uniquely solves; the motivation was novelty, not pain.

## Decision
- **Keep `neverthrow`** as the TypeScript error-handling and result-composition standard. Do not adopt Effect.
- Decomposition work treats the extraction as the moment to make neverthrow usage **correct**, per the "used properly" bar (discriminated-union error types, convert throws to `Result` at boundaries via `ResultAsync.fromPromise` with a mapper, `map`/`andThen`/`andTee`/`match` used by intent, no `try/catch` or `.catch()` near neverthrow).
- If Effect is reconsidered later, it requires its own brainstorm and a superseding ADR — driven by a concrete, named problem with neverthrow — not an inline migration.

## Consequences
- Decomposition stays **structure-only**; no paradigm shift rides along with it.
- One consistent error-handling model across the ~220 existing files; no mixed-paradigm period.
- The "neverthrow used properly" rules become a review gate during decomposition (reference: vault note `neverthrow-best-practices`; sources — neverthrow wiki *Error Handling Best Practices* and Sólberg, *Practically Safe TypeScript Using Neverthrow*).
- We forgo Effect's Layers/structured-concurrency until a real need is documented.
