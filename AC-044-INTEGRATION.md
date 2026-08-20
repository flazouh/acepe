# AC-044 integration (root files this lane must not edit)

This lane did not edit repo-root `package.json` or `tsconfig.base.json`.
Apply the edits below in the integrating lane.

No catalog entry is needed. `packages/*` already includes `@acepe/effect-result`.
Effect `4.0.0-rc.111` is already in `catalog`.

## Root `package.json` scripts

### `typecheck`

Append this after the `packages/server lint:effect` step and before `packages/desktop typecheck`:

```text
&& bun run --cwd packages/effect-result typecheck && bun run --cwd packages/effect-result lint:effect
```

Full value:

```json
"typecheck": "bun run check:effect-lint && bun run --cwd packages/contracts typecheck && bun run --cwd packages/contracts lint:effect && bun run --cwd packages/effect-svelte typecheck && bun run --cwd packages/effect-svelte lint:effect && bun run --cwd packages/server typecheck && bun run --cwd packages/server lint:effect && bun run --cwd packages/effect-result typecheck && bun run --cwd packages/effect-result lint:effect && bun run --cwd packages/desktop typecheck"
```

### `test`

Append this after the `packages/server test` step:

```text
&& bun run --cwd packages/effect-result test
```

Full value:

```json
"test": "bun run test:install-source && bun run check:effect-lint && bun scripts/forbid-structural-tests.ts packages && bun run --cwd packages/contracts test && bun run --cwd packages/effect-svelte test && bun run --cwd packages/server test && bun run --cwd packages/effect-result test && bun run --cwd packages/ui test && bun run --cwd packages/desktop test && bun run --cwd packages/website test"
```

### `lint:effect`

Append this after the `packages/server lint:effect` step:

```text
&& bun run --cwd packages/effect-result lint:effect
```

Full value:

```json
"lint:effect": "bun run --cwd packages/contracts lint:effect && bun run --cwd packages/effect-svelte lint:effect && bun run --cwd packages/server lint:effect && bun run --cwd packages/effect-result lint:effect"
```

## CONTRACT (do not enable yet)

Do not add this until no `package.json` lists `neverthrow` or `zod`, including root, `packages/desktop`, and `scripts/dead-code/find-dead-code.ts`.

```json
"check:legacy-deps": "bun run --cwd packages/effect-result cli"
```

Then add `&& bun run check:legacy-deps` to `typecheck` or `test`.

The CLI resolves the repo root from `import.meta.dir`. Cwd does not matter.

Do not remove root `neverthrow` or `zod` until:

1. Desktop call sites outside `packages/desktop/src/lib/services` are migrated.
2. `packages/desktop/src/lib/services` is migrated (blocked for this lane).
3. `scripts/dead-code/find-dead-code.ts` is migrated.

## This lane left unfinished

- Desktop still imports `neverthrow` (241-file class). This lane must not touch `packages/desktop/src/lib/services`.
- Desktop still imports `zod` in about 12 files. Those files are not under `lib/services`.
- `docs/adr` still describes neverthrow as the error standard. AC-044 replaces that. Write a new ADR when CONTRACT lands.
- `packages/website/scripts/seed-admin.ts` still calls `createAdmin` and `result.isErr()`. That helper is not in `auth/admin.ts`. Pre-existing. Not part of this batch.

## Already done in this lane

- New package `packages/effect-result` (`@acepe/effect-result`): `fromThrowable`, `fromPromise`, `decodeUnknown`, forbid-legacy-deps CLI.
- `packages/ui`: neverthrow removed from `package.json`. Call sites use Effect.
- `packages/website`: neverthrow removed from `package.json`. Call sites use Effect.
