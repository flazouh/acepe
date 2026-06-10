# Forbidden imports in `@acepe/ui`

Single source of truth for the UI package boundary. The import guard script reads the machine rules from [`scripts/ui-package-forbidden-import-rules.ts`](../../../../scripts/ui-package-forbidden-import-rules.ts).

## Forbidden patterns

| Rule ID | Pattern | Why |
|---------|---------|-----|
| `tauri-apps` | `@tauri-apps/*` | Tauri runtime belongs in desktop Controller |
| `desktop-lib-store` | `$lib/store`, `$lib/store/*` | Desktop store alias |
| `desktop-lib-services` | `$lib/services`, `$lib/services/*` | Desktop services alias |
| `desktop-lib-paraglide` | `$lib/paraglide`, `$lib/paraglide/*` | Desktop i18n alias |
| `ui-lib-store` | `*/lib/store/*`, `$lib/store/*` | Store-like paths inside UI package |
| `paraglide` | `*/paraglide/*` | i18n modules — pass copy as props |
| `acepe-desktop` | `@acepe/desktop`, `@acepe/desktop/*` | Desktop package |
| `packages-desktop-path` | Any specifier containing `packages/desktop` | Cross-package relative imports |
| `svelte-sonner` | `svelte-sonner`, `svelte-sonner/*` | Toast runtime |

## Allowed (common false positives)

- `$lib/utils`, `$lib/*` paths that resolve to `packages/ui/src/lib/**` (except store/paraglide)
- Comments mentioning `packages/desktop` (guard parses import statements only)
- Peer dependencies imported by shared UI primitives (`bits-ui`, `phosphor-svelte`, etc.)

## Governance — adding an exception

1. Prefer fixing the extraction seam (move import to Controller/Model) before adding exceptions.
2. If a dependency is genuinely shared and presentational, add a rule exception in `scripts/ui-package-forbidden-import-rules.ts` with a comment explaining why.
3. Update this file with the same rationale.
4. Run `cd packages/ui && bun test` — import guard must pass.
5. Note the exception in the PR description.

## Enforcement

- **Import guard:** `bun ../../scripts/forbid-ui-package-imports.ts src` (runs before unit tests)
- **Behavioral smoke:** `packages/ui/src/__tests__/ui-package-boundary.dom.vitest.ts`

v1 does **not** automatically lint `$effect` for remote fetch or store reads inside View — those are skill policy rules for new extractions.
