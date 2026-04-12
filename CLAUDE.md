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
8. **Prefer skill entry points** over direct subagent invocation. Skills own orchestration, agent selection, and review posture.
9. **If a skill is unavailable**, follow the same phase manually. Never skip a phase because the skill isn't loaded.

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
- NEVER use spread syntax (`...obj`) — explicitly enumerate properties for provenance tracking.
- ALWAYS run `bun run check` after TypeScript changes.

### Svelte 5

- ALWAYS invoke Svelte skills before modifying/creating Svelte code: `svelte-runes`, `svelte-components`, `sveltekit-structure`, `sveltekit-data-flow`.
- NEVER use `$effect`. Use `$derived` for computed values, event handlers for actions. If unavoidable, guard writes with comparison.
- ALL new UI components must be dumb/presentational in `packages/ui`. No Tauri, store, runtime, or app-specific logic — they must be reusable from `@acepe/ui`.

### Architecture

- Suggest architecture overhauls when you find recurring smells, leaky provider logic, or brittle abstractions.
- Do not preserve a bad pattern just because it is widespread. Prefer durable, tested abstractions grounded in real product needs.

#### Agent Panel MVC Separation

The agent panel follows a View–Model–Controller split across packages:

| Layer | Package | Role |
|-------|---------|------|
| **View** | `@acepe/ui` (`packages/ui/src/components/agent-panel/`) | Presentational components. Accept model data + callbacks via props. No Tauri, stores, or app-specific logic. Enforced by `agent-panel-architecture.test.ts`. |
| **Model** | `desktop-agent-panel-scene.ts` | Pure function mapper. Converts desktop domain types (SessionEntry, ToolCall, etc.) into `AgentPanelSceneModel`. |
| **Controller** | `agent-panel.svelte` (monolith) | Reads stores, builds model, routes actions, provides snippet overrides for platform-specific content (terminal, browser, virtualized scroll). |
| **Scene** | `AgentPanelScene` (`packages/ui/src/components/agent-panel-scene/`) | Convenience renderer. Maps `AgentPanelSceneModel` to `AgentPanel` shell slots. Accepts snippet overrides for platform content. |

**Key rules:**
- New UI for the agent panel goes in `@acepe/ui` as a presentational component with prop-based data. Labels as props, not i18n imports.
- The composer view also follows this rule: composer leaf controls, selector rows, metrics, and dropdown shells live in `@acepe/ui`, while desktop keeps the controller/state adapters in `agent-input-ui.svelte` and related wrappers.
- `packages/website` renders `@acepe/ui` components with mock data — proves the view layer works independently.
- Domain controllers (`modified-files-header`, `review-content`) may access domain-specific stores but should compose `@acepe/ui` sub-components for rendering.
- Desktop wrappers that only add store access should accept data as optional props with store fallback, so they work without stores when rendered from a parent that already has the data.

### Debugging

- Separate facts from inference. Label hypotheses. Prefer instrumentation or observed state transitions before claiming causality.

## Operational Guardrails

- NEVER run `bun dev` — the user manages the dev server.
- NEVER run `git stash` without explicit user consent.

## Detailed Guides

- [TypeScript Conventions](.agent-guides/typescript.md)
- [Svelte 5 Patterns](.agent-guides/svelte.md)
- [Rust/Tauri Development](.agent-guides/rust-tauri.md)
- [Neverthrow Error Handling](.agent-guides/neverthrow.md)
- [i18n (Paraglide)](.agent-guides/i18n.md)
- [Code Quality](.agent-guides/code-quality.md)
