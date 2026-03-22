# Code Quality Standards

This project uses **ESLint** for linting and **Prettier** for code formatting.

## Quick Reference

```bash
bun run format        # Format code
bun run format:check  # Check formatting
bun run lint          # Lint code
bun run lint:fix      # Fix linting issues
```

## Automated Checks

The following checks run automatically on pre-commit via lefthook:

1. **ESLint** - Code quality and best practices
2. **Prettier** - Code formatting
3. **TypeScript** - Type checking
4. **Tests** - Unit and integration tests

Run `bun run format` and `bun run lint:fix` before committing to ensure compliance.

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
