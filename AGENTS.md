# Acepe

Tauri 2 + SvelteKit 2 + Svelte 5 desktop app for AI agent interaction via Agent Client Protocol.

## Project Vision

Acepe is a **production-grade Agentic Developer Environment**: a native workspace where developers run, supervise, compare, and ship work from multiple coding agents without giving up engineering discipline.

Trend toward:

- **Agent-agnostic architecture** — provider-specific quirks pushed to adapters and edges
- **Production-grade reviewability** — tool calls, permissions, diffs, checkpoints, PR-ready changes
- **Reliable long-running workflows** — serious project work, not one-off demos
- **Durable internal models** — add or replace agents without rewriting the product

## Quick Reference

**Package manager:** `bun` (not `npm`)

```bash
cd packages/desktop
bun run check      # TypeScript check (run after every TS change)
bun test           # Tests
bun run build      # Build
cargo clippy       # Rust lint (in src-tauri/)
```

**Git hooks (Lefthook):** `bun install` runs `lefthook install`. Pre-commit = Biome on staged files + cheap forbids. Pre-push = path-aware CI mirror (`scripts/git-hooks/pre-push-affected.ts`). Override locally with `lefthook-local.yml` (gitignored).

**Artifact paths:**

| Type | Location |
|------|----------|
| Requirements | `docs/brainstorms/YYYY-MM-DD-<topic>-requirements.md` |
| Plans | `docs/plans/YYYY-MM-DD-<topic>-plan.md` |
| Learnings | `docs/solutions/` |

`docs/solutions/` stores documented solutions to past problems (bugs, best practices, workflow patterns), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`). Relevant when implementing or debugging in documented areas.

## Coding Conventions

### TypeScript

- NEVER use `try/catch` — use `neverthrow` `ResultAsync`.
- NEVER use `any` or `unknown` — use proper types or Zod for validation.
- NEVER use spread syntax (`...obj`) — explicitly enumerate properties for provenance tracking. **Carve-out:** spread is permitted in shape-preserving transformers `(x: T): T` to clone before applying explicit per-field overrides (see `.agent-guides/typescript.md`, "Explicit Over Implicit"). The criterion is *same declared type on both sides*; merges, partial patches, building new shapes, and loop accumulators are still forbidden.
- ALWAYS run `bun run check` after TypeScript changes.

### Svelte 5

- ALWAYS invoke Svelte skills before modifying/creating Svelte code: `svelte-runes`, `svelte-components`, `sveltekit-structure`, `sveltekit-data-flow`.
- NEVER use `$effect`. Use `$derived` for computed values, event handlers for actions. If unavoidable, guard writes with comparison.
- ALL new UI components must be dumb/presentational in `packages/ui`. No Tauri, store, runtime, or app-specific logic — they must be reusable from `@acepe/ui`. See "UI Package MVC" below for the extraction workflow and enforcement.

### Architecture

Acepe optimizes for two readers: the engineer and the agent. Code must be **AI-navigable** (find the right unit fast, understand it in one read) and **testable by construction**. Architecture work means **deepening the model, not patching symptoms**.

- **Ground every change in the domain language.** `CONTEXT.md` is the glossary; name files, types, tests, and proposals with its vocabulary. A concept missing from the glossary is a signal — either you're inventing language the project doesn't use (reconsider), or there's a real gap (add it). Don't drift to synonyms.
- **Record decisions, read them first.** Read `docs/adr/` before working in an area. When you make a significant or hard-to-reverse architectural choice (a new abstraction, an error-handling standard, a data-flow change), write an ADR.
- **Deepen, don't patch.** On recurring smells, leaky provider logic, or brittle abstractions, move truth upstream into canonical, named concepts. Do not preserve a bad pattern because it is widespread. Prefer durable, tested abstractions grounded in real product needs.
- **Right-size by cohesion, not line count.** One responsibility per file: extract types, pure functions, and services into focused units, composed from a thin, readable spine (the service/controller that names and orders them). Consolidate tightly-coupled fragments; separate weakly-related ones. ~200–300 LOC is a smell trigger to ask "is this still one cohesive thing?", never an automatic splitter — fragmentation without a spine is as harmful as a monolith.
- **Suggest overhauls proactively.** When you find structural decay, propose the deepening — don't route around it.
- Do not frame work as a migration, coexistence plan, or cutover strategy. Assume speed-of-light execution: design and plan for the clean replacement architecture directly, with old paths removed rather than accommodated in parallel.
- Historical session open MUST reconnect after snapshot hydration. Never fix replay or unresolved-tool bugs by making historical sessions read-only. Correct boundary: provider history/disk parsing owns already-restored transcript content; reconnect attaches live transport and may deliver only post-frontier events through the open-token reservation. If replay is wrong, fix token/frontier/reconciliation in the backend.

#### GOD Architecture Gate

- Always invoke `god-architecture-check` before changing session-shaped or transcript-shaped data paths: session lifecycle, hot state, canonical projections, transcript order, tool operations, provider history parsing, agent-panel projection, or display entry identity.
- Keep asking during implementation: "Is this change moving truth upstream into canonical Rust-owned data, or patching symptoms downstream?" If it patches downstream, stop and use the GOD check before continuing.
- Raw provider data is input, not product truth. Provider quirks belong in Rust adapters/history parsers; TypeScript and `packages/ui` must consume canonical facts, not repair provider-specific weirdness.
- For transcript bugs, never fix order in the UI. Canonical transcript order, identity, and tool-call mapping must be corrected before display projection.
- Treat raw provider ids, such as Claude `message.id`, as metadata unless the canonical model explicitly promotes them. Use canonical event order and Acepe-owned display ids for UI identity.

#### UI Package MVC

Shared UI follows a View–Model–Controller split across packages. **Invoke `extract-to-ui-package`** before moving UI into `@acepe/ui`.

| Layer | Package | Role |
|-------|---------|------|
| **View** | `@acepe/ui` (`packages/ui/`) | Presentational components. Props, callbacks, snippets. Optional view helpers (`*-state.ts`, `*-effects.ts`). No Tauri, stores, or app-specific policy. |
| **Model** | `packages/desktop` pure TS | Maps domain types to view props (`*-state.ts`, `*-logic.ts`, scene mappers). |
| **Controller** | `packages/desktop` wrapper `.svelte` | Reads stores/Tauri, builds Model output, renders View, handles callbacks. |

**Enforcement:** `scripts/forbid-ui-package-imports.ts` + `packages/ui/src/__tests__/ui-package-boundary.test.ts` (import guard + render smoke).

**Agent panel** is the richest example; same MVC applies to sidebar, git panel, kanban, checkpoint, etc. See `.github/skills/extract-to-ui-package/references/pattern-catalog.md`.

**Key rules:**
- New shared UI goes in `@acepe/ui` with prop-based data. Pass user-visible copy via props (English from host or literals in shared UI).
- Composer leaf controls, selector rows, and dropdown shells live in `@acepe/ui`; desktop keeps Controller adapters in `agent-input-ui.svelte` and related wrappers.
- `packages/website` renders `@acepe/ui` with mock data — proves View works independently.
- Domain controllers may access stores but must compose `@acepe/ui` sub-components for rendering.
- Desktop wrappers that only add store access should accept optional props with store fallback.

### Debugging

- Separate facts from inference. Label hypotheses. Prefer instrumentation or observed state transitions before claiming causality.

### Visual QA

- ALWAYS invoke the `acepe-dev-app-qa` skill before inspecting the Acepe desktop dev app, current dev app, Tauri WebView, session display, agent panel, or any UI-visible Acepe change.
- **After every change that could affect what the user sees** — desktop Svelte/TS/CSS, `@acepe/ui`, or Rust on session/transcript/display paths — run **DOM verification through the repo QA CLI** before calling the work done. Unit tests and `bun run check` are not sufficient on their own.
- **Required QA CLI baseline** (from `packages/desktop`): `bun run qa doctor` → open or observe the affected screen (`bun run qa observe`) → **`bun run qa inspect --selector=<selector>`** on the element or region that proves the change → `bun run qa screenshot` when the change is visual or layout-related.
- **QA evidence must match the bug.** Static DOM inspection is enough only for static visual/style changes. Interaction bugs must run the interaction through `bun run qa click`, `send`, `watch`, or a dedicated QA command, then inspect the resulting DOM/app state. Timing, scroll, streaming, animation, and layout-transition bugs must run a probe that samples the transition after the code change; a static `inspect` or screenshot is not enough.
- If a plan names a QA probe, that probe is mandatory completion evidence. If the needed app/session state is unavailable, report behavioral QA as blocked and say exactly what static evidence was collected; do not rename static DOM inspection as a pass for the behavior.
- Prefer the repo QA wrapper before raw Tauri MCP. Other commands: `bun run qa reset-onboarding`, `bun run qa click --selector=<selector>`, `bun run qa send --text=<message>`, `bun run qa watch --text=<text>`.
- If a QA or app interaction is not extremely smooth, improve the system before repeating the friction: add a wrapper command, helper, hook, skill instruction, or documented primitive so the next pass is easier.
- Any UI-visible code change must be verified **after** the code change, not before. The QA wrapper records `.codex/state/ui-qa-evidence.json`; Codex Stop hooks should block completion when UI files changed after the latest evidence.
- Before interacting with a window, confirm the target is the app/build that contains the change. For dev QA, prefer the running Tauri dev app from this checkout (`target/debug/acepe` / local dev server), not the installed production bundle in `/Applications/Acepe.app`, unless the task is explicitly about the production app.
- For desktop app QA, prefer the Tauri MCP bridge when it is available. Use it to attach to the running dev WebView, inspect the DOM/app state, read console errors, click/type, and capture screenshots inside the Tauri context. A normal browser at `localhost:1420` is not enough for Acepe desktop QA because Tauri APIs like `invoke` are missing there.
- If Tauri MCP is unavailable, first try the running dev Tauri window via Computer Use. Only use a normal browser for routes that are known to work without Tauri APIs, and say clearly that it is browser-only evidence.
- Include the DOM inspection output (selector + observed facts) and screenshot when relevant in the final response.
- If the app or dev server is not available, start it from `packages/desktop` with `bun run tauri`, then run the QA CLI pass; if still blocked, say exactly what was verified and what could not be.

## Operational Guardrails

- NEVER run `git stash` without explicit user consent.
- NEVER set `core.bare=true` in this repository's root `.git/config` or otherwise convert this checkout into a bare repository. If bare-style workflows are needed, use a separate bare mirror or linked worktree instead of changing the active checkout.

## Detailed Guides

- [TypeScript Conventions](.agent-guides/typescript.md)
- [Svelte 5 Patterns](.agent-guides/svelte.md)
- [Rust/Tauri Development](.agent-guides/rust-tauri.md)
- [Neverthrow Error Handling](.agent-guides/neverthrow.md)
- [Code Quality](.agent-guides/code-quality.md)

## Agent skills

### Issue tracker

Issues and PRDs are tracked as GitHub issues on `flazouh/acepe` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical triage label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: read `CONTEXT.md` for Acepe domain language and `docs/adr/` for decisions before working in an area. Both can be extended by `grill-with-docs`. See `docs/agents/domain.md`.

## Local Model Routing

Follow the global delegation policy in `/Users/alex/AGENTS.md` (or the nearest global instructions file). Local project rules in this file still win; do not weaken this repo's TDD, QA, or verification requirements.
