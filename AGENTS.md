# Acepe

Tauri 2 + SvelteKit 2 + Svelte 5 desktop app for AI agent interaction via Agent Client Protocol.

## Package Manager

`bun` (not `npm`)

## Commands

```bash
cd packages/desktop
bun run check      # TypeScript check
bun test           # Tests
bun run build      # Build
cargo clippy       # Rust lint (in src-tauri/)
```

## Critical Rules

- Acepe standardizes on the Compounding Engineering workflow for non-trivial engineering work.
- ALWAYS fix bugs with TDD: write a focused failing test or characterization first, verify it fails, then implement the minimal fix and rerun the test.
- Follow the red-green-refactor loop deliberately: first prove the bug or missing behavior with one failing test, then make the smallest change that turns it green, then clean up while keeping tests green.
- Choose the narrowest valuable test seam. Prefer behavior-focused tests over implementation-detail assertions, and only drop to structural contract tests when the invariant is about wiring or ownership.
- For legacy or unclear behavior, write a characterization test first before changing code. Do not “improve” behavior without first capturing what the system currently does or what the user explicitly wants.
- Keep tests single-purpose. Avoid mixing unrelated assertions into one failure because it makes diagnosis and iteration slower.
- NEVER run `bun dev` - the user manages the dev server.
- NEVER run `git stash` without explicit user consent - stashing can hide in-progress work.
- When debugging, separate facts from inference. Do not present an inferred root cause as fact. Label hypotheses clearly and prefer instrumentation or observed state transitions before claiming causality.
- NEVER use `try/catch` in TypeScript - use `neverthrow` `ResultAsync`.
- NEVER use `any` or `unknown` - use proper types or Zod for validation.
- ALWAYS run `bun run check` when you make TypeScript changes.
- ALWAYS invoke the Svelte skills before modifying or creating Svelte code: `svelte-runes`, `svelte-components`, `sveltekit-structure`, `sveltekit-data-flow`.
- ALL new UI components must be dumb/presentational and live in `packages/ui`. Keep Tauri, store, runtime, and app-specific orchestration out of those components so they can be exported from `@acepe/ui` and reused by both `packages/desktop` and `packages/website`.
- NEVER use `$effect` in Svelte 5 components. Effects create causal loops when they read and write connected state. Use `$derived` for computed values and event handlers for actions. If an effect is unavoidable, guard writes with comparison.
- NEVER use spread syntax (`...obj`). Explicitly enumerate properties so data flow stays obvious and TypeScript can track provenance.

## Required Workflow

Acepe uses the Compounding Engineering plugin as its default engineering operating system. Use the workflow skills as the primary entry points. If a specific skill is unavailable in the current runtime, follow the same phase manually rather than skipping the phase.

### Default Flow

1. Use `/ce:brainstorm` when problem framing, scope, or success criteria are not already settled. Capture or update a requirements doc in `docs/brainstorms/`.
2. Use `/ce:plan` once the intended behavior is clear enough to define implementation. Capture or update a plan in `docs/plans/`.
3. Use `/document-review` immediately after the plan draft is complete. This review gate is mandatory for any plan you create or materially revise.
4. Use `/ce:work` only after the reviewed plan is ready for execution.
5. Use `/ce:review` before shipping non-trivial or risky changes.
6. Use `/ce:compound` after solving a meaningful bug or landing a non-obvious implementation so the learning is preserved.
7. Use `/ce:compound-refresh` when a new fix makes older learnings stale, contradictory, or incomplete.

### Enforcement Rules

- Do not jump from planning straight into implementation. The review gate between `/ce:plan` and `/ce:work` is `/document-review`.
- A plan is not "done" when `/ce:plan` finishes drafting it. A plan is done only after `/document-review` has run and either the auto-fixes have been applied or the remaining judgment calls have been resolved explicitly.
- If a current requirements doc already exists, start at `/ce:plan` instead of re-brainstorming.
- If a reviewed plan already exists and still matches the request, start at `/ce:work`.
- If a request is genuinely tiny, behavior is already obvious, and a durable plan would add no value, direct execution is acceptable. Otherwise, use the full workflow.
- When you review a plan non-interactively or as part of a larger orchestration flow, prefer `/document-review mode:headless docs/plans/<plan>.md`.
- If `/document-review` surfaces unresolved product or scope decisions, loop back to `/ce:brainstorm` or update the source requirements doc. Do not bury product ambiguity in code.
- Store durable artifacts in the standard locations:
	- `docs/brainstorms/YYYY-MM-DD-<topic>-requirements.md`
	- `docs/plans/YYYY-MM-DD-<topic>-plan.md`
	- `docs/solutions/` for compounded learnings
- Prefer skill entry points over direct subagent invocation. The skills own the orchestration logic, agent selection, and review posture.

## Compounding Engineering Plugin

AI-powered development tools that get smarter with every use. Make each unit of engineering work easier than the last.

### Components

| Component | Count |
|-----------|-------|
| Agents | 35+ |
| Skills | 40+ |
| MCP Servers | 1 |

### Workflow Intent

- `/ce:brainstorm` defines WHAT to build. It produces a requirements-quality artifact that planning can trust.
- `/ce:plan` defines HOW to build it. It should produce a decision-complete implementation plan with concrete files, tests, constraints, and verification.
- `/document-review` pressure-tests the plan before code exists. This is the quality gate that catches contradictions, scope drift, weak assumptions, and missing verification before implementation starts.
- `/ce:work` executes the reviewed plan. It is for code and verification, not for inventing missing product behavior.
- `/ce:review` stress-tests the resulting code changes before shipping.
- `/ce:compound` and `/ce:compound-refresh` turn execution-time learning into durable team leverage.

### Skills

Use the workflow skills first. Reach for the support skills when the task calls for them. If a named skill is unavailable in the current runtime, preserve the same workflow intent manually instead of substituting an unrelated process.

#### Core Workflow

| Skill | Description |
|-------|-------------|
| `/ce:ideate` | Discover high-impact project improvements through divergent ideation and adversarial filtering |
| `/ce:brainstorm` | Explore requirements and approaches before planning |
| `/ce:plan` | Transform features into structured implementation plans grounded in repo patterns, with automatic confidence checking |
| `/ce:review` | Structured code review with tiered persona agents, confidence gating, and dedup pipeline |
| `/ce:work` | Execute work items systematically |
| `/ce:compound` | Document solved problems to compound team knowledge |
| `/ce:compound-refresh` | Refresh stale or drifting learnings and decide whether to keep, update, replace, or archive them |

#### Git Workflow

| Skill | Description |
|-------|-------------|
| `git-clean-gone-branches` | Clean up local branches whose remote tracking branch is gone |
| `git-commit` | Create a git commit with a value-communicating message |
| `git-commit-push-pr` | Commit, push, and open a PR with an adaptive description; also update an existing PR description |
| `git-worktree` | Manage Git worktrees for parallel development |

#### Workflow Utilities

| Skill | Description |
|-------|-------------|
| `/changelog` | Create engaging changelogs for recent merges |
| `/feature-video` | Record video walkthroughs and add to PR description |
| `/reproduce-bug` | Reproduce bugs using logs and console |
| `/report-bug-ce` | Report a bug in the compound-engineering plugin |
| `/resolve-pr-feedback` | Resolve PR review feedback in parallel |
| `/sync` | Sync Claude Code config across machines |
| `/test-browser` | Run browser tests on PR-affected pages |
| `/test-xcode` | Build and test iOS apps on simulator |
| `/onboarding` | Generate `ONBOARDING.md` to help new contributors understand the codebase |
| `/todo-resolve` | Resolve todos in parallel |
| `/todo-triage` | Triage and prioritize pending todos |

#### Development Frameworks

| Skill | Description |
|-------|-------------|
| `agent-native-architecture` | Build AI agents using prompt-native architecture |
| `andrew-kane-gem-writer` | Write Ruby gems following Andrew Kane's patterns |
| `dhh-rails-style` | Write Ruby/Rails code in DHH's 37signals style |
| `dspy-ruby` | Build type-safe LLM applications with DSPy.rb |
| `frontend-design` | Create production-grade frontend interfaces |

#### Review And Quality

| Skill | Description |
|-------|-------------|
| `claude-permissions-optimizer` | Optimize Claude Code permissions from session history |
| `document-review` | Review documents using parallel persona agents for role-specific feedback |
| `setup` | Reserved for future project-level workflow configuration; code review agent selection is automatic |

#### Content And Collaboration

| Skill | Description |
|-------|-------------|
| `every-style-editor` | Review copy for Every's style guide compliance |
| `proof` | Create, edit, and share documents via Proof collaborative editor |
| `todo-create` | File-based todo tracking system |

#### Automation And Tools

| Skill | Description |
|-------|-------------|
| `agent-browser` | CLI-based browser automation using Vercel's agent-browser |
| `gemini-imagegen` | Generate and edit images using Google's Gemini API |
| `orchestrating-swarms` | Comprehensive guide to multi-agent swarm orchestration |
| `rclone` | Upload files to S3, Cloudflare R2, Backblaze B2, and cloud storage |

#### Beta Or Experimental

| Skill | Description |
|-------|-------------|
| `/lfg` | Full autonomous engineering workflow |
| `/slfg` | Full autonomous workflow with swarm mode for parallel execution |

### Agent Model

The plugin's specialized agents are usually not the direct entry point. The skills above orchestrate them for you.

- Review skills dispatch focused reviewers for correctness, maintainability, security, performance, reliability, testing, standards compliance, and adversarial failure analysis.
- Document review dispatches personas such as coherence, feasibility, product, design, security, and scope-guardian reviewers.
- Research-oriented skills can dispatch repo, framework-docs, git-history, learnings, and best-practices researchers.
- Design and workflow skills can dispatch design sync, design iteration, bug reproduction, lint, PR comment resolution, and flow-analysis agents.

Prefer the skill entry point unless you have a very specific reason to bypass the normal orchestration.

### MCP And External Docs

- `context7` is the plugin's framework documentation MCP server. Prefer it when external framework or library documentation matters.
- Use browser automation skills only when browser interaction is genuinely part of the task; do not replace normal codebase work with browser ceremony.

## Claude Code Philosophy

This project follows Boris Cherny's Claude Code principles.

### 1. Plan First, Then Let Claude Run

Start in plan mode. Iterate until the plan is solid, then execute. Claude should implement complete, coherent units without unnecessary back-and-forth revisions.

### 2. Verify Everything

Verification is non-negotiable.

- Run tests: `bun test`
- Run type checks: `bun run check`
- Run Rust lint: `cargo clippy`
- Manually test the app when needed

Always prefer scoped verification over the full suite when the scope is local:

- Rust: `cargo test --lib module::path` instead of `cargo test --lib`
- TypeScript: `bun test path/to/file.test.ts` instead of `bun test`
- Run the full suite only before commit or after cross-cutting changes
- Match the test type to the risk: pure logic with unit tests, user interactions with behavior/component tests, architectural placement with contract tests, and layout/visual changes with browser or visual verification.
- String-based UI contract tests are allowed for important wiring and composition rules such as where an action is mounted, which component owns an override, or whether a shared shell renders a specific integration point.
- Do not use string-based UI contract tests as the primary way to verify layout, spacing, visuals, or styling details that can change during harmless refactors. Prefer behavior tests and browser/visual checks for those.
- When writing contract tests, assert stable product or architecture invariants instead of incidental markup. Prefer “this action is rendered by TopBar in kanban mode” over exact class-string snapshots unless the class itself is the contract.
- When a bug fix spans multiple layers, keep the main failing test at the user-visible layer and add lower-level tests only where they help isolate the cause or prevent regression cheaply.

### 3. Use Review To Update The System

When Claude makes a mistake, add or refine the rule in this file so the system gets better. Code review is for improving the engineering system, not only the immediate patch.

### 4. Run Parallel Sessions

For larger features, use worktrees or parallel sessions with different focuses instead of overloading one context window.

### 5. Use Subagents As Reusable Workflows

Treat subagents like specialized tools with specific roles. Reliability comes from specialization plus constraints.

### 6. Pre-Allow Safe Commands

Use `/permissions` to pre-allow safe operations when the runtime supports it:

- File operations in the project
- Git operations such as commit, push, and branch work
- Tests, builds, lint, and typecheck commands

### 7. Treat AI Like Infrastructure

Build systems around AI: memory, permission configs, verification loops, formatting hooks, and durable docs. Claude Code is infrastructure, not magic.

## Detailed Guides

- [TypeScript Conventions](docs/agent-guides/typescript.md)
- [Svelte 5 Patterns](docs/agent-guides/svelte.md)
- [Rust/Tauri Development](docs/agent-guides/rust-tauri.md)
- [Neverthrow Error Handling](docs/agent-guides/neverthrow.md)
- [i18n (Paraglide)](docs/agent-guides/i18n.md)
- [Code Quality](docs/agent-guides/code-quality.md)
