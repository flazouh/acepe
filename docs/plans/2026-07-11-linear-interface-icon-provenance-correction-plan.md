# Linear Interface Icon Provenance Correction Plan

## Current state

Acepe's Linear icon extractor reads Chromium cache entries and currently treats every SVG symbol found in Linear's `Root` bundle as one undifferentiated `symbol-sprite` source. The bundle actually contains three named sprite sets: `Base`, `Brands`, and `Decorative`. The generated catalog loses that distinction.

`RoundedIcon` then resolves most Acepe names through `roundedToLinearMap`. The current mapping sends 98 Acepe names to the `Decorative` sprite, 18 to `Base`, 38 to dedicated Linear icon chunks, three to `Brands`, and one to an unclassified shared bundle. Many substitutions are admitted weak fallbacks and do not match the requested interface meaning.

The inventory also does not prove completeness. It extracts dedicated chunks whose file names end in `Icon`, broad symbol sprites, and a small hand-maintained shared-bundle path. It does not trace which glyphs Linear actually uses in product chrome.

## Target state

Acepe uses confirmed interface icon glyphs only. Extraction preserves the source set and runtime evidence needed to distinguish Linear UI chrome from decorative and brand assets. `RoundedIcon` falls back to Acepe's existing glyph whenever there is no exact confirmed interface icon match. Decorative and brand assets remain available in the inventory for review but cannot silently replace interface icons.

Linear visual parity is an explicit goal of this work because the user requested Acepe adopt Linear's interface icon language. Semantic correctness remains the release gate: parity never justifies changing an icon's user intent. Extracted geometry is local-only pending a separate distribution/licensing decision; this plan does not approve publishing Linear assets.

## Constraints

- Preserve the user's dirty worktree and existing icon fixes.
- Do not modify the installed Linear app.
- Keep clean SVG geometry and generated TypeScript deterministic.
- Preserve provider and product brand icons unless a change is explicitly intended.
- Do not use weak semantic substitutions to obtain artificial 100% mapping coverage.
- Source category alone never approves a runtime mapping, including `Base` and dedicated chunks.
- Svelte UI remains presentational in `packages/ui`.
- Run `bun run check` after TypeScript/Svelte changes.
- Verify the real Tauri dev app through the repository QA wrapper.

## Affected files

| File or area | Change |
| --- | --- |
| `scripts/linear-icons/types.ts` | Represent sprite-set and interface-evidence provenance. |
| `scripts/linear-icons/extract-svg-sources.ts` | Preserve `Base`, `Brands`, and `Decorative` ownership while extracting symbols. |
| `scripts/linear-icons/chromium-cache.ts` | Return structured per-entry decode outcomes and full hashed asset identity. |
| `scripts/linear-icons/feature-svg-candidates.ts` | Enumerate SVG constructions independently with Babel AST traversal. |
| `scripts/linear-icons/extract-linear-icons.ts` | Emit provenance in the manifest and deterministic inventory hash. |
| `scripts/linear-icons/generate-website-icon-catalog.ts` | Carry provenance into generated UI catalogs. |
| `scripts/linear-icons/__tests__/` | Add behavior tests for category preservation and deterministic output. |
| Feature-bundle fixtures and coverage tests | Prove action-label linkage and unsupported syntax accounting. |
| `scripts/linear-icons/inventory/coverage.json` | Commit the deterministic snapshot-scoped candidate classification report and its hash. |
| `packages/ui/src/components/icons/rounded-to-interface-map.ts` | Replace total best-effort mapping with an exact confirmed interface mapping. |
| `packages/ui/src/components/icons/resolve-rounded-icon-glyph.ts` | Fall back to Acepe geometry when no confirmed match exists. |
| `packages/ui/src/components/icons/__tests__/` | Prove Base/dedicated use, decorative rejection, brands, and fallback behavior. |
| Generated catalog and inventory files | Regenerate from corrected source metadata. |
| Website design-system icon route | Show provenance and mapping status for visual review; do not add a desktop app route. |
| Root `package.json` and `bun.lock` | Add direct `@babel/parser`, `@babel/traverse`, and matching type dependencies. |

## Execution plan

### Phase 1: provenance model — TDD

1. Add a failing inventory test using a fixture with `Base`, `Brands`, and `Decorative` containers from a `Root`-style bundle.
2. Assert that public manifest entries retain their sprite-set provenance.
3. Bump the manifest schema version and make catalog generation reject older manifests that lack provenance.
4. Preserve source occurrences separately from deduplicated geometry. Aggregate provenance onto a geometry record without allowing the first duplicate owner to erase a later `Base` or observed occurrence.
5. Update extraction types and parsing minimally until the test passes.
6. Regenerate the real inventory and confirm category counts against the installed Linear bundle.

Verification:

- `bun test scripts/linear-icons/__tests__/linear-icon-inventory.test.ts`
- Run extraction twice and compare hashes and generated output.

### Phase 2: safe runtime resolution — TDD

1. Add a failing test proving an unmapped or decorative-only Acepe icon keeps its existing Acepe SVG.
2. Add a failing test proving an icon with explicit approved interface evidence resolves to Linear geometry; `Base` or dedicated provenance without evidence must still fall back.
3. Change the mapping API from total best-effort coverage to an explicit partial confirmed-interface mapping.
4. Make `resolveRoundedIconGlyph` use Acepe geometry by default.
5. Remove weak mappings and notes that normalize misleading substitutions.

Verification:

- Focused icon mapping and resolver tests.
- UI package icon test suite.

### Phase 3: actual interface icon evidence

1. Inspect the installed Linear Electron app through macOS Computer Use/accessibility and screenshots. Where the rendered DOM is not directly exposed, correlate the visible control label and geometry with the cached `Root` sprite or dedicated component chunk; do not infer component identity from appearance alone.
2. Trace observed glyph ids/components back to cached bundle geometry. Record the installed Linear version from `Info.plist`, asset chunk name, geometry hash, Linear surface, visible/control label, and observation method.
3. Produce an evidence-backed candidate mapping record only; Phase 3 does not edit runtime mappings.
4. Record evidence in deterministic metadata. Volatile timestamps and local paths stay out of the hash.

An approved mapping must satisfy every rule:

- The Linear glyph was observed on a control or state with the same user intent as the Acepe control.
- Direction, state, and enabled/disabled meaning match where relevant.
- Evidence names the Linear surface and control label and identifies the Linear build and geometry.
- The geometry belongs to the observed source occurrence; category alone is insufficient.
- Any uncertain or merely similar case remains unmapped and uses the Acepe fallback.

Evidence attaches to a source occurrence and references its geometry hash. A deduplicated geometry may have several occurrences with different categories; approval applies only to the observed occurrence and intended Acepe meaning.

Verification:

- Every active mapping has source category plus observed interface evidence.
- No active mapping targets `Decorative` or `Brands` unless a narrowly documented component intentionally renders that category.

### Phase 4: visual implementation

1. Ask Claude Code to inspect the confirmed Linear and Acepe icon sheets and implement only the approved candidate mappings from Phase 3. Claude owns visual implementation but does not broaden provenance approval.
2. Preserve icon control dimensions, accessible labels, current-color behavior, and interaction states.
3. Update the design-system page with this review order: active confirmed mappings first, Acepe fallbacks second, rejected decorative/brand inventory last. Each active row compares the Acepe and Linear glyph side by side and shows mapping status, source set, Linear surface/control label, and evidence state.
4. Express provenance and mapping status with visible text, not color alone. Any filtering, disclosure, or comparison controls must be keyboard accessible and expose labels to assistive technology.

Verification:

- Claude reports changed files and visual choices.
- `bun run check` from `packages/desktop`.

### Phase 5: review and desktop QA

1. Run focused tests and the relevant full suites.
2. Run code review and resolve all findings.
3. Start or refresh the development Tauri app if needed.
4. Run `bun run qa doctor`, `observe`, targeted `inspect`, and `screenshot` on the design-system page. Inspect named production flows: sidebar project/session navigation; sidebar footer settings and updater controls; command/search palette; settings navigation; composer submit, mode, microphone, and attachment controls; agent-panel tool/status rows; and pull-request status cards. Exercise at least one menu/filter interaction and inspect its resulting DOM state.
5. Confirm no missing glyph crashes and no decorative icon leakage.

## Rollback and recovery

If extraction regeneration becomes unstable, keep the previous generated catalog and land the safe runtime fallback independently. If visual mappings prove ambiguous, remove those mappings and keep Acepe's prior glyph rather than substituting a merely similar Linear asset. Never reset or discard unrelated worktree changes.

## Risks

- The `Root` bundle format and minified variable names may change. Detect sprite-set containers by rendered wrapper metadata or explicit parser fixtures, not only variable names.
- Runtime inspection may not expose every lazy-loaded screen. Mapping coverage must reflect observed evidence rather than claim completeness.
- Existing uncommitted icon edits overlap this work. Apply narrow patches and inspect diffs before each generation step.
- Linear assets may have distribution restrictions; keep provenance explicit for licensing review.

## Completion evidence

- Manifest entries distinguish `Base`, `Brands`, `Decorative`, dedicated chunks, and shared sources.
- Active runtime mappings contain no unapproved decorative/brand targets.
- Unmapped Acepe icons render their original SVG geometry.
- Confirmed Interface icons render Linear geometry.
- Extraction and generated catalogs are deterministic.
- Typecheck and focused/full tests pass.
- Tauri DOM inspection and screenshots prove the design-system catalog and representative app surfaces.

## Addendum: feature-bundle icon completeness

The initial 437-icon inventory is not complete. A live Linear issue menu proves that `Copy ID` uses a normal two-path SVG component (`bS`) embedded in `AgentToolbarActions.*.js`. The existing extractor can decode the component when isolated but skips the containing bundle because it is neither a dedicated `*Icon*` chunk nor the hard-coded shared bundle.

### Scope

1. Add a minimized, behavior-level `AgentToolbarActions` fixture at the public `extractIconsFromCacheEntry(assetName, sourceText)` seam. The first red assertion requires the action labeled `Copy ID` to produce a semantic `CopyIdIcon` entry with the known two-path geometry.
2. Freeze the decoded cache-entry corpus before parsing. Sort entries by full hashed asset name plus content hash, record the installed Linear build, locale, input-corpus hash, decoded/corrupt/skipped entry counts, and run both determinism passes against that immutable in-memory snapshot. Coverage claims apply only to this recorded snapshot. Never collapse different hashed chunks into one provenance key.
3. Build an independent AST candidate enumerator over every JavaScript entry using direct `@babel/parser` and `@babel/traverse` dependencies in unambiguous ESM mode. One atomic candidate is one SVG construction source span; its nearest function/component is context metadata, never a second candidate. Discover JSX-runtime import bindings and local aliases, including `(0, alias.jsx)("svg", ...)`, member calls, and `React.createElement("svg", ...)`. One function with several SVG constructions emits several candidates. Candidate identity is `full hashed asset name + source fingerprint + source span`; geometry hash remains the deduplication identity.
4. Use one closed compact-icon predicate for both extraction and reporting: a finite numeric viewBox with positive width and height no larger than 24×24; supported literal children are `path`, `circle`, `rect`, `line`, `polyline`, and `polygon`. Nested components, masks, clip paths, transforms, dynamic geometry, missing/non-finite viewBoxes, and larger SVGs remain candidates but receive stable exclusion reason codes instead of disappearing.
5. Generalize semantic evidence independently of geometry discovery. Build a module import/export index over the frozen corpus so action references can resolve both same-bundle and cross-chunk component declarations. Naming evidence may come from an explicit action label, `aria-label`, tooltip, exported symbol, or registry key. Unsupported or unlabeled candidates remain in coverage under their stable provenance identity. Completion requires zero unresolved references for the captured issue-menu set and zero AST candidates lacking a terminal status; overall `complete` remains false while any cross-chunk reference is unresolved.
6. Add the `feature-jsx` source type through the provenance model, manifest schema, catalog generator, generated types, tests, and design-system source filter.
7. Keep record identity independent from localized labels. Each geometry aggregates sorted semantic aliases and source occurrences. Display-name precedence is: shortest explicit English action/ARIA/tooltip label, exported symbol, registry key, shortest localized label, then `feature-svg-<geometry-hash-prefix>`. Ties sort lexically. Identical display names with different geometry gain a stable geometry-hash suffix. One component used by several labels remains one geometry with several aliases. Several components using the same label remain separate records only when their geometry hashes differ; identical geometry hashes deduplicate and retain every sorted source occurrence.
8. Emit `scripts/linear-icons/inventory/coverage.json` with schema version, corpus/build/locale metadata, aggregate counts, a top-level `complete` boolean, structured cache-decode and AST-parse outcomes, and one row per AST candidate: candidate identity, full source asset, source fingerprint/span, owner metadata, status (`extracted`, `excluded`, or `needs-review`), closed reason code, linked geometry hash when extracted, and semantic evidence. Allowed exclusion codes are `not-compact`, `unsupported-child`, and `dynamic-geometry`; `cross-chunk-unresolved` and `missing-semantic-evidence` are non-complete `needs-review` states, not successful exclusions. A compact candidate cannot be dismissed as `non-icon-svg`; without objective icon evidence it stays visible as `needs-review`. Any decoded JavaScript AST parse failure aborts catalog generation and is tested alongside corrupt cache outcomes.
9. Regenerate UI and website catalogs and verify the captured issue-menu set explicitly: `copy-id`, `copy-url`, `copy-title`, `copy-title-as-link`, `copy-description-as-markdown`, `copy-content-as-markdown`, `copy-git-branch-name`, `copy-as-prompt`, and `make-a-copy`. Do not activate new Acepe runtime mappings without separate same-intent UI evidence.

### Verification

- Red/green regression test for `Copy ID` through `extractIconsFromCacheEntry`.
- Fixture tests for JSX-runtime aliases, sequence/member calls, `React.createElement`, one/many SVGs per owner, shared-component aliases, repeated/localized labels, unsupported dynamic labels, cross-chunk references, corrupt cache data, AST parse failure, and unsupported SVG syntax that must remain visible in the denominator.
- Two consecutive extractions over the same frozen corpus produce identical manifests, coverage reports, and catalog hashes.
- Focused extractor and icon tests pass.
- Browser QA inspects the website `design-system-icon-tile-copy-id` and inventory summary, then captures a screenshot.
