# Contributing to Acepe

Thanks for your interest in contributing to Acepe! We welcome contributions of all kinds — bug fixes, features, documentation, and ideas.

## Quick Start

```bash
# Fork and clone
git clone https://github.com/flazouh/acepe.git
cd acepe

# Install dependencies
bun install

# Start development
cd packages/desktop
bun run tauri
```

### Prerequisites

- [Bun](https://bun.sh/) 1.3+
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform

## Making Changes

1. Create a branch from `main`
2. Make your changes
3. Run checks before submitting:

```bash
# Type check
bun run check

# Run tests
bun test

# Lint
bunx biome check .

# Rust checks
cd packages/desktop/src-tauri && cargo clippy
```

4. Open a pull request against `main`

## What to Work On

- Check [open issues](https://github.com/flazouh/acepe/issues) for things tagged `good first issue` or `help wanted`
- Bug reports and reproductions are always valuable
- If you're planning something large, open an issue first to discuss the approach

## Code Style

- **TypeScript/Svelte**: Formatted and linted by [Biome](https://biomejs.dev/)
- **Rust**: Formatted by `rustfmt`, linted by `clippy`
- **Svelte 5**: We use runes (`$state`, `$derived`, `$effect`) — not legacy reactive syntax
- **Error handling**: We use [neverthrow](https://github.com/supermacro/neverthrow) for typed Result/ResultAsync patterns

## Project Structure

```
packages/
  desktop/          # Tauri desktop app (SvelteKit + Rust)
  ui/               # Shared UI component library
  acps/             # Agent provider implementations
  website/          # Marketing site
  api/              # API types and contracts
```

## License

By contributing, you agree that your contributions will be licensed under the [FSL-1.1-ALv2](LICENSE) (Functional Source License, converting to Apache 2.0 after two years).
