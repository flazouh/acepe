# Acepe

Tauri 2 + SvelteKit 2 + Svelte 5 desktop app for AI agent interaction via Agent Client Protocol.

## Package Manager
bun (not npm)

## Commands
```bash
cd packages/desktop
bun run check      # TypeScript check
bun test           # Tests
bun run build      # Build
cargo clippy       # Rust lint (in src-tauri/)
```

## Critical Rules

- Use the compound engineering and test driven development skills.
- **NEVER run `bun dev`** - user manages dev server
- **NEVER run `git stash`** without explicit user consent - stashing can hide in-progress work
- **NEVER use try/catch** - use neverthrow `ResultAsync`
- **NEVER use `any` or `unknown`** - use proper types or Zod for validation
- **Make sure you run `bun run check`** if you make typescript changes.
- **ALWAYS invoke Svelte skills** before modifying/creating Svelte code (`svelte-runes`, `svelte-components`, `sveltekit-structure`, `sveltekit-data-flow`)
- **NEVER use `$effect` in Svelte 5 components** — effects create causal loops when they read and write connected state. Use `$derived` for computed values and event handlers for actions. For async operations, prefer passing callbacks or moving state ownership to the parent. If an effect is unavoidable, guard writes with comparison: `if (newValue !== currentValue)`.
- **NEVER use spread syntax (`...obj`)** — it obscures data flow, makes refactoring error-prone, and breaks TypeScript's ability to track property provenance. Explicitly enumerate all properties instead.

## Claude Code Philosophy

This project follows Boris Cherny's Claude Code principles.

### 1. Plan First, Then Let Claude Run
Start in Plan Mode. Iterate until the plan is solid, then switch to auto-accept edits mode. Claude should execute entire implementations in one go without back-and-forth revisions.

### 3. Verify Everything (Non-Negotiable)
This is the most important principle. Claude must verify its work:
- Run tests: `bun test`
- Run type checks: `bun run check`
- Run Rust lint: `cargo clippy`
- Manually test the app when needed

**ALWAYS prefer scoped tests over full suite:**
- **Rust**: `cargo test --lib module::path` (e.g., `cargo test --lib acp::parsers::adapters`) — NOT `cargo test --lib` which runs everything (~2min)
- **TypeScript**: `bun test path/to/file.test.ts` — NOT `bun test` which runs everything
- Run the full suite only before commit/PR or after cross-cutting changes

### 4. Use Code Review to Update the System
When reviewing PRs, tag `@.claude` to add learnings to this file. Code review is for training the development system, not just catching bugs. When Claude makes a mistake, add a rule so it doesn't repeat.

### 5. Run Parallel Sessions
For complex features, consider running multiple sessions in parallel, each with a different focus (e.g., one for backend, one for frontend).

### 6. Use Subagents as Reusable Workflows
Treat subagents like specialized tools with specific roles. Reliability comes from specialization plus constraints.

### 7. Pre-allow Safe Commands
Use `/permissions` to pre-allow common safe commands:
- File operations in the project
- Git operations (commit, push, branch)
- Running tests and builds
- Running lint/typecheck

### 8. Treat AI Like Infrastructure
Build systems around AI: memory files, permission configs, verification loops, formatting hooks. Claude Code is infrastructure, not magic.

## Detailed Guides
- [TypeScript Conventions](docs/agent-guides/typescript.md)
- [Svelte 5 Patterns](docs/agent-guides/svelte.md)
- [Rust/Tauri Development](docs/agent-guides/rust-tauri.md)
- [Neverthrow Error Handling](docs/agent-guides/neverthrow.md)
- [i18n (Paraglide)](docs/agent-guides/i18n.md)
- [Code Quality](docs/agent-guides/code-quality.md)
