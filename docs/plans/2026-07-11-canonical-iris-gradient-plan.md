# Canonical Iris Gradient Plan

## Current State

Acepe has several unrelated decorative multi-colour background systems: shared orange and Luminar grain shaders, Iris cards backed by the same shader, desktop onboarding, and separate website login/hero/Zeus shaders. Functional gradients also exist for fades, shimmer, skeletons, controls, progress, and icons; those are outside this change.

## Target State

One shared, regular CSS Iris gradient is the canonical decorative brand background across `packages/ui`, desktop, and website:

```text
base       #ece0ff
pink       #ff9ad1
blue       #a9c2ff
peach      #ffc69d
purple     #b79bff
```

The canonical implementation contains no shader, noise texture, grain overlay, or animation. All decorative multi-colour brand/background callers use it. Functional single-colour fades, overlays, shimmer/skeleton treatments, progress visuals, and icon gradients remain unchanged.

The approved geometry is Horizon. The exact canonical value is `linear-gradient(110deg, #ff9ad1 0%, #ffc69d 22%, #ece0ff 48%, #a9c2ff 72%, #b79bff 100%)`, with `#ece0ff` as the solid fallback, `background-size: 100% 100%`, and `background-repeat: no-repeat`. Callers may not reconstruct or override it.

Classification rule: replace gradients whose job is brand atmosphere or a decorative multi-colour surface. Preserve gradients whose job is legibility, depth masking, progress, loading, state, or self-contained icon/illustration artwork. Animated accent rings are decorative brand gradients and will be removed. Every audited edge case is listed below.

## Affected Files

| File or area | Change | Dependencies |
|---|---|---|
| `packages/ui/src/lib/brand-gradient.ts` | Create canonical Iris CSS gradient contract | Source of truth |
| `packages/ui/src/components/brand-gradient-background/` | Create simple presentational background | Uses canonical contract |
| `packages/ui/src/components/brand-surface/brand-surface.svelte` | Replace shader with regular gradient | Shared desktop surface |
| `packages/ui/src/components/iris-card/iris-card.svelte` | Remove shader preset API | Shared card surface |
| `packages/ui/src/index.ts` | Export canonical API and remove obsolete exports | Public contract |
| `packages/ui/src/components/brand-shader-background/`, `packages/ui/src/lib/brand-shader-*` | Delete obsolete shader code | After caller migration |
| `packages/desktop/src/lib/acp/components/welcome-screen/welcome-screen.svelte` | Use simplified shared surface | Desktop onboarding |
| `packages/website/src/lib/components/animated-background.svelte` | Replace login shader | Login page |
| `packages/website/src/lib/components/hero-shader-stage.svelte` | Replace configurable shader/grain; keep neutral readability fades | Pitch/legacy pages |
| `packages/website/src/lib/components/zeus-shader-stage.svelte` | Replace mesh/ring/grain; keep neutral readability fades | Zeus page |
| `packages/website/src/lib/components/dev-shader-switcher.svelte`, `packages/website/src/lib/dev/shader-*` | Delete obsolete customization path if unused | After hero migration |
| `packages/website/src/routes/+page.svelte`, `packages/website/static/images/landing/hero-grain.jpg` | Replace and delete the root-page grain artwork | Canonical website landing surface |
| `packages/ui/package.json`, `packages/website/package.json`, `bun.lock` | Remove `@paper-design/shaders` after the final import audit | Final cleanup |
| Confirmed legacy decorative multi-colour backgrounds | Replace with canonical gradient | Excludes functional treatments |
| Focused UI/website tests | Prove canonical rendering and no grain/shader | Verification |

### Gradient inventory and disposition

| Candidate | Classification | Disposition |
|---|---|---|
| Shared orange/Luminar grain shaders | Decorative brand atmosphere | Replace with Iris |
| Desktop onboarding `BrandSurface` | Decorative brand atmosphere | Replace with Iris |
| Website `/` hero grain artwork | Decorative brand atmosphere | Replace with Iris and delete `hero-grain.jpg` |
| Website `/login` animated background | Decorative brand atmosphere | Replace with Iris |
| Website `/pitch` and `/old` hero shaders | Decorative brand atmosphere | Replace with Iris |
| Website `/zeus` mesh and pulsing ring | Decorative brand atmosphere | Replace with Iris |
| `/old` browser-mock multi-colour surface | Decorative demo background | Replace with Iris |
| `/old` voice-bar orange shading | Functional illustration depth | Preserve |
| `/pricing` premium-card primary-to-card shading | Functional surface depth | Preserve |
| Per-agent landing artwork images | Self-contained illustration artwork | Preserve |
| Neutral top/bottom fades and vignettes | Readability/depth masks | Preserve |
| Shimmer, skeleton, progress, loading, focus, and icon gradients | Functional/state or icon-local | Preserve |

## Execution Plan

### Phase 1: Canonical contract

1. Add one Iris gradient definition in `packages/ui/src/lib/brand-gradient.ts`.
2. Add a dumb `BrandGradientBackground` component that fills its parent with that CSS gradient.
3. Export both through `packages/ui/src/index.ts`.
4. Add mounted DOM tests proving the canonical computed background renders and the component creates no canvas or grain element. Do not read source files or assert source strings.

Verify with focused `packages/ui` tests and desktop `bun run check`.

### Phase 2: Shared UI and desktop migration

1. Move `BrandSurface` and `IrisCard` to `BrandGradientBackground`.
2. Remove palette/shape/preset props that no longer have meaning.
3. Update desktop onboarding to the simplified surface API.
4. Pass caller QA before deleting the old shared shader renderer, palettes, and panel preset. Delete them only after `rg` proves no callers remain.

Verify with focused UI tests, desktop `bun run check`, then Tauri onboarding QA: `qa doctor`, `qa reset-onboarding`, targeted DOM inspection, and screenshot.

### Phase 3: Website migration

1. Replace login `AnimatedBackground` internals with the shared gradient.
2. Simplify hero and Zeus stages to Iris while preserving neutral readability fades/vignettes.
3. Remove grain films, WebGL canvases, palette overrides, and animated accent-ring gradients.
4. Delete the dev shader switcher/options/preferences if no non-brand use remains.
5. Replace the inventoried legacy decorative backgrounds, including the root-page grain image, without touching the explicit functional exclusions.

Verify by starting `bunx vite dev --host 127.0.0.1 --port 4174` from `packages/website`, then use the installed Playwright library with local Chrome against `/`, `/login`, `/old`, `/pitch`, and `/zeus`. Add stable `data-slot` hooks; assert the computed canonical background, zero canvas/grain descendants, and no page errors. Check light and dark themes at 390×844, 1440×900, and 1920×1080, with screenshots for representative mobile and desktop states.

### Phase 4: Cleanup and final audit

1. Audit for shader imports, grain/noise, palette variants, and hard-coded decorative multi-colour backgrounds.
2. Confirm every remaining gradient matches an explicit functional or icon/illustration-local inventory entry.
3. Remove `@paper-design/shaders` from both package manifests and update `bun.lock` after no imports remain.
4. Run desktop checks, focused UI tests, website verification, Tauri QA, and website screenshots. Check desktop onboarding at the supported minimum window and a representative larger window.
5. Report pre-existing failures separately from regressions.

## Rollback Plan

Before cleanup, keep the old renderer only until every migrated caller passes QA. Fix contrast or layout forward on the canonical gradient; do not create parallel visual paths. Delete the old renderer and dependencies atomically after all callers pass. If the completed replacement must be rolled back after cleanup, revert the entire owned change set. Do not use `git stash` or destructive checkout commands in the dirty worktree.

## Risks

- Removing shaders intentionally removes their motion as well as grain.
- Light text may lose contrast over Iris. Require WCAG 4.5:1 for normal text and 3:1 for large text, focus indicators, and UI boundaries. Use one neutral scrim/content-panel treatment when needed; verify keyboard focus and forced-colour fallback at the named viewports.
- Website check/build currently has unrelated failures; focused tests and live-route QA must separate baseline failures from regressions.
- The worktree has extensive unrelated edits; any later staging must name only owned files.
