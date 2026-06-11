# Acepe — Domain Context

The glossary and architectural narrative for Acepe. Skills (`improve-codebase-architecture`, `diagnose`, `tdd`, `ce-decompose`) read this to learn the project's vocabulary. When you name a concept — in a type, file, test, ADR, or proposal — use the term as defined here. If the concept you need is missing, that's a signal: either reconsider (you may be inventing language the project doesn't use) or add it (a real gap). Don't drift to synonyms.

> Status: **v0 bootstrap.** Grounded in `CLAUDE.md` and the current package layout. Extend and sharpen via `grill-with-docs` as decisions crystallise.

## What Acepe is

A Tauri 2 + SvelteKit 2 + Svelte 5 desktop app for driving AI coding agents via the **Agent Client Protocol**. The product goal is a production-grade Agentic Developer Environment: run, supervise, compare, and ship work from multiple agents without giving up engineering discipline.

## How truth flows (the core narrative)

```
Provider (Claude, etc.)  →  Rust adapters / history parsers  →  Canonical model (Rust-owned truth)
                                                                          │
                                                                          ▼
                                              Scene model (pure mapper, TS)  →  View (@acepe/ui)
```

Truth is **owned by canonical, Rust-side data**. Provider output is *input*, not product truth. Everything downstream (TypeScript, `@acepe/ui`) consumes canonical facts; it does not repair provider quirks. Bugs are fixed by **moving truth upstream**, never by patching the projection downstream. This principle is the GOD Architecture Gate (see `CLAUDE.md`).

## Glossary

### Protocol & session
- **Agent Client Protocol (ACP)** — the protocol Acepe speaks to coding agents. Provider-specific quirks are pushed to adapters at the edges.
- **Provider** — a concrete agent backend (e.g. Claude). Provider data is input, normalized by Rust adapters.
- **Adapter / history parser** — Rust-side component that normalizes raw provider data into the canonical model. The only place provider weirdness is allowed to live.
- **Session** — a unit of agent interaction with a lifecycle and hot state. Session-shaped data paths are GOD-gated.

### Canonical model
- **Canonical model** — the Rust-owned source of truth: canonical event order, identity, and tool-call mapping. The product's durable internal model, independent of any provider.
- **Canonical transcript** — the ordered, canonical record of a session's events. Transcript **order** and **identity** are corrected here, never in the UI.
- **Display entry** — a UI-facing item projected from the canonical transcript.
- **Display id** — an Acepe-owned identifier for UI identity. Raw provider ids (e.g. Claude `message.id`) are **metadata**, not identity, unless the canonical model explicitly promotes them.
- **Tool call / tool operation** — a single agent tool invocation and its lifecycle, mapped canonically.

### Agent panel (MVC)
- **Agent panel** — the primary surface that renders a session. Split View–Model–Controller across packages (see `CLAUDE.md` for the enforced table).
  - **View** — presentational components in `@acepe/ui` (`packages/ui/src/components/agent-panel/`). No Tauri, stores, or app logic.
  - **Scene model (`AgentPanelSceneModel`)** — the contract between Model and View; defined in `packages/agent-panel-contract/`.
  - **Model / scene mapper** — focused modules mapping desktop domain types → scene entry/strip/card models; composed by the materializer (`agent-panel-graph-materializer.ts`). `desktop-agent-panel-scene.ts` is a re-export barrel for those modules.
  - **Controller** — `agent-panel.svelte` (desktop): reads stores, builds the model, routes actions, supplies platform-specific snippet overrides.
  - **Scene** (`AgentPanelScene`) — convenience renderer mapping a `AgentPanelSceneModel` to the `AgentPanel` shell slots.
- **Materializer** — builds canonical agent-panel state from session state (`agent-panel-graph-materializer.ts` / `createAgentPanelGraphMaterializerReadModel`). Production scene-assembly spine; canonical; GOD-gated.
- **Spine** — the thin, readable service/controller file that names and orders the focused units it composes. For agent-panel scene assembly, the spine is the graph materializer; `desktop-agent-panel-scene.ts` is a re-export hub, not the spine. Every decomposition leaves one; fragments without a spine are shrapnel.
- **Sub-store** — a class owning a *disjoint slice* of a reactive store's `$state`/Maps plus the methods over it. The unit a god reactive store decomposes into (see ADR-0002). Distinct from a pure-helper module: a sub-store holds state, a helper does not.
- **Composition root / store facade** — the residual parent store after decomposition: holds sub-store instances and delegates its public interface to them in one-liners, preserving the external contract. Cross-slice reads flow through **accessor-closure dependencies**, never dual-ownership.

### Workspace concepts
- **Worktree** — an isolated git worktree used for parallel agent work / review.
- **Composer** — the message-input surface (editor, toolbar, selectors). Follows the same View/controller split as the panel.
- **Review workspace** — the surface for reviewing an agent's changes: modified files, diffs, PR card.
- **Permission** — a gate where the agent requests approval for an action before proceeding.

## Conventions that shape the language

- **TypeScript:** errors are values, not throws — `neverthrow` `Result`/`ResultAsync` everywhere (see ADR-0001). No `try/catch`, no `any`/`unknown`, no spread for provenance.
- **Svelte 5:** runes; no `$effect`; UI components are dumb/presentational in `@acepe/ui`.
- **Right-size by cohesion:** one responsibility per file, composed from a spine. See `CLAUDE.md` → Architecture.
