# TypeScript Conventions

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

## Type Safety & Explicitness

- Use explicit types for function parameters and return values
- **NEVER use `any` or `unknown`** - everything should be properly typed
- If types are uncertain, use **Zod** for runtime validation and act on failure
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names
- **One type per file** - each TypeScript interface, type, or enum must be in its own file

## Explicit Over Implicit

- **NEVER use spread syntax (`...obj`)** — it obscures data flow, makes refactoring error-prone, and breaks TypeScript's ability to track property provenance. Explicitly enumerate all properties instead.
- Prefer explicit property assignment over object spread when merging or updating objects

## Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) for safer property access
- **FORBIDDEN**: Never use nullish coalescing (`??`) operator
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

## Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- **FORBIDDEN**: Never use try-catch - always use neverthrow `ResultAsync` for error handling
- Don't use async functions as Promise executors

## Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

## Import/Export Sorting

This project uses `eslint-plugin-perfectionist` to enforce consistent import and export ordering:

- Imports are sorted by line length (descending)
- Named imports within an import statement are sorted by line length (descending)
- Exports are sorted by line length (descending)

ESLint will automatically fix import/export ordering when you run `bun run lint:fix`.

## Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Validate and sanitize user input

## Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)
