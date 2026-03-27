# Paraglide Generation Contract Design

## Goal

Replace the current Paraglide CI workaround with an explicit, clean generation contract for both `packages/desktop` and `packages/website`.

The target model is strict separation of concerns:

- `generate` creates derived Paraglide artifacts
- `check` validates source plus already-generated artifacts
- `build` builds from source plus already-generated artifacts
- CI orchestrates the phases explicitly

## Problem

The repo currently has inconsistent Paraglide behavior across packages:

- `packages/desktop` uses bespoke CI prep to materialize generated Paraglide files before checks.
- `packages/website` originally relied on Vite build side effects to materialize generated Paraglide files.
- This made CI behavior differ from package-local script behavior.
- The website workaround required a full build and later a larger Node heap, which is operationally expensive and mixes generation with production build concerns.

This is not the desired steady state.

## Principles

- Keep generated Paraglide artifacts out of git.
- Do not rely on production builds as side-effect generators for typechecking.
- Do not make `check` generate artifacts.
- Make generation explicit, package-local, and reproducible.
- Keep CI orchestration dumb: call scripts in the right order rather than encoding package-specific hacks in workflow YAML.
- Expose the same external contract in both packages even if their internal generation implementation differs.

## Desired Contract

Each package that imports generated Paraglide files must expose:

- `bun run i18n:generate`
- `bun run check`
- `bun run build`

Behavior:

- `i18n:generate`
  - materializes the Paraglide runtime/messages output required by that package
  - is the only script responsible for Paraglide generation
  - may also perform package-specific framework prep required before tests or checks, such as `svelte-kit sync`
- `check`
  - performs framework sync and validation only
  - assumes generated Paraglide files already exist
  - fails if generation has not been run
- `build`
  - performs the real package build only
  - assumes generated Paraglide files already exist

## Package Design

### `packages/website`

The website currently imports generated files from `src/lib/paraglide`.

The design requires:

- add an explicit `i18n:generate` script for website
- ensure the script uses a supported Paraglide generation path for the website package
- remove any requirement that `bun run build` be used only to make `bun run check` work
- keep `src/lib/paraglide` gitignored

The exact internal command may be package-specific. The external contract is fixed.

### `packages/desktop`

The desktop package already has custom CI behavior and known Paraglide/runtime caveats.

The design requires:

- add an explicit `i18n:generate` script for desktop
- move the existing generation responsibility out of CI YAML and into package scripts
- preserve any package-specific generation implementation needed for compatibility
- keep desktop-specific `svelte-kit sync` inside `i18n:generate`, because desktop frontend tests depend on synced framework artifacts even before `check` runs

Again, the internal command may differ from website. The external contract is the same.

## CI Design

The frontend workflow should stop encoding Paraglide preparation inline.

Instead, CI should:

1. install dependencies
2. prepare website `.env` as needed for SvelteKit env typing
3. run package generation explicitly
   - `packages/desktop`: `bun run i18n:generate`
   - `packages/website`: `bun run i18n:generate`
4. run existing lint, check, and test steps

This removes:

- direct Paraglide compile commands from workflow YAML
- website build-as-generation behavior
- the heap bump workaround added only to support generation-through-build

## Failure Model

Expected failures after this change:

- if generated files are missing and `check` is run directly, the package should fail clearly
- if `i18n:generate` fails, CI fails before typecheck/build

This is desirable because it makes dependency ordering explicit.

## Verification Plan

For each package:

1. delete `.svelte-kit`
2. delete generated Paraglide output directory
3. run `bun run i18n:generate`
4. verify generated Paraglide files exist
5. run `bun run check`
6. run package tests relevant to the change

For CI:

- verify `.github/workflows/ci.yml` only orchestrates generation via package scripts
- verify no website build step remains solely for Paraglide preparation

## Non-Goals

- changing the i18n library away from Paraglide
- committing generated Paraglide artifacts to git
- redesigning the entire frontend CI matrix
- changing unrelated warnings in `packages/ui`

## Recommended Outcome

Adopt the strict `generate -> check -> build` contract for both frontend packages, with package-local `i18n:generate` scripts and CI invoking those scripts explicitly.
