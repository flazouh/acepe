# AC-017 root integration

Do not edit this in the same change as another lane's root file.

`packages/harness` is a new workspace package. `workspaces` already includes `packages/*`, so no workspace edit is needed. Effect `4.0.0-rc.111` and `@effect/platform-bun` are already in the catalog.

## `scripts.typecheck`

Append this after the sidecar package chain:

```text
 && bun run --cwd packages/harness typecheck && bun run --cwd packages/harness lint:effect
```

## `scripts.test`

Append this after the sidecar package tests:

```text
 && bun run --cwd packages/harness test
```

## `scripts.lint:effect`

Append this after the sidecar lint:

```text
 && bun run --cwd packages/harness lint:effect
```
