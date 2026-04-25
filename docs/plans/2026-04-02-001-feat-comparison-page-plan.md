---
title: "feat: Add Acepe vs Cursor comparison page"
type: feat
status: active
date: 2026-04-02
---

# feat: Add Acepe vs Cursor comparison page

## Overview

Add a comparison page at `/compare/cursor` that positions Acepe against Cursor for developers searching "Acepe vs Cursor" or "Cursor alternative." This is the first demand-capture surface — an owned conversion page that AlternativeTo and search engines can link to.

## Problem Frame

Acepe has no comparison content on the website. Developers researching tools search "[tool] vs [tool]" and "[tool] alternative." Without a landing page for those queries, Acepe loses organic traffic to competitors who do have comparison pages. The pricing FAQ already contains comparison copy for Superset, 1Code, and T3 — this page surfaces that positioning as a dedicated SEO-optimized landing page starting with Cursor (the highest-traffic competitor).

## Requirements Trace

- R1. A page at `/compare/cursor` renders a Cursor-specific comparison.
- R2. The page follows the existing website design system (Tailwind, dark-first theme, same header/footer).
- R3. SEO: `<title>`, `<meta description>`, Open Graph tags, and JSON-LD `FAQPage` schema.
- R4. Hero section with a clear headline ("Acepe vs Cursor") and one-sentence value prop.
- R5. Side-by-side feature comparison table covering: multi-agent support, agent protocol, attention queue, checkpoints, SQL studio, worktrees, pricing model, license, platform.
- R6. Sections highlighting Acepe's differentiators: multi-agent orchestration, ACP standard, attention queue.
- R7. CTA buttons linking to `/download` and `/pricing`.
- R8. The header navigation includes a "Compare" link visible on desktop and mobile.
- R9. The route structure supports future comparison pages (`/compare/[slug]`) without restructuring.
- R10. Use existing i18n infrastructure (Paraglide) for all user-facing strings.

## Scope Boundaries

- Only the Cursor comparison page ships in this PR. Claude Code, Codex, Windsurf, and T3 comparison pages are follow-up work.
- No server-side data fetching needed — comparison data is static.
- No interactive demos or embedded components — just structured content.
- No footer component changes (the website doesn't have a shared footer component).

## Context & Research

### Relevant Code and Patterns

- `packages/website/src/routes/pricing/+page.svelte` — page structure, hero pattern, card grid, FAQ accordion
- `packages/website/src/lib/components/header.svelte` — navigation links, mobile drawer
- `packages/website/src/lib/components/seo/json-ld.svelte` — structured data pattern
- `packages/website/src/routes/+layout.svelte` — layout shell, SEO components
- `packages/website/src/routes/layout.css` — design tokens, Tailwind imports
- Pricing FAQ already contains competitive copy for Superset, 1Code, and T3

### Institutional Learnings

- All new pages follow the `Header` + `<main class="pt-20">` pattern
- Pages use `$props()` for `data` from server/layout, `$derived` for computed values
- i18n: all strings imported from `$lib/paraglide/messages.js`
- SEO tags go in `<svelte:head>` inside the page component

## Key Technical Decisions

- **`/compare/[slug]` dynamic route**: Use a SvelteKit dynamic route so future competitors reuse the same layout. The `[slug]` param determines which comparison data to render. Start with a single `cursor` slug; 404 for unknown slugs.
- **Static data, no +page.server.ts**: Comparison content is developer-authored, not fetched. Store comparison data as a TypeScript constant in a shared module.
- **JSON-LD FAQPage schema**: Google surfaces FAQ-schema in rich results, increasing CTR for "vs" queries.
- **Tailwind-only styling**: Follow the pricing page pattern. No new CSS classes unless unavoidable.

## Open Questions

### Resolved During Planning

- **Q: Should comparisons be separate routes or query params?** Separate routes (`/compare/cursor`) for better SEO — each page gets its own `<title>`, canonical URL, and indexable content.
- **Q: Should we add a comparison index (`/compare`)?** Not yet — with only one competitor page, the index would be empty. Add when there are 3+ pages.

### Deferred to Implementation

- Exact wording of comparison table rows — refine during implementation based on current feature set.
- Whether to add `rel="nofollow"` to competitor links — decide based on SEO strategy.

## Implementation Units

- [ ] **Unit 1: Comparison data module and types**

**Goal:** Define the comparison data structure and Cursor-specific content.

**Requirements:** R5, R9

**Dependencies:** None

**Files:**
- Create: `packages/website/src/lib/compare/types.ts`
- Create: `packages/website/src/lib/compare/data.ts`
- Create: `packages/website/src/lib/compare/cursor.ts`

**Approach:**
- Define a `ComparisonData` interface: `slug`, `competitorName`, `competitorUrl`, `heroTagline`, `heroDescription`, `features` (array of `{ category, feature, acepe, competitor }`), `differentiators` (array of `{ title, description }`), `faqs` (array of `{ question, answer }`), `metaTitle`, `metaDescription`.
- `cursor.ts` exports the Cursor-specific data. `data.ts` exports a `getComparison(slug)` lookup function.
- Feature rows cover: multi-agent support, agent protocol, attention queue, checkpoints, SQL studio, worktrees, pricing model, license, platform support.

**Patterns to follow:**
- Pricing FAQ data shape in `pricing/+page.svelte`

**Test scenarios:**
- Happy path: `getComparison("cursor")` returns the Cursor data object with all required fields
- Edge case: `getComparison("unknown")` returns `null`

**Verification:** Data module imports cleanly and TypeScript compiles without errors.

- [ ] **Unit 2: Dynamic route and page component**

**Goal:** Create the `/compare/[slug]` route that renders the comparison page.

**Requirements:** R1, R2, R3, R4, R5, R6, R7, R9, R10

**Dependencies:** Unit 1

**Files:**
- Create: `packages/website/src/routes/compare/[slug]/+page.ts`
- Create: `packages/website/src/routes/compare/[slug]/+page.svelte`

**Approach:**
- `+page.ts` loads data from the layout (feature flags) and resolves the comparison slug. If `getComparison(params.slug)` returns null, throw `error(404)`.
- `+page.svelte` renders:
  1. `<svelte:head>` with title, meta description, OG tags, and JSON-LD FAQPage schema
  2. `<Header>` with feature-flag props from layout data
  3. Hero section: headline, subtitle, CTA buttons
  4. Comparison table: two-column grid with feature rows, check/cross icons
  5. Differentiator sections: 2-3 blocks with title + description
  6. FAQ accordion: reuse the pricing page's FAQ pattern
  7. Final CTA section
- Use Paraglide for all strings. Create message keys in the i18n source file.

**Patterns to follow:**
- `packages/website/src/routes/pricing/+page.svelte` — hero, card grid, FAQ structure
- `packages/website/src/routes/+layout.svelte` — SEO component usage

**Test scenarios:**
- Happy path: `/compare/cursor` renders with correct title, comparison table, and CTAs
- Edge case: `/compare/nonexistent` returns 404
- SEO: page source includes `<title>`, `<meta name="description">`, and JSON-LD FAQPage

**Verification:** Page renders at `/compare/cursor` with all sections. `bun run check` passes.

- [ ] **Unit 3: i18n message keys**

**Goal:** Add Paraglide message keys for all user-facing strings on the comparison page.

**Requirements:** R10

**Dependencies:** Unit 2

**Files:**
- Modify: `packages/website/messages/en.json`

**Approach:**
- Add keys under a `compare_` prefix: `compare_hero_title`, `compare_hero_subtitle`, `compare_cta_download`, `compare_cta_pricing`, `compare_table_heading_feature`, `compare_table_heading_acepe`, `compare_section_faq_title`, `nav_compare`.
- Competitor-specific strings (Cursor facts) stay in the data module, not i18n — they don't need translation.

**Patterns to follow:**
- Existing message keys in `packages/website/messages/en.json`

**Test scenarios:**
- Happy path: All `m.compare_*()` calls resolve without Paraglide errors
- Edge case: Missing key detected by TypeScript (`m.compare_nonexistent()` would be a compile error)

**Verification:** `bun run check` passes. No missing message key errors.

- [ ] **Unit 4: Header navigation link**

**Goal:** Add a "Compare" link to the site header on desktop and mobile.

**Requirements:** R8

**Dependencies:** Unit 3 (for `m.nav_compare()`)

**Files:**
- Modify: `packages/website/src/lib/components/header.svelte`

**Approach:**
- Add a desktop nav link to `/compare/cursor` with class matching existing links (`desktopNavLinkClass` pattern).
- Add the same link to the mobile drawer menu.
- Link text: `m.nav_compare()`.
- Position: after "Pricing" in the nav order.

**Patterns to follow:**
- Existing nav links in `header.svelte`

**Test scenarios:**
- Happy path: "Compare" link appears in desktop nav and mobile drawer, navigates to `/compare/cursor`

**Verification:** Visual inspection — link appears in header. `bun run check` passes.

## System-Wide Impact

- **Navigation**: Header component gains one link. No other components affected.
- **SEO**: New page adds to sitemap (if auto-generated). JSON-LD FAQPage schema is new for the site.
- **i18n**: New message keys added; no existing keys changed.
- **Unchanged invariants**: Pricing page, blog, download page — none modified.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Comparison claims become stale as competitors ship features | Date the page content; plan quarterly review |
| SEO impact takes weeks to materialize | This is expected — ship now, measure later |

## Sources & References

- **Origin:** Distribution strategy discussion (session context — no formal requirements doc)
- Related: Pricing page FAQ competitive copy
- External: [Google Structured Data - FAQPage](https://developers.google.com/search/docs/appearance/structured-data/faqpage)
