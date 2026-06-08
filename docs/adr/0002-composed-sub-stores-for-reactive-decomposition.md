# ADR-0002: Decompose god reactive stores into composed sub-stores, not free functions

## Status
Accepted — 2026-06-08

## Context
Acepe accumulated several monolithic reactive units — the agent-panel controller (`agent-panel.svelte`), `agent-panel-graph-materializer.ts`, and the `SessionStore` god class (`session-store.svelte.ts`, ~3,130 LOC / 141 methods implementing `SessionEventHandler` / `ISessionStateReader` / `ISessionStateWriter`). The decomposition effort needed a repeatable, behavior-preserving way to shrink them.

Two distinct shapes emerged, and conflating them caused a regression:

- **Pure helpers** (snapshot merge, transcript-delta, index maps, config sanitization) are stateless transforms. These extract cleanly into free-function modules and re-import — zero blast radius. The helper layer did exactly this (5,409 → 3,997 LOC, 7 modules).
- **`this`-bound reactive state** (`$state` fields, per-session projection `SvelteMap`s, and the methods that read/write them) does **not**. You cannot relocate those methods into free functions without either threading state through every call site or breaking encapsulation. A first attempt to move session-list state into a free-function-style `SessionListStore` broke 7 invariant tests in `session-store-rename.vitest.ts` that were coupled to the internal field access path — caught by the net, reverted clean.

We also validated the target shape against production prior art. [GitButler](https://github.com/gitbutlerapp/gitbutler) (the closest stack twin — Tauri 2 + SvelteKit + Svelte 5 + Rust) explicitly **avoids monolithic stores**: a central `ClientState` composes concern-scoped services (each owning its own slice), tracks root state via Svelte 5 `$state.raw`, and colocates domain APIs with the state they own. That is the same composition shape, independently arrived at.

## Decision
When decomposing a reactive store (a `.svelte.ts` class owning `$state`/reactive Maps):

1. **Extract pure helpers first** as free-function modules (re-import, verbatim bodies). Exhaust these before touching stateful methods.
2. **Decompose remaining state into composed sub-stores**, not free functions. Each sub-store is a class that **owns a disjoint slice** of the parent's reactive state plus the methods that read/write it.
3. **The parent becomes a thin composition root**: it holds sub-store instances (`readonly #list = new SessionListState(deps)`) and delegates. Cross-slice reads are passed as **accessor-closure dependencies** (mirroring `AgentPanelSessionController`'s pattern), never by dual-ownership.
4. **Preserve the public interface as one-line delegations.** The external contract (`ISessionStateReader/Writer`, consumed by ~41 files) does not change; only the internal composition does.
5. **Treat it as design-level work, not mechanical extraction.** Baseline a characterization/behavioral test net *before* moving anything, keep it green between each sub-store, and do it in a focused session. The mechanical extraction loop that worked for helpers is insufficient here.

This is the same pattern already proven on the agent-panel controller (reactive clusters → testable controllers). It is the standing approach for `SessionStore` (see `docs/plans/2026-06-08-002-refactor-session-store-class-decomposition-plan.md`).

## Consequences
- **Sub-stores become independently unit-testable** — construct with stub deps, assert the slice's behavior. The logic was untestable inside the monolith.
- **GOD invariants must hold per sub-store**: slices are disjoint (no field owned by two stores), no `canonical ?? hot` fallback, no dual-write, no provider branching or transcript-order repair introduced. A sub-store reads canonical facts only.
- **Tests coupled to internal field paths are a hazard.** Invariant tests that assert *how* state is stored (not *what* behavior results) break under this refactor and must be rewritten behaviorally before extraction — or they produce false regressions.
- The canonical-heart slices (e.g. `SessionProjectionCore`) carry the highest risk; each gets its own GOD re-gate and may warrant its own sub-plan rather than riding along with low-risk slices.
- We accept a thin delegation layer on the parent (one-liners) as the cost of preserving the external contract with zero consumer churn.

## References
- Prior art: GitButler `apps/desktop/src/lib` — concern-scoped services composed by `ClientState`, `$state.raw` at the seam ([repo](https://github.com/gitbutlerapp/gitbutler), [state-management overview](https://deepwiki.com/gitbutlerapp/gitbutler/3.3-mcp-internal-server)). Adopt the *decomposition shape*, not its Redux/RTK Query backing — that fights our canonical-Rust-owned model and neverthrow.
- Companion reference for the canonical/ACP side: [Zed](https://github.com/zed-industries/zed) (authors of the Agent Client Protocol).
- Plan: `docs/plans/2026-06-08-002-refactor-session-store-class-decomposition-plan.md`.
