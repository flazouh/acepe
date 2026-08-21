# AC-056 integration

This lane did not edit repo-root `package.json` or `tsconfig.base.json`.

`packages/*` already covers `packages/electrobun-qa`. No new catalog entry is required. The package uses `effect` from the existing catalog. `@effect/language-service`, `@effect/vitest`, and `vitest` are package `devDependencies` using the catalog.

## Root scripts

Add these to the root `package.json` `scripts` object.

`typecheck` chain, after `packages/electrobun-shell`:

```
bun run --cwd packages/electrobun-qa typecheck && bun run --cwd packages/electrobun-qa lint:effect
```

`test` chain, after `packages/electrobun-shell test`:

```
bun run --cwd packages/electrobun-qa test
```

`lint:effect` chain, after `packages/electrobun-shell`:

```
bun run --cwd packages/electrobun-qa lint:effect
```

Convenience script:

```
"electrobun-qa": "bun run --cwd packages/electrobun-qa cli"
```

## App wiring

Live acceptance (doctor and `snapshotText` against a running Acepe window) needs this wiring in `packages/electrobun-shell` / the Electrobun BrowserWindow path. This lane did not edit those files.

1. When `qaSurfaceEnabled({ signed })` is true, pass `preload: qaPreloadScript` into `BrowserWindow`.
2. After the window opens, call `startQaHost` with `executeJavascript` from the launched webview.
3. Bind results with `bindQaResultHandler` on Electrobun `internalRpcHandlers.message`.

Do not start the host or inject the preload when the build is signed.
