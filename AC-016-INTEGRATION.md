# AC-016 integration notes

This lane did not edit repo-root `package.json` or `tsconfig.base.json`.

## Root typecheck chain

Add these commands after the contracts typecheck/lint entries:

```
bun run --cwd packages/sidecar typecheck
bun run --cwd packages/sidecar lint:effect
```

## Root lint:effect

Also run `bun run --cwd packages/sidecar lint:effect` from the root `lint:effect` script.

## Root test suite

Also run `bun run --cwd packages/sidecar test`.

## Catalog

No catalog changes. `packages/sidecar` uses the existing `effect`, `@effect/vitest`, and `@effect/language-service` pins. Vitest is pinned to `4.1.9` in the package (required by `@effect/vitest` 4.0.0-rc.111).

## Cargo

`packages/desktop/src-tauri/Cargo.toml` gained an additive binary target:

```
[[bin]]
name = "acepe-sidecar"
path = "src/bin/sidecar.rs"
```

The desktop Tauri app binary is unchanged.
