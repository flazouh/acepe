# Component Refactoring Guide

Apply production standards to components following these guidelines.

## Architecture

### Svelte 5 Runes Pattern
- Follow Svelte 5 runes with class-based state and UI separation
- Separate state management from presentation logic

### Folder Structure
Organize one folder per concern:
- `errors/` - Error definitions
- `constants/` - Constant values
- `types/` - Type definitions
- `components/` - UI components
- `logic/` - Business logic
- `tests/` - Bun tests for logic only

## Implementation Rules

### Error Handling
- Define errors first
- Use neverthrow and return `Result` for all operations
- Never use `Promise` directly

### Testing
- Write Bun tests for all logic
- Achieve 100% test coverage

### File Organization
- Create one file per type, component, and other entities
- Create one folder per concern
- Write JSDoc comments for all public APIs

### Code Reuse
- **IMPORTANT**: Check first for existing types and props
- Reuse existing types and props when available
- Do not create duplicate definitions

### Barrel Files
- Do not use `index.ts` barrel files
- Use direct imports instead of barrel exports

### TypeScript Import Syntax
- **Never use** `import("svelte").Snippet` or similar type-only import syntax
- **Always use** explicit type imports: `import type { Snippet } from "svelte"`
- Apply this pattern to all Svelte types (Snippet, Component, ComponentProps, etc.)
- Example:
  ```typescript
  // ❌ Wrong
  content: import("svelte").Snippet;
  
  // ✅ Correct
  import type { Snippet } from "svelte";
  content: Snippet;
  ```

## Common Pitfalls & Solutions

### Result Type Handling in Tests
- **Issue**: Accessing `.value` on `Result` without type guards causes TypeScript errors
- **Solution**: Always use type guards:
  ```typescript
  if (result.isOk()) {
    if (result.value) {
      // Now safe to access result.value
    }
  }
  ```
- **Lesson**: Never access `.value` directly on `Result` types without checking `isOk()` first

### Test Data Accuracy
- **Issue**: Test cursor positions or string indices don't match actual string lengths
- **Solution**: Verify test data matches real-world scenarios:
  - Check actual string lengths (including newlines count as 1 character)
  - Use correct cursor positions relative to string length
  - Test edge cases (empty strings, single characters, etc.)
- **Lesson**: Always verify test data accuracy, especially for string manipulation tests

### ResultAsync Usage Patterns
- **Issue**: Incorrect use of `ResultAsync.fromSafePromise` for simple cases
- **Solution**: Use appropriate helpers:
  - `okAsync(value)` for simple success cases
  - `errAsync(error)` for simple error cases
  - `ResultAsync.fromSafePromise(promise)` only for Promise-wrapped operations
- **Lesson**: Choose the right neverthrow helper based on operation type

### API Contract Changes
- **Issue**: Tests break when API contracts change (e.g., required fields added)
- **Solution**: 
  - Update tests immediately when APIs change
  - Remove obsolete test cases (e.g., "default values" test when fields become required)
  - Ensure all required fields are provided in test data
- **Lesson**: Keep tests synchronized with API changes

### Component Migration Cleanup
- **Issue**: Old component files and references remain after refactoring
- **Solution**: After refactoring, audit and update:
  - Delete old component files
  - Update all import paths in consuming components
  - Update export files (`index.ts`, etc.)
  - Update test files
  - Update registry/config files (e.g., `design-system/registry.ts`)
  - Update test file references
- **Lesson**: Complete migration cleanup prevents confusion and build errors

### Type Safety with Neverthrow
- **Issue**: Mixing `Result` and `ResultAsync` incorrectly
- **Solution**: Understand patterns:
  - `Result<T, E>` for synchronous operations
  - `ResultAsync<T, E>` for asynchronous operations
  - Use `.map()` and `.mapErr()` for transformations
  - Use `.andThen()` for chaining operations
  - Never use `Promise<Result<T, E>>` - always use `ResultAsync<T, E>`
- **Lesson**: Master neverthrow patterns for type-safe error handling

### TypeScript Import Syntax
- **Issue**: Using `import("module").Type` syntax for type-only imports
- **Solution**: Always use explicit type imports:
  ```typescript
  // ❌ Wrong
  content: import("svelte").Snippet;
  
  // ✅ Correct
  import type { Snippet } from "svelte";
  content: Snippet;
  ```
- **Lesson**: Use explicit `import type` statements for all type-only imports, especially Svelte types

## Refactoring Checklist

### Before Starting
- [ ] Check project conventions (barrel files, naming, etc.)
- [ ] Identify existing types and props to reuse
- [ ] Review similar component structures in codebase

### During Implementation
- [ ] Define errors first
- [ ] Create types (one file per type)
- [ ] Extract constants
- [ ] Create pure logic functions (return Result/ResultAsync)
- [ ] Create state class with Svelte 5 runes
- [ ] Write tests with 100% coverage
- [ ] Refactor UI component to use state class

### After Implementation
- [ ] Delete old component files
- [ ] Update all import paths
- [ ] Update export files
- [ ] Update registry/config files
- [ ] Update test file references
- [ ] Run all tests to verify
- [ ] Check for linter errors
- [ ] Verify no references to old files remain