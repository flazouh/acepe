# AC-005 integration

This lane did not edit repo-root `package.json` or `tsconfig.base.json`.
`bun install` updated `bun.lock` so `@acepe/server` can resolve catalog Effect packages.

No catalog additions. These Effect packages are already pinned:
`effect`, `@effect/platform-bun`, `@effect/sql-sqlite-bun`, `@effect/vitest`, `@effect/language-service`.

No `tsconfig.base.json` changes. `packages/server/tsconfig.json` already extends `../../tsconfig.base.json`.

## Root `package.json` scripts

Add `packages/server` to the typecheck chain, Effect lint chain, and test chain.

`typecheck` — append:

```text
&& bun run --cwd packages/server typecheck && bun run --cwd packages/server lint:effect
```

`test` — append:

```text
&& bun run --cwd packages/server test
```

`lint:effect` — change from contracts-only to:

```json
"lint:effect": "bun run --cwd packages/contracts lint:effect && bun run --cwd packages/server lint:effect"
```

Workspaces already include `packages/*`. No workspace glob change.
