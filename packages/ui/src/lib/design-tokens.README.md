# Design Tokens

**Single source of truth for semantic colors** (e.g. success green).

## To change the success color

Edit **`design-tokens.css`** and **`colors.ts`** (GREEN constant) — keep them in sync.

## Usage

- **CSS**: Apps import via `@import "@acepe/ui/design-tokens.css"` and map tokens to theme variables, e.g. `--success: var(--token-success-light)` in light mode.
- **TS/JS**: Use `Colors.GREEN` from `colors.ts` when you need a hex (e.g. project color picker); it must match `--token-success-light`.
