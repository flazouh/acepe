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

**Artifact paths:**

| Type | Location |
|------|----------|
| Requirements | `docs/brainstorms/YYYY-MM-DD-<topic>-requirements.md` |
| Plans | `docs/plans/YYYY-MM-DD-<topic>-plan.md` |
| Learnings | `docs/solutions/` |

`docs/solutions/` stores documented solutions to past problems (bugs, best practices, workflow patterns), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`). Relevant when implementing or debugging in documented areas.

## CE Workflow

Acepe uses the Compounding Engineering workflow as its engineering operating system. This is the **single source of truth** — `CLAUDE.md` defers here.

### Flow Diagram

```
                        ┌─────────────────────────────────────┐
                        │         Task arrives                │
                        └──────────────┬──────────────────────┘
                                       │
                              ┌────────▼────────┐
                              │  Trivial task?   │──── yes ──── Direct execution
                              └────────┬────────┘
                                       │ no
                              ┌────────▼────────┐
                              │  Requirements    │
                              │  already clear?  │──── no ───── /ce:brainstorm
                              └────────┬────────┘          docs/brainstorms/
                                       │ yes
                              ┌────────▼────────┐
                              │  Reviewed plan   │
                              │  already exists? │──── no ──┐
                              └────────┬────────┘          │
                                       │ yes               │
                                       │           ┌───────▼───────┐
                                       │           │  /ce:plan     │
                                       │           │  docs/plans/  │
                                       │           └───────┬───────┘
                                       │                   │
                                       │           ┌───────▼────────────┐
                                       │           │  /document-review  │◄──── MANDATORY GATE
                                       │           └───────┬────────────┘
                                       │                   │
                                       │         ┌─────────▼─────────┐
                                       │         │ Unresolved scope? │── yes ── loop to brainstorm
                                       │         └─────────┬─────────┘
                                       │                   │ no
                              ┌────────▼───────────────────▼──┐
                              │  Bug / behavior change /      │
                              │  non-trivial refactor?        │── yes ── TDD: failing test first
                              └────────┬──────────────────────┘
                                       │
                              ┌────────▼────────┐
                              │    /ce:work     │
                              └────────┬────────┘
                                       │
                              ┌────────▼────────┐
                              │   /ce:review    │  (non-trivial work)
                              └────────┬────────┘
                                       │
                              ┌────────▼────────┐
                              │  /ce:compound   │  (meaningful learning)
                              └─────────────────┘
```

### Entry-Point Decision Table

| Situation | Start at |
|-----------|----------|
| Scope, success criteria, or problem framing unclear | `/ce:brainstorm` |
| Requirements exist, no plan yet | `/ce:plan` |
| Reviewed plan exists, matches request | `/ce:work` |
| Bug fix or behavior change | TDD (failing test) then `/ce:work` |
| Non-trivial refactor | `/ce:plan` (refactors are not exempt) |
| Trivial, obvious, no durable plan needed | Direct execution |

### Phase Intent

| Phase | Purpose |
|-------|---------|
| `/ce:brainstorm` | Define **what** to build. Produces a requirements-quality artifact. |
| `/ce:plan` | Define **how** to build it. Decision-complete plan with files, tests, constraints. |
| `/document-review` | Quality gate before code. Catches contradictions, scope drift, weak assumptions. |
| TDD | First executable proof. Failing or characterization test that `/ce:work` turns green. |
| `/ce:work` | Execute the reviewed plan. Code and verification, not inventing behavior. |
| `/ce:review` | Stress-test code changes before shipping. |
| `/ce:compound` | Turn execution-time learning into durable team leverage. |
| `/ce:compound-refresh` | Update learnings when a new fix makes older ones stale. |

### Hard Rules

1. **No skipping the review gate.** `/ce:plan` → `/document-review` → `/ce:work`. Never plan → implement directly.
2. **A plan is not “done” when `/ce:plan` finishes.** It is done after `/document-review` runs and findings are resolved.
3. **Implementation is not “done” when `/ce:work` finishes.** Non-trivial work requires `/ce:review` → resolve findings → `/ce:compound`.
4. **Tests before implementation.** For bugs, behavior changes, and non-trivial refactors: write the failing test first via TDD, then `/ce:work`.
5. **Unresolved scope decisions go back to brainstorm.** If `/document-review` surfaces product ambiguity, loop to `/ce:brainstorm`. Do not bury ambiguity in code.
6. **Headless review for automation.** When reviewing non-interactively: `/document-review mode:headless docs/plans/<plan>.md`.
7. **Implementation plan requests must use `/ce:plan` first.** When asked to create an implementation plan for Acepe, always use the `ce-plan` skill first. Session `plan.md` may mirror or summarize the CE plan, but it must not replace the `/ce:plan` workflow, even when the request explicitly asks for a session plan file or uses `[[PLAN]]`.
8. **Acepe `/ce:plan` uses Deep plan posture.** For Acepe software work, treat `/ce:plan` as a request for a **Deep** plan by default. This is plan-depth guidance, not an automatic trigger for the separate "deepen an existing plan" fast path unless the user explicitly asks to deepen an existing plan, for example with `/ce:plan deepen` or `/ce:plan deepen docs/plans/<plan>.md`.
9. **Prefer skill entry points** over direct subagent invocation. Skills own orchestration, agent selection, and review posture.
10. **If a skill is unavailable**, follow the same phase manually. Never skip a phase because the skill isn't loaded.

### TDD Protocol

- Red-green-refactor: prove the bug/behavior with one failing test → smallest fix to turn green → clean up while green.
- Choose the narrowest valuable test seam. Behavior-focused over implementation-detail.
- NEVER write structural contract tests that `readFileSync` source code and assert on string contents. These break on every refactor and test structure, not behavior. If you need to verify wiring, write a test that exercises the behavior instead.
- For legacy or unclear behavior, write a characterization test first. Do not “improve” behavior without capturing what exists.
- Keep tests single-purpose. One failure = one diagnosis.

## Coding Conventions

### TypeScript

- NEVER use `try/catch` — use `neverthrow` `ResultAsync`.
- NEVER use `any` or `unknown` — use proper types or Zod for validation.
- NEVER use spread syntax (`...obj`) — explicitly enumerate properties for provenance tracking. **Carve-out:** spread is permitted in shape-preserving transformers `(x: T): T` to clone before applying explicit per-field overrides (see `.agent-guides/typescript.md`, "Explicit Over Implicit"). The criterion is *same declared type on both sides*; merges, partial patches, building new shapes, and loop accumulators are still forbidden.
- ALWAYS run `bun run check` after TypeScript changes.

### Svelte 5

- ALWAYS invoke Svelte skills before modifying/creating Svelte code: `svelte-runes`, `svelte-components`, `sveltekit-structure`, `sveltekit-data-flow`.
- NEVER use `$effect`. Use `$derived` for computed values, event handlers for actions. If unavoidable, guard writes with comparison.
- ALL new UI components must be dumb/presentational in `packages/ui`. No Tauri, store, runtime, or app-specific logic — they must be reusable from `@acepe/ui`.

### Architecture

Acepe optimizes for two readers: the engineer and the agent. Code must be **AI-navigable** (find the right unit fast, understand it in one read) and **testable by construction**. Architecture work means **deepening the model, not patching symptoms**.

- **Ground every change in the domain language.** `CONTEXT.md` is the glossary; name files, types, tests, and proposals with its vocabulary. A concept missing from the glossary is a signal — either you're inventing language the project doesn't use (reconsider), or there's a real gap (add it). Don't drift to synonyms.
- **Record decisions, read them first.** Read `docs/adr/` before working in an area. When you make a significant or hard-to-reverse architectural choice (a new abstraction, an error-handling standard, a data-flow change), write an ADR.
- **Deepen, don't patch.** On recurring smells, leaky provider logic, or brittle abstractions, move truth upstream into canonical, named concepts. Do not preserve a bad pattern because it is widespread. Prefer durable, tested abstractions grounded in real product needs.
- **Right-size by cohesion, not line count.** One responsibility per file: extract types, pure functions, and services into focused units, composed from a thin, readable spine (the service/controller that names and orders them). Consolidate tightly-coupled fragments; separate weakly-related ones. ~200–300 LOC is a smell trigger to ask "is this still one cohesive thing?", never an automatic splitter — fragmentation without a spine is as harmful as a monolith.
- **Suggest overhauls proactively.** When you find structural decay, propose the deepening — don't route around it.

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

- Invoke `acepe-dev-app-qa` before any desktop UI inspection.
- After every UI-affecting change, run DOM verification through the QA CLI (`packages/desktop`): `bun run qa doctor` → `bun run qa observe` → **`bun run qa inspect --selector=<selector>`** → `bun run qa screenshot` when visual. Do not ship UI work verified by tests alone.
- Start `bun dev` from `packages/desktop` if the dev app is not running.

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

Canonical triage label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — `CONTEXT.md` (domain glossary) + `docs/adr/` (decision log) at the repo root. Read `CONTEXT.md` before naming concepts and `docs/adr/` before working in an area; both are extended by `grill-with-docs`. See `docs/agents/domain.md`.

<!-- test line: added 2026-06-18 -->

<!-- BEGIN fable-codex-orchestration -->
## Local Model Routing

Follow the global Fable/Opus/Sonnet/Codex routing in `/Users/alex/.claude/CLAUDE.md`.

- Fable 5 leads: plan, delegate, synthesize.
- `deep-reasoner` (Opus) handles hard architecture, debugging, algorithms, and high-stakes trade-offs.
- `fast-worker` (Sonnet) handles mechanical edits, tests, formatting, and repetitive work.
- Codex is a peer senior engineer for fresh perspective, strong implementation, computer use, UI/UX verification, and efficient well-scoped execution.

Local project rules in this file still win. Do not weaken CE, TDD, QA, or verification requirements.
<!-- END fable-codex-orchestration -->
