# Code Quality Standards

This project uses **Biome** for formatting and linting in the Svelte/TS packages. See `packages/*/package.json` for per-package `check` / `test` scripts.

## Quick Reference

```bash
# Desktop / website: see package scripts, e.g.
(cd packages/desktop && bunx @biomejs/biome check .)
# Full monorepo test (same order as CI’s JS surface)
bun run test
```

## Automated checks (source of truth)

**GitHub Actions** (`.github/workflows/ci.yml` on pull requests to `main`) runs Biome, TypeScript / Svelte checks, the structural-test ban, and package tests for `desktop`, `website`, `ui`, and `agent-panel-contract`, plus Rust clippy and tests. There are **no git hooks** in this repo; rely on CI or run `bun run test` locally before pushing.

## Test-Driven Development (TDD)

**CRITICAL**: When adding new logic or features, always follow TDD:

1. **Write tests first** - Before implementing any new logic, write failing tests that define the expected behavior
2. **Run the tests** - Verify tests fail for the right reason (the feature doesn't exist yet)
3. **Implement the feature** - Write the minimum code needed to make tests pass
4. **Refactor** - Clean up the implementation while keeping tests green
5. **Run all tests** - Ensure no regressions

### Example Workflow for TypeScript

```bash
# 1. Write test in *.test.ts file
# 2. Run tests to see them fail
bun test my-feature

# 3. Implement the feature
# 4. Run tests to see them pass
bun test my-feature

# 5. Run full test suite
bun test
```

### Example Workflow for Rust

```bash
# 1. Write test in the appropriate test module
# 2. Run tests to see them fail
cargo test my_new_feature

# 3. Implement the feature
# 4. Run tests to see them pass
cargo test my_new_feature

# 5. Run full test suite
cargo test
```

## VSCode Integration

This project is configured to:

- Format files with Prettier on save
- Auto-fix ESLint issues on save
- Validate JavaScript, TypeScript, and Svelte files with ESLint

Required VSCode extensions:

- **ESLint** (`dbaeumer.vscode-eslint`)
- **Prettier** (`esbenp.prettier-vscode`)
- **Svelte for VS Code** (`svelte.svelte-vscode`)
