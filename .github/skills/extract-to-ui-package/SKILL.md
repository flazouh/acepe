---
name: extract-to-ui-package
description: "Extract presentational UI from packages/desktop into @acepe/ui using MVC (Controller, Model, View). Use when moving a component to packages/ui, creating a shared UI primitive, splitting a smart Svelte file, or when the user mentions UI extraction, dumb view, thin wrapper, or @acepe/ui boundary."
argument-hint: "[optional: component path or feature area]"
---

# Extract to UI Package

Move presentational UI from `packages/desktop` into `@acepe/ui` using Acepe's **MVC** vocabulary. Read [`references/pattern-catalog.md`](references/pattern-catalog.md) for canonical examples.

## When to invoke

- Before extracting or creating any component in `packages/ui`
- Before splitting a smart desktop `.svelte` into shared View + desktop Controller
- When reviewing whether code belongs in View vs desktop

## When to stop

- **`god-architecture-check` blocks** — session/canonical fixes belong upstream, not in View extraction
- Extraction would move store/Tauri/session policy into View — stop and redesign the seam
- The change is session-shaped data only (no UI move) — use `god-architecture-check`, not this skill

## MVC layers

| Layer | Package | Owns |
|-------|---------|------|
| **View** | `packages/ui` `.svelte` | Markup, props, callbacks, snippets, `$derived` from props |
| **View helpers** (optional) | `packages/ui` `*-state.ts` / `*-effects.ts` | Pure prop derivations; UI-local persistence (localStorage) |
| **Model** | `packages/desktop` pure TS | Domain → view prop mapping |
| **Controller** | `packages/desktop` wrapper `.svelte` | Stores, Tauri, fetch, wires Model → View, handles callbacks |

**Seam decision rule:**

1. Store / Tauri / session graph → **Controller + Model**
2. Pure function of view props → **`$derived` in View**, or **View `*-state.ts`** when non-trivial (agent-panel pattern)
3. UI-local persistence only → **View `*-effects.ts`** (rare)
4. User action mutating session or calling Tauri → **callback → Controller**

Default: **props + `$derived` in View, else desktop Model**. Do not require view helpers for every extraction.

## Pre-flight seam audit

Before moving code, list:

- [ ] Props the View needs
- [ ] Callbacks (user actions → Controller)
- [ ] Snippets (layout shells)
- [ ] Store reads (must stay Controller)
- [ ] Tauri / service calls (must stay Controller)
- [ ] `$effect` uses (remote fetch must stay Controller; no new `$effect` in View for fetch)
- [ ] i18n strings (pass English copy as props — no paraglide in View)

Classify pattern: **leaf** | **smart-wrapper** | **layout-shell** | **scene-board** (see pattern catalog).

## Extraction workflow

```
Task Progress:
- [ ] 1. Seam audit + pattern classification
- [ ] 2. Session-shaped? → god-architecture-check; abort if blocked
- [ ] 3. Create or extend View in packages/ui/<feature>/
- [ ] 4. Add view helpers only if needed (*-state.ts / *-effects.ts)
- [ ] 5. Add desktop Model if domain mapping required
- [ ] 6. Replace desktop markup with thin Controller importing @acepe/ui
- [ ] 7. Export from feature index.ts + packages/ui/package.json if new subpath
- [ ] 8. Update website fixture if demo exists (see below)
- [ ] 9. Verification gate
- [ ] 10. Attestation
```

### Per-pattern emphasis

| Pattern | Extra step |
|---------|------------|
| Leaf widget | Props + optional view helpers |
| Smart wrapper | Desktop Model file required |
| Layout shell | Snippet props for host injection |
| Scene board | Model builds full scene DTO |

## Forbidden patterns

See [`references/forbidden-imports.md`](references/forbidden-imports.md).

- No Tauri, desktop stores, paraglide, or `svelte-sonner` in View
- No `$effect` for remote fetch in **new** View code
- No provider-specific branching in View
- No spread in new TypeScript (repo convention)
- English copy via props for user-visible strings

## Verification gate

Run in order; fix and re-run on failure.

```bash
cd packages/ui && bun test
cd packages/desktop && bun run check
# Scoped tests for touched desktop modules:
cd packages/desktop && bun test path/to/relevant.test.ts
```

`packages/ui` `bun test` runs:

1. `scripts/forbid-ui-package-imports.ts` — dependency boundary
2. `scripts/forbid-structural-tests.ts` — no readFileSync in `*.test.ts`
3. Unit tests including `src/__tests__/ui-package-boundary.test.ts`
4. DOM vitest including `ui-package-boundary.dom.vitest.ts`

**UI-visible changes:** invoke `acepe-dev-app-qa` after checks pass.

## Output contract — attestation

```markdown
## UI extraction attestation

**Component:** [name]
**Pattern:** leaf | smart-wrapper | layout-shell | scene-board

| Concern | Layer | File |
|---------|-------|------|
| Markup | View | packages/ui/... |
| Prop mapping | Model | packages/desktop/... (or —) |
| Store/Tauri wiring | Controller | packages/desktop/... |

**Verification:**
- [ ] cd packages/ui && bun test
- [ ] cd packages/desktop && bun run check
- [ ] [scoped desktop tests]
- [ ] acepe-dev-app-qa (if UI-visible)

**Fixture updated:** yes | no | n/a
```

Example dry-run: [`references/dry-run-session-list-project-card.md`](references/dry-run-session-list-project-card.md)

## Test migration

- **Controller/Model tests** stay in `packages/desktop`
- **View render smoke** belongs in `packages/ui` (prop-driven fixtures)
- Do not move store-integration tests into `packages/ui`

## Website fixture lookup

1. Search `packages/website/src/lib/components/` for `*demo*.svelte` or feature name
2. Search `packages/website/src/routes/` for imports of the feature folder
3. If found, update fixture with same View + mock props
4. If not found, note `Fixture updated: n/a` in attestation

## Cross-skill handoffs

| Situation | Also invoke |
|-----------|-------------|
| Session/transcript/tool display | `god-architecture-check` |
| UI-visible change | `acepe-dev-app-qa` |
| Large multi-file extraction | `refactor-plan` or `/ce:plan` first |
| Svelte rune/effect questions | `svelte-core-bestpractices`, `.agent-guides/svelte.md` |

## v1 enforcement scope

- **Automated:** forbidden imports (`forbid-ui-package-imports.ts`), prop-driven render smoke
- **Policy only (new extractions):** no store reads, no remote-fetch `$effect` in View — not fully linted for legacy UI files

## Additional resources

- [`references/pattern-catalog.md`](references/pattern-catalog.md) — four canonical MVC examples
- [`references/forbidden-imports.md`](references/forbidden-imports.md) — boundary rules + governance
