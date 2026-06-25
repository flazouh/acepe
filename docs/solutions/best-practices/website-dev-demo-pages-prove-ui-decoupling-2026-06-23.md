---
title: Website dev/demo pages prove @acepe/ui View decoupling
date: 2026-06-23
last_updated: 2026-06-23
category: docs/solutions/best-practices
module: shared UI (@acepe/ui) + website demos
problem_type: best_practice
component: packages/ui, packages/website
severity: medium
applies_when:
  - Adding or reviewing a shared component in @acepe/ui
  - Verifying a component is a true MVC "View" (no Tauri / stores / app policy)
  - Building a marketing/landing/blog demo that renders real product UI
  - Wondering why the website imports product components with hardcoded data
tags: [mvc, ui-package, website, view-decoupling, mock-data, render-smoke, design-system]
---

# Website dev/demo pages prove @acepe/ui View decoupling

## Context

Acepe's reusable UI lives in one package, `@acepe/ui` (`packages/ui`). Per the
UI Package MVC rule, those components are **presentational ("dumb")**: props,
callbacks, and snippets only — no Tauri, no stores, no app-specific policy.

A **dev/demo page in the website** is the mechanism that *proves* a component
actually honors that rule. The website (`packages/website`) imports the same
components from `@acepe/ui` and renders them with **hand-written mock data**.

## Why it works as a proof

The website has **zero Tauri and zero desktop runtime**. If a shared component
renders correctly there using only mock props, it cannot be secretly depending
on the desktop app — that machinery does not exist in the website build. So the
website render is a *living boundary test* for the MVC **View** layer, not just a
marketing artifact.

Two surfaces, same components:

| Surface | File | Role |
|---|---|---|
| In-app showcase (desktop) | `packages/desktop/src/lib/components/dev/design-system-page.svelte` (mounted via `main-app-view.svelte`) | Visual QA inside the real app |
| External proof (website) | `packages/website/src/lib/components/*-demo.svelte` (e.g. `agent-panel-demo.svelte`) | Tauri-free proof + landing/blog/feature demos |

## How to build one (pattern)

1. Import the real components from `@acepe/ui` and its subpath exports
   (`@acepe/ui/agent-panel`, `@acepe/ui/panel-header`, etc.). Do **not** copy or
   re-implement them.
2. Construct mock data as plain typed objects matching the component's **prop
   model types** (e.g. `AgentPanelSceneModel`, `AgentPanelPrCardModel`). Import
   the types from `@acepe/ui/*` so the mock stays honest against the real API.
3. Wire every callback to a `noop`. Demos are non-interactive proofs, not live
   controllers.
4. Lazy-load the demo where it's mounted, e.g. in `feature-showcase.svelte`:
   `{#await import("./agent-panel-demo.svelte")} ... {@const Demo = module.default}<Demo />`
   so demos don't bloat the initial bundle.

## Guardrails

- The View boundary is enforced by `scripts/forbid-ui-package-imports.ts` and
  `packages/ui/src/__tests__/ui-package-boundary.test.ts` (import guard + render
  smoke). The website demo is the human-visible counterpart of that render smoke.
- If a demo needs Tauri/store data to render, that's a smell: the component is
  not a real View. Push the app logic up into a desktop Controller/Model and keep
  the `@acepe/ui` component prop-driven (see UI Package MVC in `CLAUDE.md`).
- Pass user-visible copy via props (English literals are fine in the demo); never
  reach for desktop i18n/stores from inside shared UI.

## Related

- `CLAUDE.md` → Architecture → UI Package MVC
- `.github/skills/extract-to-ui-package/references/pattern-catalog.md`
- `extract-to-ui-package` skill (invoke before moving UI into `@acepe/ui`)
