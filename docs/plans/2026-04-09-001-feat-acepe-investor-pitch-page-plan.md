---
title: feat: Add Acepe investor pitch page
type: feat
status: active
date: 2026-04-09
origin: docs/brainstorms/2026-04-09-acepe-pitch-requirements.md
---

# feat: Add Acepe investor pitch page

## Overview

Add a dedicated investor pitch page inside `packages/website` that presents Acepe as a seed-stage investor story in a one-page, section-per-slide format. The page should reuse Acepe's real website and shared UI branding primitives — especially the brand shader, logo treatment, fonts, and card styling — and support a Playwright-generated PDF export from the same web source of truth. The story should position Acepe as the platform-neutral operating layer for agentic development, not a product tied to one harness, while presenting team-first monetization and a future first-party agent as upside rather than lock-in.

## Problem Frame

Acepe needs an investor-ready pitch that feels native to the product brand, not like a detached slide deck. The origin requirements establish a website-first pitch with PDF export, a desktop-first presentation model, and a ten-section seed narrative. Planning needs to turn that into a concrete route, content structure, print/export path, and test strategy without creating a second deck system or inventing a new visual language. (see origin: `docs/brainstorms/2026-04-09-acepe-pitch-requirements.md`)

## Requirements Trace

- R1-R6. Seed/pre-seed investor audience, category-level framing, stronger workflow problem framing, platform-neutral thesis, first-party agent as platform extension
- R7-R11. Website-first source of truth with Playwright PDF export from shared print CSS and canonical story structure
- R12-R19. Reuse Acepe brand language, implement inside `packages/website`, use real shared UI primitives, desktop-first presentation, honest claims handling
- R20-R26. Early traction handling, why-now / why-Acepe / monetization story, claims policy, ten-section canonical arc
- R27. Use splash-derived opening treatment as the hero/title-slide reference when feasible

## Scope Boundaries

- V1 is a dedicated route page, not a homepage redesign
- V1 does not require top-level header navigation, sitemap promotion, or broader marketing IA changes
- V1 does not require pixel-perfect website/PDF parity if the exported PDF remains readable and investor-ready
- V1 does not require final fundraising metrics, financial projections, or hard market-sizing numbers
- V1 does not require a PowerPoint-first asset or a second maintained deck format

## Context & Research

### Relevant Code and Patterns

- `packages/website/src/routes/+page.svelte` — existing long-form landing page pattern already using `BrandShaderBackground`, `BrandLockup`, shared UI primitives, and Acepe marketing typography
- `packages/website/src/routes/download/+page.svelte` — route-level composition using Acepe-style cards, restrained chrome, and marketing copy layout
- `packages/website/src/routes/layout.css` — website-wide design tokens, Acepe font configuration, theme tokens, and the right seam for print-specific CSS
- `packages/website/src/routes/compare/[slug]/+page.svelte` and `packages/website/src/routes/compare/[slug]/page.test.ts` — route-level rendering pattern with server-render tests
- `packages/website/src/routes/landing-hero-assets.test.ts` — source-contract testing style for marketing presentation details
- `packages/ui/src/components/brand-shader-background/brand-shader-background.svelte` — shared shader background primitive to reuse directly
- `packages/ui/src/components/brand-lockup/brand-lockup.svelte` — shared Acepe logo/wordmark pattern for route branding

### Institutional Learnings

- No relevant `docs/solutions/` entries were present for this feature area during planning research.

### External References

- None used. The repo already has strong local patterns for SvelteKit route composition, brand reuse, and marketing-page testing, so planning stayed codebase-first.

## Key Technical Decisions

- **Implement as a dedicated website route:** Use `packages/website/src/routes/pitch/+page.svelte` so the pitch lives inside the existing site without coupling v1 to the homepage.
- **Use a content-model-driven route:** Keep the ten investor sections in a typed content module so the story order, claims metadata, and anchor ids are testable and easier to revise without rewriting layout code.
- **Pitch the platform, not one harness:** The content model and rendered story should make Acepe feel harness-neutral and platform-first, with any Acepe-native agent framed as a first-party citizen inside the platform.
- **Reuse real shared brand primitives:** Use `BrandShaderBackground`, `BrandLockup`, website tokens from `src/routes/layout.css`, and existing card/panel visual language instead of rebuilding brand styling inside the route.
- **Single-page anchored deck:** Use one page with one anchored section per slide, plus progress and previous/next affordances, to satisfy both browsing and PDF export requirements.
- **Desktop-first 16:9 print model:** Design against a 1600x900 presentation viewport and export as 13.333in x 7.5in landscape PDF pages, with 64px outer padding, a non-scrolling slide body, and a hard per-slide vertical budget.
- **Responsive cutoff is explicit:** Preserve the slide/navigation model at desktop widths and switch to a simpler stacked-reading mode below the desktop breakpoint rather than forcing full slide behavior onto smaller screens.
- **Interaction model is deterministic:** Desktop mode should use anchored sections with active-section tracking, URL hash sync, previous/next controls, Arrow/PageUp/PageDown keyboard navigation, visible focus states, and semantic headings/landmarks; print mode hides controls; reduced-motion mode disables animated transitions/smooth scrolling.
- **Section composition is constrained by archetypes:** Use a small set of approved slide archetypes so the pitch stays visually coherent across ten sections rather than improvising each slide independently.
- **Playwright export script inside the website package:** Add a dedicated script under `packages/website/scripts/` so export belongs to the same codebase as the route and print styles.
- **Estimated metrics are allowed only when explicitly labeled:** Route content should support dated/verified numeric proof when available, and may render clearly labeled estimated numeric proof when the origin requirements permit it; otherwise it must fall back to qualitative wording.
- **Business model is team-first:** The business model section should center on generous solo adoption, team-managed agent workflows as the first paid wedge, enterprise as the upscale extension, and a future first-party agent as optional upside rather than the core lock-in model.
- **Export script owns route resolution:** The PDF export script should accept an optional base URL override for CI/remote execution and otherwise start and stop a local website preview itself so export is repeatable without manual server setup.
- **PDF verification stays in the export seam:** Node-side route tests should lock structure/print selectors, while the export script and its focused tests should own page-count/page-size verification against a generated PDF artifact.
- **Overflow is a failure, not an auto-fix:** If a section cannot fit the agreed 16:9 slide budget, verification should fail and the content/layout must be tightened instead of shrinking or clipping silently.
- **Deterministic export artifact path:** V1 export should write to a stable artifact location under the website package unless an explicit output override is provided.

## Open Questions

### Resolved During Planning

- **Where should the pitch live?** As a dedicated route page inside `packages/website`, not as a separate app or microsite.
- **What is the presentation model?** One-page route with one anchored section per slide.
- **How should PDF export work?** A Playwright-generated PDF using the same route and print CSS as the web experience.
- **What viewport should define quality?** Desktop-first presentation quality, with graceful degradation on smaller screens.
- **What is the canonical v1 story arc?** Title, Problem, Why current workflows fail, Solution, Product, Market / Why now, Traction, Business model, Team, Ask.
- **How should monetization appear in the pitch?** As a clear team-first business model thesis inside the investor story rather than a fully validated pricing table.

### Deferred to Implementation

- **Exact investor copy:** Final wording for each section should be refined during execution, especially for positioning nuance and raise framing.
- **Verified traction values:** Exact dated metrics for users/stars and any additional proof points remain research inputs, not planning blockers.
- **Final PDF output filename/location:** The export script should choose a sensible artifact path during implementation without making the repo structure depend on generated files.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
flowchart TD
    A[Pitch content module\nsection ids + copy + proof metadata] --> B[/pitch route]
    C[Shared UI brand primitives\nBrandShaderBackground / BrandLockup / cards] --> B
    D[Website layout.css tokens\nfonts + theme + print rules] --> B
    B --> E[Single-page anchored investor deck]
    E --> F[Browser presentation mode]
    E --> G[Print CSS page model]
    G --> H[Playwright export script]
    H --> I[Landscape PDF\n1 page per section]
```

### Section Archetype Matrix

| Archetype | Intended sections | Approved composition |
|---|---|---|
| Hero | Title | Shader-backed hero, brand lockup, strong headline/subheadline, minimal supporting chrome |
| Narrative | Problem, Why current workflows fail, Solution, Market / Why now | One dominant claim area plus supporting card(s), restrained supporting visuals, reading-first hierarchy |
| Product / Proof | Product, Traction, Business model | Product card or system view plus structured proof blocks, metric/claim cards, print-safe surfaces |
| Closing | Team, Ask | Compact credibility cards, clear closing statement, next-step / raise framing |

### Geometry and Readability Contract

- Browser presentation target: **1600x900**
- PDF page target: **13.333in x 7.5in landscape**
- Slide padding target: **64px** outer margin on desktop and print
- Slide body rule: **no internal scrolling inside a slide**
- Overflow rule: **overflow fails verification**
- Readability floor: supporting copy should stay presentation-readable; density should be reduced before shrinking typography below comfortable deck-reading sizes
- Allowed browser/PDF differences: print may flatten shader-heavy visuals and hide interactive chrome, but section order, slide count, hierarchy, and core brand context must remain intact

## Implementation Units

- [ ] **Unit 1: Define the pitch route contract and content model**

**Goal:** Establish the dedicated pitch route, canonical ten-section content structure, and claims metadata model so story order, platform thesis, monetization story, and proof handling are testable.

**Requirements:** R1-R11, R20-R26

**Dependencies:** None

**Files:**
- Create: `packages/website/src/lib/pitch/types.ts`
- Create: `packages/website/src/lib/pitch/content.ts`
- Create: `packages/website/src/routes/pitch/+page.svelte`
- Test: `packages/website/src/routes/pitch/page.test.ts`

**Approach:**
- Define a typed section model that captures id, title, narrative role, and optional proof metadata for traction/claims-sensitive sections.
- Keep the canonical section order in one content source so the route and export both derive from the same structure.
- Treat unverified numeric proof as optional data and provide qualitative fallbacks in the content contract instead of hard-coding approximate figures into layout markup.
- Treat proof values as three states in the content contract: verified numeric, estimated numeric with explicit labeling metadata, or qualitative-only fallback.
- Encode the investor thesis in the content contract itself: title framing, problem framing around unreliable/hard-to-govern multi-agent workflows, a clear "why Acepe wins" section/subsection, explicit raise-unlock messaging, platform-neutral positioning, and the team-first monetization model.
- Add explicit section-level semantics and test hooks such as `data-pitch-root` and per-slide identifiers so navigation, readiness checks, and export tests share the same route contract.

**Execution note:** Start with route-level contract tests for section count, order, required narrative beats, and claims behavior. Treat exact copy quality as content refinement, not a hard blocker for the first structural implementation pass.

**Patterns to follow:**
- `packages/website/src/routes/compare/[slug]/+page.svelte`
- `packages/website/src/routes/compare/[slug]/page.test.ts`

**Test scenarios:**
- Happy path — rendering the route includes all ten required sections in the exact canonical order with stable anchor ids.
- Happy path — the route includes dedicated sections for why current workflows fail, why now, business model, team, and ask rather than collapsing them into broader copy blocks.
- Happy path — the content model contains explicit structured beats for platform thesis, monetization thesis, and raise-unlock messaging, even if final wording is refined later.
- Edge case — when a traction metric lacks verified numeric metadata, the rendered section falls back to qualitative wording instead of printing an unverified number.
- Edge case — when a traction metric is estimated rather than verified, the rendered section preserves the numeric value only if it is explicitly labeled as an estimate with supporting metadata.
- Edge case — if a content edit removes one of the required investor-thesis beats (problem framing, differentiation, monetization, raise unlock), route-level tests fail instead of silently shipping a weaker pitch.
- Error path — the content module rejects or fails loudly on missing required section ids/titles instead of silently rendering an incomplete deck.
- Integration — the route consumes the shared content model without duplicating section definitions inside `+page.svelte`.

**Verification:**
- The route can be rendered from one content source, and tests lock the investor story structure plus claims policy behavior.

- [ ] **Unit 2: Build the branded investor-deck page shell**

**Goal:** Compose the pitch as a page inside the website using real Acepe brand primitives, splash-inspired hero treatment, and shared card/chrome patterns.

**Requirements:** R4, R10-R17, R24

**Dependencies:** Unit 1

**Files:**
- Create: `packages/website/src/lib/components/pitch/pitch-shell.svelte`
- Create: `packages/website/src/lib/components/pitch/pitch-slide.svelte`
- Modify: `packages/website/src/routes/pitch/+page.svelte`
- Test: `packages/website/src/routes/pitch/page.branding.test.ts`

**Approach:**
- Extract a pitch shell and slide component if that improves reuse/readability; otherwise keep only the route plus the minimal helpers needed for maintainability.
- Use `BrandShaderBackground` as the page backdrop or hero backdrop, `BrandLockup` for page branding, and existing website card/panel language for slide surfaces.
- Keep the opening slide visually closest to Acepe's splash/onboarding feel without copying desktop-specific behavior wholesale.
- Avoid header/nav-heavy marketing chrome that would weaken the investor-deck presentation.
- Apply the section archetype matrix so hero, narrative, proof, and closing slides share a disciplined composition system rather than ad hoc section styling.

**Execution note:** Add branding/source-contract tests before refining visual polish so regressions in shader/lockup/card usage stay obvious.

**Patterns to follow:**
- `packages/website/src/routes/+page.svelte`
- `packages/website/src/routes/download/+page.svelte`
- `packages/ui/src/components/brand-shader-background/brand-shader-background.svelte`
- `packages/ui/src/components/brand-lockup/brand-lockup.svelte`

**Test scenarios:**
- Happy path — the page uses `BrandShaderBackground` and shared Acepe lockup/logo treatment rather than route-local reimplementations.
- Happy path — slide surfaces use website/shared card styling patterns consistent with Acepe brand tokens.
- Edge case — if the shader component falls back before initialization, the hero remains readable and visually on-brand.
- Integration — the page inherits website theme tokens/fonts from `src/routes/layout.css` without introducing duplicate local token definitions.
- Integration — the route stays isolated to `/pitch` and does not require modifying the homepage to render correctly.

**Verification:**
- The route looks and reads like an Acepe page, and branding tests prove it reuses the actual shared primitives rather than approximating them.

- [ ] **Unit 3: Add presentation navigation and print-slide styling**

**Goal:** Turn the route into a presentation-quality anchored deck with section navigation, progress cues, and print CSS that maps one section to one PDF page.

**Requirements:** R6-R7, R13-R16

**Dependencies:** Units 1-2

**Files:**
- Create: `packages/website/src/lib/components/pitch/pitch-progress-nav.svelte`
- Modify: `packages/website/src/routes/pitch/+page.svelte`
- Modify: `packages/website/src/routes/layout.css`
- Test: `packages/website/src/routes/pitch/print-contract.test.ts`

**Approach:**
- Add anchored section ids and a lightweight progress/navigation UI with previous/next affordances suitable for both browsing and presenting.
- Use print-specific CSS in `src/routes/layout.css` or a pitch-specific imported stylesheet to force one narrative section per landscape page.
- Treat one-section-per-page as a hard layout contract: if a section exceeds the 16:9 print budget, the export/verification flow should fail rather than silently scale or clip content.
- Define the desktop slide canvas explicitly: 1600x900 browser viewport, 13.333in x 7.5in print page, fixed outer padding, and a per-slide content budget that leaves room for chrome without overflow.
- Ship-now scope: anchors, stable section ids, basic previous/next navigation, print CSS, semantic headings/landmarks, visible focus states, and non-breaking hash links.
- Defer-if-needed scope: active-section tracking, richer progress state, advanced keyboard shortcuts beyond standard link/focus navigation, reduced-motion refinements, and smaller-screen polish beyond graceful stacked reading.
- Use active-section detection plus URL hash sync to keep browser navigation, deep-linking, and export section order aligned when included in the first pass or a follow-up refinement.
- Define the accessibility contract explicitly: semantic section headings/landmarks, visible focus states, maintained URL hash behavior, and sufficient foreground/background contrast even when shader visuals fall back.
- Hide or simplify web-only controls in print mode while preserving the slide body content and brand context.
- Keep mobile/tablet support in graceful-degradation territory by disabling the strict slide metaphor and switching to stacked reading below the desktop breakpoint.
- Disable smooth-scroll / motion-heavy transitions in reduced-motion mode.

**Patterns to follow:**
- `packages/website/src/routes/layout.css`
- `packages/website/src/routes/landing-hero-assets.test.ts`

**Test scenarios:**
- Happy path — each section exposes a stable anchor target and the progress/navigation UI points to the correct previous/next section ids.
- Happy path — desktop mode tracks the active section and keeps the URL hash/progress state in sync as the reader advances through the deck.
- Happy path — desktop keyboard navigation advances and reverses slides without breaking focus visibility or hash state.
- Edge case — the first section has no previous action and the last section has no next action, without broken links.
- Edge case — reduced-motion mode removes animated navigation behavior without breaking anchor navigation or slide order.
- Edge case — smaller viewports still render readable stacked content even when they do not preserve the full slide experience.
- Integration — print CSS applies one page break per anchored section and removes non-essential chrome from exported output.
- Integration — the route preserves the same section order between browser mode and print mode.
- Integration — oversized slide content causes verification failure rather than producing clipped or auto-shrunk PDF output.
- Integration — headings/landmarks, visible focus, and contrast remain acceptable when shader visuals are reduced or replaced by fallback backgrounds.

**Verification:**
- Browser presentation and print layout both use the same content/section structure, and print-contract tests lock the per-section page behavior.

- [ ] **Unit 4: Add Playwright PDF export from the website route**

**Goal:** Provide a scripted export path that generates the investor deck PDF directly from the `/pitch` page.

**Requirements:** R5-R7, R15-R16

**Dependencies:** Units 1-3

**Files:**
- Modify: `packages/website/package.json`
- Create: `packages/website/scripts/export-pitch-pdf.ts`
- Test: `packages/website/scripts/export-pitch-pdf.test.ts`

**Approach:**
- Add Playwright as the export engine within the website package and keep the export logic in a dedicated script.
- Have the script accept an optional base URL override; when absent, it should boot a local website preview on a known port, wait for both `/pitch` and a route readiness selector such as `[data-pitch-root]`, export, and tear the preview process down itself.
- Have the script open the pitch route in a desktop-sized viewport, apply the route's print model, and write a landscape PDF.
- Write the default artifact to a stable path under the website package, while allowing an explicit output-path override for CI/manual exports.
- Treat Playwright Chromium as an explicit prerequisite of the export flow; if the browser runtime is missing, the script should fail with a clear remediation message.
- Make failures explicit when the route is unavailable or the exported structure is incomplete, rather than silently creating a bad artifact.
- Keep the export flow aligned with the route contract so structural changes to the deck surface quickly in tests or verification.
- Use the export seam to verify PDF properties: landscape page size, expected page count, and failure on section overflow.

**Execution note:** Implement this unit after the route and print contract exist; otherwise the export script will encode unstable layout assumptions.

**Patterns to follow:**
- `packages/website/package.json`
- `packages/website/src/routes/pitch/+page.svelte`

**Test scenarios:**
- Happy path — the export script targets the `/pitch` route and produces a landscape PDF artifact from the website source of truth.
- Happy path — when no base URL override is provided, the script starts and stops a local preview automatically before exporting.
- Happy path — the script waits for both HTTP readiness and the route readiness selector before exporting.
- Edge case — if the route is unreachable, the script exits with a clear failure instead of producing an empty or partial file.
- Edge case — if Chromium/browser dependencies are unavailable, the script exits with an actionable setup error.
- Error path — if the section count or exported page structure is incomplete, the export flow surfaces that mismatch clearly.
- Error path — if any slide overflows the agreed page budget, export verification fails instead of silently shrinking or clipping the page.
- Integration — a generated PDF contains one page per pitch section and respects the print CSS page model.

**Verification:**
- The website package has a repeatable PDF export path, and the exported artifact reflects the same slide structure as the route.

## System-Wide Impact

- **Interaction graph:** `packages/website/src/routes/+layout.svelte` and `packages/website/src/routes/layout.css` provide theme/fonts; the new route composes shared UI from `@acepe/ui`; the export script depends on the route and print CSS staying in sync.
- **Error propagation:** Export failures should surface as explicit script errors; content/claims contract failures should surface in tests rather than degrade silently in the route.
- **State lifecycle risks:** The pitch is largely static and should avoid runtime-only state beyond presentation navigation.
- **API surface parity:** Existing public routes (`/`, `/download`, `/pricing`, `/compare`) remain behaviorally unchanged.
- **Integration coverage:** Route rendering, print CSS, and Playwright export need cross-layer verification because unit tests alone will not prove PDF behavior.
- **Unchanged invariants:** Existing website theme tokens, shared shader behavior, and shared brand components remain the source of truth; the pitch page should consume them, not fork them.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Shader-heavy visuals export poorly to PDF | Use print-specific fallbacks/overrides and test that the exported slide remains readable even if shader rendering is simplified |
| Late changes to traction proof or raise framing cause copy churn | Separate content from layout and enforce qualitative fallback behavior for unverified claims |
| Full-screen sections overflow a 16:9 page and break export readability | Define section sizing/layout constraints early and lock them with print-contract tests plus export verification |
| Adding Playwright broadens the website toolchain | Keep Playwright scoped to export, isolate it in a script, and avoid coupling route rendering to browser-only assumptions |

## Documentation / Operational Notes

- No public navigation or sitemap change is required for v1 unless product strategy changes later.
- If the pitch becomes externally promoted, a later pass should decide whether to add header links, SEO strategy, and analytics treatment for this route.

## Sources & References

- **Origin document:** `docs/brainstorms/2026-04-09-acepe-pitch-requirements.md`
- Related code: `packages/website/src/routes/+page.svelte`
- Related code: `packages/website/src/routes/download/+page.svelte`
- Related code: `packages/website/src/routes/layout.css`
- Related code: `packages/ui/src/components/brand-shader-background/brand-shader-background.svelte`
- Related code: `packages/ui/src/components/brand-lockup/brand-lockup.svelte`
