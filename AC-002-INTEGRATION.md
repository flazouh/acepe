# AC-002 integration notes

Do not apply these from this lane. Other lanes own the root files.

## Root `package.json` scripts.test

Add contracts tests to the root `test` script. Place this command after `check:effect-lint` and before the ui tests:

```
bun run --cwd packages/contracts test
```

The `test` script after that change:

```
"test": "bun run test:install-source && bun run check:effect-lint && bun scripts/forbid-structural-tests.ts packages && bun run --cwd packages/contracts test && bun run --cwd packages/ui test && bun run --cwd packages/desktop test && bun run --cwd packages/website test"
```

## Root typecheck

No change. AC-001 already runs `packages/contracts` typecheck and lint:effect.
