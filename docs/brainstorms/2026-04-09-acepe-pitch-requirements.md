---
date: 2026-04-09
topic: acepe-pitch
---

# Acepe Investor Pitch Website

## Problem Frame

Acepe needs an investor-facing pitch that does more than describe the product. It should frame Acepe as an important new layer in AI-native software development, communicate the problem with unreliable and hard-to-govern multi-agent production workflows, and present the product in a format that works both as a polished website and as exportable PDF slides. The pitch should reuse Acepe's existing visual language so it feels native to the product rather than like a separate marketing artifact.

## Requirements

**Must-Have for V1**
- R1. The first version must be designed for a seed / pre-seed investor audience.
- R2. The title slide must frame Acepe as a category-level product, using the current preferred line: "Acepe is the developer workspace for managing AI agents at production quality."
- R3. The primary problem framing must emphasize unreliable and hard-to-govern multi-agent production workflows, with context-switching presented as one visible symptom rather than the whole problem.
- R4. The deck should feel like a tight investor presentation first, and a browsable website second.
- R5. The product framing must present Acepe as the platform-neutral operating layer for agentic development rather than a tool tied to a single harness.
- R6. The product story may include Acepe's future first-party agent, but it must be framed as a first-class citizen inside the platform rather than the whole company thesis.
- R7. The pitch must have a website-first source of truth with export to PDF slides.
- R8. The website experience should be structured as a slide-like narrative rather than a generic marketing site.
- R9. The v1 PDF export contract is Playwright-generated PDF output from the website, using print CSS from the same source of truth, even if perfect visual parity is deferred.
- R10. The first version should target a tight seed-style narrative structure of roughly 8-10 slide sections, centered on title, problem, solution, product, market, traction, business model, team, and ask.
- R11. The first version must define a canonical presentation arc so both the website and PDF tell the same investor story in the same order.
- R12. The pitch must reuse Acepe's existing splash / brand visual language from the product rather than inventing a disconnected style.
- R13. Brand reuse must be concrete enough to guide implementation, including background treatment, typography feel, card / chrome patterns, logo treatment, and motion restraint.
- R14. The first version should live as a dedicated page inside the existing website package rather than as a separate standalone app.
- R15. The pitch must support presentation-style navigation with clear next / previous progression, progress awareness, and deep-linkable sections.
- R16. The first version behaves as a one-page presentation with one section per slide and anchor-based navigation between sections.
- R17. The investor story should work in both live-presented mode and self-guided reading mode.
- R18. The v1 support boundary is desktop-first presentation quality, with mobile and tablet allowed to degrade gracefully rather than matching the full slide experience.
- R19. The implemented page should reuse real Acepe brand primitives where possible, including `BrandShaderBackground`, shared logo / lockup treatment, and existing card / panel styling patterns from the website or shared UI package.
- R20. The first version may use placeholder business metrics where exact values are not yet available, but it must present current product proof honestly.
- R21. Any approximate traction claims must be explicitly labeled as estimates until verified metrics are available.
- R22. Early traction should be framed as credible seed-stage signal, including current known proof points such as hundreds of users and 40 GitHub stars, until more exact metrics are available.
- R23. The narrative must explicitly cover why now, why Acepe wins, what the raise unlocks for the business, and how Acepe makes money.
- R24. The business model framing should present generous local / solo adoption, a team-first monetization wedge around managing agent work, enterprise as the upscale extension of that wedge, and a first-party agent as potential future upside rather than the core lock-in thesis.
- R25. The title, traction, and product-quality claims must follow a claims policy: exact numeric claims should be verified and dated; if that proof is unavailable, the pitch must fall back to qualitative wording rather than unverified numbers.
- R26. The canonical v1 story arc is: Title, Problem, Why current workflows fail, Solution, Product, Market / Why now, Traction, Business model, Team, Ask.

**Should-Have for V1**
- R27. The opening section should use Acepe's existing splashscreen treatment as the basis for the hero / title-slide moment.

## Success Criteria
- The pitch includes all ten required v1 sections in the agreed order.
- The website presentation visibly reuses named Acepe brand references, including splash-derived opening treatment and product-native visual language.
- The implementation lives inside the existing website package and reuses shared UI / brand primitives instead of duplicating them.
- The PDF export yields one readable slide page per anchored narrative section and can be shared without maintaining a second deck source.
- The PDF export is produced through the agreed Playwright + print CSS path.
- The experience is investor-ready on desktop, with graceful degradation outside that boundary.
- Numeric traction claims are either verified and dated or replaced with non-numeric qualitative proof.
- The story explains why now, why Acepe wins, what the raise unlocks, and how the business monetizes.
- The product framing makes Acepe feel like the platform-neutral operating layer for agentic development rather than a single-agent product.

## Scope Boundaries
- The first version does not need final fundraising numbers, detailed financial projections, or exact market sizing.
- The first version does not need a PowerPoint-first workflow.
- The first version does not need a separate visual identity distinct from Acepe's current product brand.
- The first version does not require pixel-perfect parity between the website and PDF if the investor story and slide readability hold up.

## Key Decisions
- Website-first source of truth: The user wants the pitch to exist primarily as a website, with PDF slides generated from that experience.
- Investor audience: The first version is for seed / pre-seed investors, not customers or recruiting.
- Existing ecosystem reuse: Acepe already uses SvelteKit / Svelte / Tailwind and already has branded splash treatments in the product, so the pitch should reuse that ecosystem and visual language.
- Website placement: the pitch should be implemented as a page within `packages/website`, not as a separate microsite or app.
- Pitch skill usage: The `pitch-deck` skill is available and should help with pitch structure and messaging, but the rendering approach should remain web-native rather than PPTX-first.
- Canonical story arc: The default narrative should move through title, problem, why current workflows fail, product / system view, traction, market / why now, business model, team, and ask.
- Platform thesis: Acepe should be framed as the operator layer / operating system for agentic development rather than a product tied to one harness.
- First-party agent role: a future Acepe-native agent can strengthen the platform, but the company story should remain platform-first rather than agent-locked.
- Monetization thesis: the first serious paid wedge is team-managed agent work, with enterprise as the upscale extension and a first-party agent as optional future upside.
- UX precedence: When website UX and presentation pacing conflict, investor-slide readability and narrative clarity should win.
- V1 shipping bar: Must-have requirements define the planning baseline; should-have items can slip if needed without invalidating the first investor-ready release.
- Claims policy: investor-facing numeric claims need verified, dated proof; otherwise the copy should stay qualitative.
- Presentation model: v1 uses a single-page deck with one anchored section per slide, rather than route-per-slide navigation.
- Export contract: v1 PDF export is generated via Playwright from the presentation site and styled through print CSS from the same codebase.
- Viewport boundary: v1 optimizes for desktop presentation and sharing, not full mobile slide parity.

## Dependencies / Assumptions
- Existing splash and logo treatments are available in the Acepe codebase, including the visual patterns used in `packages/desktop/src/lib/acp/components/welcome-screen/welcome-screen.svelte` and `packages/desktop/src/lib/components/update-available/update-available-page.svelte`.
- The existing website package in `packages/website` is the likely home for the pitch unless planning finds a better repo-local structure.
- Shared UI already exposes reusable branding primitives such as `BrandShaderBackground` and `BrandLockup`, and the website already uses Acepe-style cards and hero typography patterns.

## Outstanding Questions

### Deferred to Planning
- [Affects R25][Needs research] What exact current user metric should replace the placeholder "hundreds of users" line?
- [Affects R25][Needs research] What exact date and context should be attached to the 40 GitHub stars proof point?
- [Affects R22][Needs research] What additional seed-stage proof points are available beyond users and GitHub stars?
- [Affects R24][Needs research] Which team-level monetization wedge is strongest today: shared coordination, remote execution, approvals/review, governance, or another operating-layer benefit?

## Next Steps
-> Create a structured implementation plan in docs/plans/