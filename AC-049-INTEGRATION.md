# AC-049 root integration

Do not edit this in the same change as another lane's root file.

`packages/desktop` is not a new workspace package. Effect is already in the catalog. `@acepe/effect-result` is already a desktop dependency.

Do not edit repo-root `package.json` or `tsconfig.base.json` in the AC-049 lane. Apply the snippets below in a later integration merge.

## Keep `neverthrow` and `zod` at the repo root

Root `dependencies` still list:

```text
"neverthrow": "^8.2.0"
"zod": "^4.2.1"
```

Leave them until `scripts/dead-code/find-dead-code.ts` is migrated off neverthrow. Desktop no longer imports either package. Desktop `package.json` already dropped both.

After that dead-code script migrates, drop both from root `package.json`. Then `bun run --cwd packages/effect-result cli` can pass.

## `scripts.typecheck`

Append this after the desktop typecheck at the end of the chain:

```text
 && bun run --cwd packages/desktop lint:effect
```

Full current desktop tail:

```text
 && bun run --cwd packages/desktop typecheck
```

After the change:

```text
 && bun run --cwd packages/desktop typecheck && bun run --cwd packages/desktop lint:effect
```

`bun run --cwd packages/desktop typecheck` passed after this lane. `lint:effect` currently checks 0 files because desktop `tsconfig.json` has no language-service plugin. See `scripts.lint:effect` below.


## `scripts.lint:effect`

Append this after the electrobun-shell lint:

```text
 && bun run --cwd packages/desktop lint:effect
```

Desktop `tsconfig.json` does not extend `tsconfig.base.json` and must not get the language-service plugin. Today `bun run --cwd packages/desktop lint:effect` exits 0 and reports `Checked 0 files out of 1400 files`. That is not a real Effect-lint pass. A later lane can add a dedicated lint tsconfig that extends `tsconfig.base.json` if desktop should actually run the 77 rules. Do not put the plugin on the typecheck tsconfig. That would flood `typecheck`.


## Do not add the language-service plugin to desktop `tsconfig.json`

Desktop `lint:effect` already runs `effect-language-service diagnostics --project tsconfig.json --strict`. Adding the plugin to desktop `tsconfig.json` would flood `typecheck`. Keep the plugin only in `tsconfig.base.json`.
