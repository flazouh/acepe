# AC-042 integration

This lane did not edit repo-root `package.json` or `tsconfig.base.json`.

New package: `@acepe/transcript-viewport` at `packages/transcript-viewport`.
Workspaces already include `packages/*`. No catalog change.

## `scripts.typecheck`

Insert after `packages/electrobun-shell` and before `packages/desktop`:

```
&& bun run --cwd packages/transcript-viewport typecheck && bun run --cwd packages/transcript-viewport lint:effect
```

## `scripts.test`

Insert after `packages/electrobun-shell test` and before `packages/ui test`:

```
&& bun run --cwd packages/transcript-viewport test
```

## `scripts.lint:effect`

Insert after `packages/electrobun-shell lint:effect`:

```
&& bun run --cwd packages/transcript-viewport lint:effect
```
