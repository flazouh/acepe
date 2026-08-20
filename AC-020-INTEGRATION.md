# AC-020 integration (root files)

Do not merge this ticket until a root-file lane applies these edits. This lane did not change `package.json` or `tsconfig.base.json`.

## Root `package.json` scripts

Add the new package to the typecheck chain, the Effect lint chain, and the test chain.

`typecheck` — append:

```text
&& bun run --cwd packages/electrobun-shell typecheck && bun run --cwd packages/electrobun-shell lint:effect
```

`test` — append:

```text
&& bun run --cwd packages/electrobun-shell test
```

`lint:effect` — change to:

```json
"lint:effect": "bun run --cwd packages/contracts lint:effect && bun run --cwd packages/electrobun-shell lint:effect"
```

## Catalog

No new catalog pins. This package uses the existing `effect` and `@effect/language-service` catalog entries.

`electrobun@1.18.1` is pinned on `packages/desktop` only. Do not put it in the Effect catalog.

## Workspace

`workspaces: ["packages/*"]` already includes `packages/electrobun-shell`. No workspace glob change.
