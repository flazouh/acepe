---
title: refactor: unify branded shader backgrounds
type: refactor
status: completed
date: 2026-04-09
deepened: 2026-04-09
---

# refactor: unify branded shader backgrounds

## Overview

Extract the branded orange shader background into a shared presentational UI primitive and migrate the desktop splash/update surfaces to consume it so Acepe uses one palette and one shader setup everywhere this branded background appears.

## Problem Frame

Acepe currently has several splash-like surfaces that each initialize their own shader background and carry their own color definitions. The onboarding splash was reverted to the older orange palette, but updater screens still use the newer teal/orange mix, and other branded backgrounds carry slightly different orange variants. That makes the product feel inconsistent and keeps shader configuration duplicated across multiple files.

## Requirements Trace

- R1. Use one shared branded shader background abstraction instead of duplicating `ShaderMount` setup across desktop splash/update surfaces.
- R2. Standardize the branded dark-mode palette so the same orange colors are used everywhere this splash-style background appears.
- R3. Preserve existing layout, copy, interaction flow, and layering behavior; this refactor should only change background ownership and palette consistency.
- R4. Add regression coverage that makes it hard to reintroduce per-surface shader duplication or palette drift.

## Scope Boundaries

- This plan does not redesign any card layouts, typography, or updater copy.
- This plan does not change light-theme-specific changelog treatment unless needed to keep the shared abstraction usable there.
- This plan does not alter non-branded gradients that are intentionally separate from the splash/update visual system.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src/lib/acp/components/welcome-screen/welcome-screen.svelte` initializes a full-screen shader backdrop and now uses the desired orange palette.
- `packages/desktop/src/lib/components/update-available/update-available-page.svelte` duplicates the same shader setup but still uses the teal/orange palette.
- `packages/desktop/src/lib/components/update-modal/update-modal.svelte` duplicates the same full-screen shader setup and also still uses the teal/orange palette.
- `packages/desktop/src/lib/acp/components/agent-panel/components/connection-error-ui.svelte` duplicates the orange splash shader setup.
- `packages/desktop/src/lib/components/animated-background.svelte` is a shared desktop-local background component, but it uses a different palette and a different shader API shape than the splash/update surfaces.
- `packages/desktop/src/lib/components/changelog-modal/changelog-modal.svelte` already centralizes its palette data in a local theme object and uses the same orange dark-mode palette values as the onboarding splash.
- `packages/ui/src/index.ts` is the shared export surface for presentational UI components.

### Institutional Learnings

- No relevant `docs/solutions/` entries were found for branded shader background reuse.

### External References

- None. The repo already has strong local patterns for shader-backed surfaces and shared presentational UI exports.

## Key Technical Decisions

- **Extract the shared background into `packages/ui`**: the new abstraction is purely presentational and should live in the shared UI package rather than remaining desktop-only.
- **Share palette constants alongside the component**: the palette itself should be centralized, not just the mounting logic, so every consumer uses the same color source of truth.
- **Migrate full-screen branded surfaces first**: welcome, update-available, update-modal, connection-error, and the existing animated auth background are the main consistency gap and should all consume the same shared dark palette.
- **Keep changelog modal on its local theme model, but source dark-mode shader colors from the shared palette**: changelog already has light/dark theme concerns, so it should not be flattened into a one-size-fits-all wrapper, but it should stop redefining the dark branded colors.
- **Use contract/structure coverage to lock in reuse**: these surfaces are easy to drift through visual tweaks, so tests should assert shared imports or shared palette usage rather than pixel details.

## Open Questions

### Resolved During Planning

- **What does “everywhere” cover?** For this refactor, it means Acepe’s branded shader-backed splash/update surfaces in desktop: onboarding splash, update-available page, blocking update modal, connection error UI, auth background, and changelog dark-mode shader colors.
- **Should the extraction stay desktop-local?** No. The new background is purely presentational, so it should live in `packages/ui`.

### Deferred to Implementation

- **Exact prop shape for the shared background component**: implementation can decide whether palette selection is prop-driven, constant-only, or split between component props and exported helpers.
- **Whether `animated-background.svelte` should be replaced entirely or become a thin compatibility wrapper**: this depends on which option keeps downstream usage simplest once the shared component exists while preserving auth layout behavior.

## Implementation Units

- [x] **Unit 1: Define shared branded shader primitives in `packages/ui`**

**Goal:** Create a reusable presentational shader background component and centralized branded palette constants that can be imported by desktop surfaces.

**Requirements:** R1, R2

**Dependencies:** None

**Files:**
- Create: `packages/ui/src/components/brand-shader-background/brand-shader-background.svelte`
- Create: `packages/ui/src/components/brand-shader-background/index.ts`
- Create: `packages/ui/src/lib/brand-shader-palette.ts`
- Modify: `packages/ui/package.json`
- Modify: `packages/ui/src/index.ts`
- Modify: `bun.lock`
- Test: `packages/desktop/src/brand-shader-background.contract.test.ts`

**Approach:**
- Move the common `ShaderMount` lifecycle into one presentational component.
- Export the branded dark palette as named constants used by the component and by any theme-aware consumer that cannot adopt the component directly.
- Preserve the richer uniform-based shader contract already used by splash/update surfaces, including noise texture loading, cover-fit sizing, and container-based world dimensions.
- Define fallback behavior as part of the component contract so consumers can preserve their current first-paint appearance (solid dark shell for splash/update overlays, compatibility path for auth's gradient-style pre-mount look if needed).
- Keep the component focused on rendering and shader setup only; no desktop-specific state or Tauri concerns.

**Patterns to follow:**
- `packages/ui/src/index.ts` export organization
- `packages/desktop/src/lib/components/animated-background.svelte` for the existing background-only component role

**Test scenarios:**
- Happy path — rendering the shared background with default branded settings mounts the shader host and fallback background shell.
- Happy path — shared palette exports expose the expected branded dark background and four orange colors.
- Edge case — variant fallback configuration preserves the intended first-paint shell before the shader mounts.
- Edge case — unmounting the component disposes shader state cleanly so consumers can mount/unmount overlay screens without leaks.

**Verification:**
- Desktop surfaces can import one shared UI component or shared palette constants without duplicating shader initialization code.

- [x] **Unit 2: Migrate full-screen desktop splash/update surfaces to the shared background**

**Goal:** Replace duplicated shader setup in the primary splash/update/error surfaces with the shared background abstraction and one dark branded palette.

**Requirements:** R1, R2, R3

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/welcome-screen/welcome-screen.svelte`
- Modify: `packages/desktop/src/lib/components/update-available/update-available-page.svelte`
- Modify: `packages/desktop/src/lib/components/update-modal/update-modal.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/connection-error-ui.svelte`
- Modify: `packages/desktop/src/routes/auth/+layout.svelte`
- Modify: `packages/desktop/src/lib/components/animated-background.svelte`
- Test: `packages/desktop/src/brand-shader-background.contract.test.ts`
- Test: `packages/desktop/src/logo-branding.contract.test.ts`
- Test: `packages/desktop/src/lib/components/update-available/update-available-page.structure.test.ts`

**Approach:**
- Remove per-file `ShaderMount` ownership where the surface only needs the standard branded background.
- Keep each screen’s existing card/content structure and layer tokens unchanged.
- Route the auth background through the same shared palette without changing auth’s responsive composition: the branded background remains confined to the existing right-hand pane and does not alter the left content pane or small-screen layout.

**Execution note:** Implement this unit test-first with lightweight contract updates that fail until the duplicated shader setup is removed.

**Patterns to follow:**
- Existing full-screen absolute background + relative content layering in the splash/update screens
- Shared UI consumption patterns already used from `@acepe/ui`

**Test scenarios:**
- Happy path — onboarding splash renders with the shared branded background import and no inline shader setup.
- Happy path — update-available page renders with the shared branded background while preserving compact card structure assertions.
- Happy path — blocking update modal uses the same shared branded background and keeps `z-[var(--app-blocking-z)]`.
- Happy path — connection error UI uses the shared branded background without changing its centered alert card structure.
- Integration — auth layout continues rendering the branded background only inside the existing right-hand pane on large screens.
- Edge case — auth layout continues hiding the branded pane on smaller breakpoints with no bleed into the left content pane.

**Verification:**
- These surfaces no longer define local shader color arrays or mount logic and still preserve their existing layout contracts and auth responsive behavior.

- [x] **Unit 3: Align theme-aware branded surfaces with the shared palette source**

**Goal:** Remove remaining branded color drift in surfaces that cannot directly adopt the shared full-screen component because they have theme-specific or scoped shader usage.

**Requirements:** R2, R3

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src/lib/components/changelog-modal/changelog-modal.svelte`
- Test: `packages/desktop/src/brand-shader-background.contract.test.ts`
- Test: `packages/desktop/src/lib/components/changelog-modal/changelog-modal.svelte.vitest.ts`
- Test: `packages/desktop/src/lib/layering.contract.test.ts`

**Approach:**
- Keep changelog’s theme-specific palette model, but import the shared branded dark palette for its dark-mode shader colors instead of redefining them inline.
- Leave the light-theme variant local if it remains intentionally different.
- Avoid changing any modal layering, escape handling, or content grouping behavior.

**Patterns to follow:**
- Existing changelog theme palette object and theme-derived styles

**Test scenarios:**
- Happy path — dark theme changelog shader colors come from the shared branded palette source.
- Edge case — light theme changelog palette remains distinct and still initializes correctly.
- Integration — changelog modal keeps its existing elevated layer token and hero shader container structure.

**Verification:**
- No branded dark-mode surface owns an independent orange shader palette definition.

- [x] **Unit 4: Add regression coverage for shared branding ownership**

**Goal:** Lock in the extraction so future visual tweaks do not reintroduce duplicated shader setup or mismatched palette definitions.

**Requirements:** R4

**Dependencies:** Units 2, 3

**Files:**
- Modify: `packages/desktop/src/brand-shader-background.contract.test.ts`
- Modify: `packages/desktop/src/logo-branding.contract.test.ts`
- Modify: `packages/desktop/src/lib/components/update-available/update-available-page.structure.test.ts`
- Modify: `packages/desktop/src/lib/layering.contract.test.ts`

**Approach:**
- Assert shared background imports or shared palette references on welcome, update-available, update-modal, connection-error, auth background, and changelog dark-mode palette usage rather than asserting exact rendered class strings beyond existing layout contracts.
- Keep tests focused on ownership and source-of-truth invariants, not shader implementation details that would make harmless refactors brittle.

**Patterns to follow:**
- Existing contract tests that inspect source files for stable architecture and branding invariants

**Test scenarios:**
- Happy path — dedicated desktop branding/background contract verifies welcome, update-available, update-modal, connection-error, auth background, and changelog dark-mode palette usage all point at the shared source of truth.
- Edge case — tests fail if inline `u_colors` arrays reappear in migrated surfaces.
- Integration — existing layout/layering structure assertions still pass alongside the new ownership assertions.

**Verification:**
- The intended architectural invariant is enforceable by tests: one branded palette source and one shared background owner for standard splash/update surfaces.

## System-Wide Impact

- **Interaction graph:** This change affects onboarding entry, updater overlays, auth layout, connection failure recovery UI, and changelog presentation through a shared presentational dependency.
- **Error propagation:** Shader initialization failures should continue surfacing through the same local console paths; the refactor should not introduce silent fallbacks beyond existing behavior.
- **State lifecycle risks:** Shared mount/dispose ownership must remain safe for overlays that appear and disappear repeatedly.
- **API surface parity:** Any future branded splash/update surface should consume the shared UI primitive rather than introducing a new local shader setup.
- **Integration coverage:** Source-level contract tests are the cheapest way to prove ownership parity across multiple entry surfaces.
- **Unchanged invariants:** Layer tokens, overlay roles, card sizing, translations, and updater/install behavior remain unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Shared component extraction accidentally changes overlay layering or card composition | Keep background replacement isolated from content wrappers and preserve existing structure tests |
| Theme-aware changelog integration becomes over-coupled to the shared full-screen component | Share palette constants there without forcing the full-screen wrapper |
| The shared component lands in the wrong package layer | Place it in `packages/ui` and export it through the shared package entrypoint |

## Documentation / Operational Notes

- No user-facing documentation changes are required.
- If this refactor exposes other branded background variants that should stay intentionally different, document that decision in follow-up code comments or a solution note only if divergence remains non-obvious.

## Sources & References

- Related code: `packages/desktop/src/lib/acp/components/welcome-screen/welcome-screen.svelte`
- Related code: `packages/desktop/src/lib/components/update-available/update-available-page.svelte`
- Related code: `packages/desktop/src/lib/components/update-modal/update-modal.svelte`
- Related code: `packages/desktop/src/lib/acp/components/agent-panel/components/connection-error-ui.svelte`
- Related code: `packages/desktop/src/lib/components/animated-background.svelte`
- Related code: `packages/desktop/src/lib/components/changelog-modal/changelog-modal.svelte`
- Related code: `packages/ui/src/index.ts`
