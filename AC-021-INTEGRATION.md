# AC-021 integration

This lane did not edit repo-root `package.json` or `tsconfig.base.json`.
Apply the following in the integration lane.

## Root `package.json` scripts

### `scripts.typecheck`

Add the effect-svelte typecheck and Effect lint after contracts:

```json
"typecheck": "bun run check:effect-lint && bun run --cwd packages/contracts typecheck && bun run --cwd packages/contracts lint:effect && bun run --cwd packages/effect-svelte typecheck && bun run --cwd packages/effect-svelte lint:effect && bun run --cwd packages/desktop typecheck"
```

### `scripts.test`

Add the effect-svelte test run after `packages/ui` tests:

```json
"test": "bun run test:install-source && bun run check:effect-lint && bun scripts/forbid-structural-tests.ts packages && bun run --cwd packages/ui test && bun run --cwd packages/effect-svelte test && bun run --cwd packages/desktop test && bun run --cwd packages/website test"
```

### `scripts.lint:effect`

Chain the new package:

```json
"lint:effect": "bun run --cwd packages/contracts lint:effect && bun run --cwd packages/effect-svelte lint:effect"
```

## Catalog

No catalog change. `effect` is already pinned. Do not add `@effect/atom` or `@effect/atom-svelte`.

## Workspaces

No change. `"workspaces": ["packages/*"]` already includes `packages/effect-svelte`.

## tsconfig.base.json

No change. `packages/effect-svelte/tsconfig.json` already extends `../../tsconfig.base.json`.
