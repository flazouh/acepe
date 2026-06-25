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
9. **Do not normalize partial implementation as an acceptable endpoint.** While executing `/ce:work`, continue until the planned slice is actually wired end-to-end and verified. Do not frame "still in progress" as a valid completion state when the requested implementation has not yet been delivered.
10. **Prefer skill entry points** over direct subagent invocation. Skills own orchestration, agent selection, and review posture.
11. **If a skill is unavailable**, follow the same phase manually. Never skip a phase because the skill isn't loaded.

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
- Invoke **`extract-to-ui-package`** before extracting or moving UI into `@acepe/ui` (MVC: View in `packages/ui`, Model/Controller in desktop). Enforcement: `scripts/forbid-ui-package-imports.ts` + `packages/ui/src/__tests__/ui-package-boundary.test.ts`.

### Architecture

- Suggest architecture overhauls when you find recurring smells, leaky provider logic, or brittle abstractions.
- Do not preserve a bad pattern just because it is widespread. Prefer durable, tested abstractions grounded in real product needs.
- Do not frame work as a migration, coexistence plan, or cutover strategy. Assume speed-of-light execution: design and plan for the clean replacement architecture directly, with old paths removed rather than accommodated in parallel.
- Historical session open MUST reconnect after snapshot hydration. Never fix replay or unresolved-tool bugs by making historical sessions read-only. Correct boundary: provider history/disk parsing owns already-restored transcript content; reconnect attaches live transport and may deliver only post-frontier events through the open-token reservation. If replay is wrong, fix token/frontier/reconciliation in the backend.

#### GOD Architecture Gate

- Always invoke `god-architecture-check` before changing session-shaped or transcript-shaped data paths: session lifecycle, hot state, canonical projections, transcript order, tool operations, provider history parsing, agent-panel projection, or display entry identity.
- Keep asking during implementation: "Is this change moving truth upstream into canonical Rust-owned data, or patching symptoms downstream?" If it patches downstream, stop and use the GOD check before continuing.
- Raw provider data is input, not product truth. Provider quirks belong in Rust adapters/history parsers; TypeScript and `packages/ui` must consume canonical facts, not repair provider-specific weirdness.
- For transcript bugs, never fix order in the UI. Canonical transcript order, identity, and tool-call mapping must be corrected before display projection.
- Treat raw provider ids, such as Claude `message.id`, as metadata unless the canonical model explicitly promotes them. Use canonical event order and Acepe-owned display ids for UI identity.

### Debugging

- Separate facts from inference. Label hypotheses. Prefer instrumentation or observed state transitions before claiming causality.

### Visual QA

- ALWAYS invoke the `acepe-dev-app-qa` skill before inspecting the Acepe desktop dev app, current dev app, Tauri WebView, session display, agent panel, or any UI-visible Acepe change.
- **After every change that could affect what the user sees** — desktop Svelte/TS/CSS, `@acepe/ui`, or Rust on session/transcript/display paths — run **DOM verification through the repo QA CLI** before calling the work done. Unit tests and `bun run check` are not sufficient on their own.
- **Required QA CLI pass** (from `packages/desktop`): `bun run qa doctor` → open or observe the affected screen (`bun run qa observe`) → **`bun run qa inspect --selector=<selector>`** on the element or region that proves the change → `bun run qa screenshot` when the change is visual or layout-related. Use `bun run qa click`, `send`, or `watch` when the fix is interaction-driven.
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
