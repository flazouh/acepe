# Rust/Tauri Development

## Commands

```bash
cd packages/desktop/src-tauri

cargo check       # Quick compilation check
cargo clippy      # Linting
cargo build       # Build
cargo test        # Run tests (full suite ~2min)
```

## Testing Strategy

**ALWAYS prefer scoped tests over full suite.** The full `cargo test` takes ~2 minutes. Use module-scoped tests during development:

```bash
# Run tests for a specific module (PREFERRED)
cargo test --lib acp::parsers::adapters        # adapter tests only
cargo test --lib acp::parsers::tests::cursor   # cursor parser tests only
cargo test --lib acp::session_update           # session update tests only

# Run a single test by name
cargo test --lib test_name_here

# Run full suite only before commit/PR (or when changes span many modules)
cargo test --lib
```

**When to use scoped vs full:**
- **Scoped** (default): When changes are in 1-3 modules. Run tests for those modules only.
- **Full suite**: Before committing, after cross-cutting refactors, or when unsure about blast radius.

For the common local loop in this repo, prefer `bun run test:rust:fast` from `packages/desktop` before reaching for broader Rust runs. It now maps to `cargo test --lib -- --skip claude_history::export_types`, so you get full lib coverage without compiling the opt-in manual benchmark and live integration targets.

Manual benchmark and live integration targets now require the `manual-test-targets` feature. Run them explicitly when needed:

```bash
cd packages/desktop/src-tauri

cargo test --features manual-test-targets --test startup_scan_benchmark
cargo test --features manual-test-targets --test indexer_benchmark
cargo test --features manual-test-targets --test codex_scanner_benchmark
cargo test --features manual-test-targets --test codex_scanner_test
cargo test --features manual-test-targets --test voice_transcription
```

## Code Quality

- Run `cargo check` or `cargo clippy` before considering code complete
- Fix all compilation errors before submitting changes
- Address warnings when possible
- Use Rust best practices and follow existing code style
- Add appropriate error handling with `anyhow::Context`

## Adding New Tauri Commands

1. Define command function in appropriate module (e.g., `src-tauri/src/acp/commands.rs`)
2. Mark with `#[tauri::command]` and `#[specta::specta]` attributes
3. Return `Result<T, String>` where `T` is the success type
4. Ensure all types used in command parameters and return values have `#[derive(specta::Type)]`
5. Register command in `src-tauri/src/lib.rs` in the `.invoke_handler()` chain
6. Add command to `src-tauri/src/commands/mod.rs` in the `collect_commands![]` macro
7. Use the type-safe client from frontend: `tauriClient.acp.commandName(args)`
8. Regenerate TypeScript bindings: `cargo test export_command_bindings -- --nocapture`

## TypeScript Type Generation (tauri-specta)

This project uses **specta** with **tauri-specta** for automatic TypeScript type generation from Rust types.

### Adding a New Exportable Type

1. Add `#[derive(specta::Type)]` to your Rust struct or enum:
```rust
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct MyNewType {
    pub field: String,
    pub count: i32,
}
```

2. Add the type to the export in `src/claude_history/export_types.rs`:
```rust
export_type!(MyNewType);
```

3. Regenerate TypeScript types:
```bash
cargo test export_types -- --nocapture
```

4. Import the generated types in TypeScript:
```typescript
import type { MyNewType } from "../services/converted-session-types.js";
```

### Generated Files

- `src/lib/services/claude-history-types.ts` - HistoryEntry types
- `src/lib/services/converted-session-types.ts` - Session, tool, and message types
- `src/lib/services/command-names.ts` - Tauri command name constants

### Notes

- Use `specta::Type` derive macro for types that need TypeScript generation
- For `i64` fields, specta exports them as `number` (configured via `BigIntExportBehavior::Number`)
- The JsonValue type is manually added to generated files for `serde_json::Value` compatibility

## Backend Patterns

- **Service Pattern**: `AcpService` manages resource lifecycle (spawn/stop subprocess)
- **Command Handlers**: Mark functions with `#[tauri::command]` and register in `lib.rs`
- **Async Rust**: All Tauri commands are async and return `Result<T, String>`
- **Error Context**: Use `anyhow::Context` to add context to errors before converting to strings
- **Subprocess Management**: Use `tokio::process::Command` for async subprocess spawning
