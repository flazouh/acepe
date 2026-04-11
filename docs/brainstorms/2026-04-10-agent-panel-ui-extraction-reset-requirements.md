---
date: 2026-04-10
topic: agent-panel-ui-extraction-reset
---

# Agent Panel UI Extraction Reset

## Problem Frame

The previous migration succeeded at creating a shared agent-panel scene contract, but it failed the actual product goal. Instead of extracting the desktop agent panel UI into `packages/ui` and reusing that same presentation in both desktop and website, it introduced a new shared UI layer that only approximates the desktop experience.

That leaves Acepe with two problems:

1. the website demo is not a trustworthy representation of the product
2. the desktop is still the real UI owner, so the shared layer adds maintenance cost without delivering reuse

This reset should realign the work around the real objective: **the shared layer must be an extraction of the real desktop UI rather than a redesign of it.** For this reset, desktop is the baseline reference used to recover parity; it is not automatically the permanent owner of product presentation after the reset succeeds.

## Requirements

**Source of truth and reuse**
- R1. The corrected migration must extract presentational UI from the existing desktop agent panel into `packages/ui` rather than designing a new website-friendly panel surface.
- R2. Desktop and website must render the same extracted presentational components for every shared region that is declared in scope.
- R3. Desktop must be the visual reference and presentational-behavior reference for shared regions during this reset; if the shared output diverges from desktop in layout, styling, local interaction affordances, or region-level state presentation, the extraction is considered incorrect.
- R4. When a region is not yet safely extractable, it must stay desktop-owned and be explicitly out of scope for the shared layer rather than being replaced with a simplified lookalike.

**Shared surface**
- R5. The target end state is the whole visible agent panel chrome: header, conversation presentation, status strips/cards, composer presentation, plan/todo/review regions, and panel-local sidebars/drawers that are visually part of the panel.
- R6. Desktop-only runtime behavior must remain in `packages/desktop`, including stores, ACP orchestration, virtualization control, thread-follow behavior, embedded runtime integrations, permissions, and side effects.
- R7. Shared components in `packages/ui` must stay dumb and controlled: they receive explicit props and callbacks, and must not import desktop stores, Tauri APIs, or ACP runtime helpers.
- R8. Website usage must consume the same extracted UI components through mocked or fixture data that matches the desktop-owned presentational API rather than a separate scene abstraction.

**Migration discipline**
- R9. The migration must be desktop-first: extract from the live desktop surface, switch desktop to consume the extracted component, then reuse that same component on the website.
- R10. Planning must define a mandatory first-shipment shared slice and an explicit defer list. Deferred regions are allowed only when they are named up front with justification; they cannot be omitted ad hoc under the banner of safety.
- R11. Shared presentational behavior includes local visual and interaction states within a region, such as expanded/collapsed state, hover/focus/pressed/selected styling, disabled/loading/error presentation, and other region-local affordances. Shared presentational behavior does not include ACP orchestration, provider policy, permissions flow, thread-follow logic, or other store/side-effect ownership reserved to desktop.
- R12. Every shared region must have a parity review method against desktop, including named reference states and side-by-side evidence. A region is not considered extracted until that review passes.
- R13. The migration must preserve fidelity incrementally. A region should only move to shared UI when the extracted version matches desktop closely enough that a reviewer can identify it as the same UI under the agreed parity rubric.
- R14. The parity rubric must cover layout, spacing, typography, color, iconography, borders/elevation, empty/loading/error/streaming states, and region-local interaction states. Acceptable differences are limited to platform-native rendering differences, intentionally deferred regions, and runtime capabilities that are explicitly out of scope.
- R15. The website must demonstrate at least the core product moments that make the agent panel legible and trustworthy: active conversation flow, status/review context, and composer readiness using the same extracted components as desktop.
- R16. Planning must explicitly decompose the current desktop panel into runtime-neutral presentational children and thin desktop adapters before moving extracted UI into `packages/ui`; the reset must not attempt to lift the current desktop monolith wholesale across the package boundary.
- R17. Shared conversation extraction stops at presentational rows, cards, and region-local loading/error states. Desktop retains the list container, virtualization, scroll-follow, reveal behavior, and session-context wiring around those shared components.
- R18. The migration must reduce duplication, not relocate it. The end state should have one presentational implementation per shared region, not separate desktop and website renderers fed by parallel contracts.
- R19. Any intermediate adapter or view-model layer must serve the extraction boundary and remain smaller than the UI it supports; it must not become a second product-facing surface that authors features independently of desktop.

## Success Criteria

- Desktop is visibly built from extracted `packages/ui` components for the regions declared shared.
- The website agent panel demo uses those same components and is recognizably the same UI, not a reinterpretation.
- Planning identifies one mandatory first-shipment slice, one explicit defer list, and one parity review method that makes completion auditable instead of subjective.
- The shared layer no longer needs a separate "scene" UI concept to explain why it differs from desktop.
- Adding or restyling a shared panel region requires changing one presentational implementation, then both desktop and website reflect it.
- Reviewers can compare desktop and website and describe differences only in runtime capability or intentionally out-of-scope regions, not in basic presentation language.

## Scope Boundaries

- Do not move agent runtime ownership, Tauri integration, session stores, or side effects into `packages/ui`.
- Do not preserve the current shared layer just because it already exists; previous investment is not a reason to keep the wrong seam.
- Do not create website-specific fallback UI for regions that are meant to be shared.
- Do not require the website to implement real ACP behavior.
- Do not generalize this into a full-app design system effort outside the agent panel.

## Key Decisions

- **Desktop-first extraction, not website-first modeling**: The migration must start from the real desktop UI and peel presentation outward.
- **Whole visible panel is the target end state, but delivery may be phased**: The failure came from extracting only a subset and reimagining the rest, but a credible reset still needs a named first shipment and an explicit defer list rather than one all-or-nothing milestone.
- **Shared UI must be dumb**: Reuse is only valuable if ownership stays clear and runtime logic remains in desktop.
- **No substitute lookalikes**: If a region cannot yet be shared faithfully, it should temporarily remain desktop-only rather than being replaced with a weaker approximation.
- **Parity is judged by a rubric, not vibes**: The reset only succeeds when reviewers can compare named desktop and website states using agreed evidence and allowed-difference rules.

## Dependencies / Assumptions

- The current desktop agent panel in `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte` and adjacent desktop-owned components is the canonical visual reference.
- The current shared scene components in `packages/ui/src/components/agent-panel-scene/` are not automatically part of the desired end state; planning should evaluate whether they are salvageable, partially reusable, or should be removed.
- Website demo data can stay mocked, but its rendering surface should align to the extracted desktop-derived presentational API.
- Planning will need to classify currently visible runtime-bound regions such as the embedded browser, terminal drawer, attached-file pane, checkpoint timeline, and review-specific panes into either the first-shipment shared slice or the explicit defer list.

## Outstanding Questions

### Deferred to Planning
- [Affects R5][Technical] What is the right extraction unit for sidebars and drawers so the visible shell becomes shared without leaking embedded runtime ownership into `packages/ui`?
- [Affects R10][Needs research] Which desktop regions can be extracted leaf-first with the lowest rewrite risk, and which should be placed in the explicit first-shipment defer list?
- [Affects R17][Technical] What is the approved seam between shared conversation presentation and desktop-owned virtualization, scroll-follow, and reveal behavior?
- [Affects R19][Technical] Is any part of the current `@acepe/agent-panel-contract` package a useful adapter boundary, or does keeping it prolong the wrong abstraction?

## Next Steps

-> /ce:plan for structured implementation planning
