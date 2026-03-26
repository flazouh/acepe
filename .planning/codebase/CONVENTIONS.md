# Codebase Conventions

## Stack

- **Frontend**: SvelteKit 2 + Svelte 5, TypeScript, TailwindCSS 4
- **Backend**: Rust (Tauri 2), async with Tokio, SeaORM for SQLite
- **Package manager**: bun (not npm)
- **Linter/Formatter**: Biome (`packages/desktop/biome.json`) — ESLint and Prettier fully removed
- **Runtime validation**: Zod
- **i18n**: Paraglide (`@inlang/paraglide-sveltekit`)

---

## TypeScript Conventions

### Type Safety

- **Never use `any` or `unknown`** — everything must be properly typed. Biome enforces `noExplicitAny: "error"` in non-test files.
- **Never use spread syntax (`...obj`)** — it hides data flow and breaks TypeScript's ability to track property provenance. Explicitly enumerate all properties.
- Use `const` assertions (`as const`) for immutable values.
- Prefer TypeScript type narrowing over type assertions.
- Use Zod for runtime validation when types are uncertain; always act on failure (never ignore validation errors).
- **One type per file** — each TypeScript interface, type, or enum lives in its own file. See `packages/desktop/src/lib/acp/application/dto/` for the canonical example: `session.ts`, `model.ts`, `mode.ts`, `session-status.ts`, etc. are all separate files.

### Naming

- Files: `kebab-case.ts`, `kebab-case.svelte.ts` for Svelte state classes
- Classes: `PascalCase`
- Functions: `camelCase`
- Types/Interfaces: `PascalCase`
- Constants: `SCREAMING_SNAKE_CASE` (e.g., `LOGGER_IDS`, `ACP_INBOUND_METHODS`)
- i18n keys: `snake_case` with grouping prefixes (e.g., `settings_`, `panel_`, `common_`)
- Rust: `snake_case` for all identifiers, `PascalCase` for types/structs/enums

### Forbidden Language Constructs

- **Never use `??` (nullish coalescing)** — use explicit ternaries: `x ? x : fallback`
- **Never use `||` for defaults** — use explicit ternaries
- **Never use `var`** — `const` by default, `let` only when reassignment is needed (`noVar: "error"` in Biome)
- **Never use CommonJS `require()`** — ESM only (`noCommonJs: "error"` in Biome)
- **Never use TypeScript namespaces** — (`noNamespace: "error"` in Biome)
- **Never use try/catch** — use neverthrow `ResultAsync` (see Error Handling section)
- **Avoid non-null assertion (`!`)** — Biome warns on `noNonNullAssertion`

### Modern Patterns

- Arrow functions for callbacks and short functions
- `for...of` loops preferred over `.forEach()` and indexed `for` loops
- Optional chaining (`?.`) for safe property access
- Template literals over string concatenation
- Destructuring for object and array assignments
- Early returns to reduce nesting

### Import Organization

- Biome `organizeImports: "on"` is active for `.ts`/`.tsx` files (disabled for `.svelte` files)
- Avoid barrel files (index files that re-export everything)
- Prefer specific named imports over namespace imports

---

## Error Handling (Neverthrow)

This is the most critical convention. All error handling goes through neverthrow — never try/catch.

### Core Rules

- **Async methods always return `ResultAsync<T, E>`** — never `Promise<Result<T, E>>`
- **Wrap promises**: `ResultAsync.fromPromise(promise, errorMapper)`
- **Wrap throwing sync functions**: `Result.fromThrowable(fn, errorMapper)`
- **Chain operations**: `.map()`, `.andThen()`, `.mapErr()`, `.orElse()`
- **Combine concurrent operations**: `ResultAsync.combine([op1, op2])`
- **Unwrap with `match`**: two positional arguments `match(okCb, errCb)` — never the object form `{ ok, err }`

### Named Error Classes

Each error extends a base class and lives in its own file under `errors/`. Example from
`packages/desktop/src/lib/acp/errors/connection-error.ts`:

```typescript
export class ConnectionError extends AcpError {
  constructor(message: string, cause?: unknown) {
    super(message, "CONNECTION_ERROR", cause);
    this.name = "ConnectionError";
  }
}
```

All errors are re-exported from `errors/index.ts`.

### Patterns in Practice

```typescript
// Async Tauri call — from packages/desktop/src/lib/acp/logic/acp-client.ts
initialize(): ResultAsync<InitializeResponse, AcpError> {
  return ResultAsync.fromPromise(
    tauriClient.acp.initialize(),
    (error) => this.deserializeTauriError(error, "initialize")
  );
}

// Chain with andThen
createAndSaveUser(data: UserData): ResultAsync<User, Error> {
  return validateUserData(data)
    .andThen((valid) => createUser(valid))
    .andThen((user) => saveUser(user));
}

// match with positional callbacks
await result.match(
  (value) => doSomething(value),
  (error) => handleError(error)
);

// Synchronous success path — use okAsync directly, not Promise.resolve().then()
saveData(data: Data): ResultAsync<Data, Error> {
  validateData(data);
  return okAsync(data);
}
```

### Legitimate System-Boundary Exceptions

A small number of true system boundaries may still encounter throwing code and should be
wrapped immediately into Result types at the boundary:

- `atob` / base64 decode
- `new RegExp()` construction
- DOM operations
- Clipboard API
- Shader initialization

Wrap these with `Result.fromThrowable()` or `ResultAsync.fromPromise()`.

---

## Svelte 5 Conventions

### Runes

| Rune | Use |
|---|---|
| `$state()` | Mutable reactive value |
| `$derived()` | Pure computed value — always `const`, never write to it |
| `$props()` | Component inputs |
| `$bindable()` | Two-way binding when parent needs to update child state |

### Forbidden in Svelte Components

- **Never use `$effect` in `.svelte` components** — effects create causal loops when they read and write connected state. Use `$derived` for computed values and event handlers for actions. If an effect is truly unavoidable, guard writes with a comparison: `if (newValue !== currentValue)`.
- **Never use spread syntax** on props or objects
- **Never use `$:` reactive statements** (Svelte 4 syntax — forbidden when using runes)
- **Never mix `on:click` directives with `$state`** (no Svelte 4/5 syntax mixing)
- **Never render a component with optional/undefined required data** — if data is not available, the parent renders something else instead
- **Never use `$derived.by()` for side effects** — for pure computations only

### Event Handlers

Use DOM property syntax, not Svelte 4 directive syntax:

```svelte
<!-- Svelte 5 — correct -->
<button onclick={handleClick}>Click</button>
<input oninput={(e) => value = e.currentTarget.value} />

<!-- FORBIDDEN — Svelte 4 syntax -->
<button on:click={handleClick}>Click</button>
```

### Component Architecture: Presentational Pattern

Parent components own state; child components are purely presentational:

```
Parent (.svelte)                    Child (.svelte)
────────────────────────            ────────────────────────────────
- owns $state                       - NO $state for remote/fetched data
- fetches data (async/await)        - receives all data as Props
- calls store updates               - emits actions via callback props
- renders child with full props     - renders UI only
```

State classes for complex logic live in `.svelte.ts` files:

```typescript
// my-feature-state.svelte.ts
export class MyFeatureState {
  count = $state(0);
  readonly doubled = $derived(this.count * 2);
  increment() { this.count++; }
}
```

### i18n

All user-facing text uses Paraglide. Never hardcode user-visible strings:

```svelte
<script lang="ts">
  import * as m from "$lib/paraglide/messages.js";
</script>
<button>{m.button_submit()}</button>
<p>{m.welcome_message({ name: userName })}</p>
```

Import `setLanguageTag` (not `setLocale`) from `$lib/paraglide/runtime.js`.

---

## Rust Conventions

### Error Handling

- Use `anyhow::Result` for internal functions; `anyhow::Context` to add context to errors
- Tauri commands return `Result<T, String>` — the string is serialized over IPC
- Pattern: `.map_err(|e| e.to_string())` or `.with_context(|| "description")?`

### Tauri Command Pattern

```rust
#[tauri::command]
#[specta::specta]
pub async fn my_command(arg: MyType) -> Result<ReturnType, String> {
    do_something(arg).await.map_err(|e| e.to_string())
}
```

All types used in command parameters/return values need `#[derive(specta::Type)]` for
automatic TypeScript type generation. Regenerate bindings after changes:

```bash
cargo test export_command_bindings -- --nocapture
cargo test export_types -- --nocapture
```

Generated TypeScript files (do not edit manually):

- `src/lib/services/claude-history-types.ts`
- `src/lib/services/converted-session-types.ts`
- `src/lib/services/command-names.ts`

### Service Pattern

- `Service` structs manage resource lifecycle (spawning/stopping subprocesses)
- All Tauri commands are `async`
- Use `tokio::process::Command` for async subprocess spawning
- Register commands in `src-tauri/src/lib.rs` invoke handler and `commands/mod.rs` macro

### Code Quality

- Run `cargo clippy` before considering Rust code complete
- Fix all compilation errors and warnings before submission

---

## Formatting (Biome)

Config at `packages/desktop/biome.json`:

| Setting | Value |
|---|---|
| Indent style | Tabs |
| Indent width | 2 |
| Line ending | LF |
| Line width | 100 |
| Quote style | Double quotes |
| Trailing commas | ES5 |
| Semicolons | Always |
| Arrow parentheses | Always |
| Bracket spacing | true |

Commands:

```bash
bun run format          # biome format --write .
bun run format:check    # biome check .
bun run lint            # biome check .
bun run lint:fix        # biome check --fix .
```

---

## Pre-push Quality Gate

`.husky/pre-push` runs three checks in parallel; all must pass:

1. **Frontend**: `bun run check` (TypeScript) + `bun run check:svelte` + `bun test`
2. **Website**: `bun run check` + `bun run test`
3. **Backend**: `cargo check` + `cargo test` (skipping `export_types`)

---

## File Organization

```
packages/desktop/src/lib/acp/
  application/dto/        # One TypeScript type per file
  components/             # Svelte UI components
    agent-panel/
      logic/              # Pure business logic + state classes (.svelte.ts)
      components/         # Sub-components
  errors/                 # Named error classes, one per file + index.ts barrel
  logic/                  # Cross-cutting business logic, state machines
  store/                  # Svelte state stores (.svelte.ts)
  types/                  # Discriminated unions, branded types
  utils/                  # Shared utilities

packages/desktop/src-tauri/src/
  acp/                    # ACP protocol handling
  db/                     # SeaORM entities, migrations, repositories
  storage/                # Tauri command handlers
  history/                # Session history scanning
```

---

## TDD Workflow

The project follows Test-Driven Development (see `docs/agent-guides/code-quality.md`):

1. Write failing tests first
2. Verify tests fail for the right reason
3. Implement the minimum code to pass
4. Refactor while keeping tests green
5. Run full test suite to check for regressions

```bash
# TypeScript
bun test my-feature      # run scoped
bun test                 # run full suite (~7.5s, 1482+ tests across 113 files)

# Rust — prefer scoped during development
cargo test --lib acp::parsers::adapters
cargo test --lib         # full suite before commit (~2 min)
```
