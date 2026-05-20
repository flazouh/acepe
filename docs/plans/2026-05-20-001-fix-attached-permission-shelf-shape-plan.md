---
title: fix: Correct attached permission shelf shape
type: fix
status: active
date: 2026-05-20
---

# fix: Correct attached permission shelf shape

## Situation Checklist

- [ ] The current committed fix is wrong: `.tool-call-permission-main-edge` draws a fake curved border at the far right of the tool card.
- [ ] The permission shelf should stay bottom-left and only as wide as the buttons need.
- [ ] The shelf should not add a toolbar, left icon, or `Permission required` label in attached mode.
- [ ] There should be no top border or visible seam above the shelf.
- [ ] The main tool card should not draw a bottom border in attached mode, because that reads as a top bar above the shelf.
- [ ] The attached shelf should have local top-right rounding.
- [ ] QA must use DOM/computed-style checks first, then screenshot only as a final sanity check.
- [ ] The QA fixture or live state must be deterministic; do not inspect a random current app state and call it proof.

## Overview

Replace the fake far-right edge with a simpler attached-shelf shape. The permission shelf should own only the compact button cap attached to the bottom-left. In attached mode, the tool card must not draw a bottom border behind or to the right of the shelf, because that reads as a top bar above the attached controls.

## Problem Frame

We tried to make two DOM boxes look like one shape: the tool call card and the attached permission shelf. The latest fix added a flex filler after the shelf to redraw the missing right-side border. That made DOM checks pass for a missing edge, but the user correctly saw a new bad shape: a weird curve at the far-right side of the tool call.

The better model is not "draw a second right edge." The better model is:

- the tool card stops before the attached shelf and does not draw a bottom top-bar line;
- the shelf owns the compact attached surface and its local top-right rounding;
- no sibling after the shelf draws decorative border art.

## Requirements Trace

- R1. Remove the far-right fake curve caused by `.tool-call-permission-main-edge`.
- R2. Preserve the compact attached shelf: buttons only, bottom-left, width fits content.
- R3. Keep the shelf visually attached with no top seam or top bar above it.
- R4. Give the attached shelf the local top-right rounding that makes the cap feel intentional.
- R5. Keep permission context behavior unchanged; this plan is visual only.
- R6. QA must prove the shape with DOM/computed-style checks before screenshot review.

## Scope Boundaries

- Do not change permission/tool-call matching, status logic, canonical transcript data, or provider parsing.
- Do not add a new toolbar, icon, file label, or summary text to attached permission mode.
- Do not hide useful context from standalone permission bars.
- Do not use a full-width attached permission row as the visible surface.
- Do not rely on a color mask separate from the real shelf background.

## Context & Research

### Relevant Code and Patterns

- `packages/ui/src/components/agent-panel/agent-tool-card.svelte` owns the normal tool card frame: `rounded-sm border border-border overflow-hidden`.
- `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte` currently wraps attached permission rows and removes the tool card's bottom border/radii.
- `packages/ui/src/components/agent-panel/permission-bar.svelte` owns the attached shelf surface through `.permission-attached-card`.
- `packages/desktop/src/lib/acp/components/tool-calls/permission-bar.svelte` maps desktop permission data into the shared UI permission bar.

### Institutional Learnings

- `docs/solutions/workflow-issues/dom-first-qa-for-css-shape-bugs-2026-05-20.md`: for CSS shape bugs, inspect element ownership, computed borders, radii, backgrounds, and rects before claiming success.
- `docs/solutions/workflow-issues/visual-qa-screenshot-evidence-must-be-described-2026-05-20.md`: screenshot QA must describe what is visible and must not remove permission context.
- `docs/solutions/workflow-issues/visual-qa-target-dev-tauri-app-2026-05-20.md`: QA must target the running dev app, not the installed production app.

### External References

- None. This is a local Svelte/CSS shape correction using existing component patterns.

## Key Technical Decisions

- In attached mode, remove the tool card's bottom border and bottom radii: this prevents the horizontal top bar from returning.
- Remove `.tool-call-permission-main-edge`: the far-right filler is the direct cause of the wrong curve.
- Give the attached shelf its own top-right radius while keeping its top border at `0`.
- Keep attached mode in `AgentPanelPermissionBar` compact: the shared permission bar already supports buttons-only attached mode.

## Open Questions

### Resolved During Planning

- Should the far-right filler edge remain? No. It produces the visible wrong curve and splits border ownership across unrelated elements.
- Should this be fixed in canonical/session data? No. This is a visual composition bug only.

### Deferred to Implementation

- Exact corner feel: if the shelf still visually looks wrong after the top bar is gone and top-right radius is present, stop and re-evaluate the intended shape before adding new decorative border helpers.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
Desired ownership:

┌──────────────────────────────────────────────────────────┐
│ tool card content                                        │
└───────────────┬──────────────────────────────────────────┘
                │
┌───────────────┘
│ Deny Always Allow
└───────────────┘

DOM meaning:
- tool card does not draw a bottom border in attached mode
- shelf owns only the compact bottom-left cap
- shelf owns the local top-right rounding while keeping top border at `0`
- no filler element draws a border to the right of the shelf
```

## Implementation Units

- [ ] **Unit 1: Remove split-border ownership**

**Goal:** Remove the current fake far-right edge and stop drawing a main-card top bar above the attached shelf.

**Requirements:** R1, R3

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/scene-content-viewport.svelte.vitest.ts`

**Approach:**
- Delete the `.tool-call-permission-main-edge` DOM element and CSS.
- Clear the tool card's bottom border and bottom radii in attached mode so no horizontal top bar remains.

**Execution note:** Test-first: add a failing regression test that attached permission rendering does not create a filler edge.

**Patterns to follow:**
- Existing viewport wrapper logic in `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte`.
- Existing component test style in `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/scene-content-viewport.svelte.vitest.ts`.

**Test scenarios:**
- Happy path: attached permission renders a tool wrapper plus a permission shelf, with no `tool-call-permission-main-edge` element.
- Regression: attached permission styles do not leave a `.tool-call-permission-main-edge` element in the DOM.

**Verification:**
- DOM structure has no far-right filler element.
- The tool card no longer creates a visible top bar above the shelf.

- [ ] **Unit 2: Make the shelf attach locally**

**Goal:** Make the compact shelf blend into the tool card only where it touches the bottom-left area.

**Requirements:** R2, R3, R4

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte`
- Modify: `packages/ui/src/components/agent-panel/permission-bar.svelte`
- Test: `packages/ui/src/components/agent-panel/__tests__/permission-bar.svelte.vitest.ts`
- Test: `packages/ui/src/components/agent-panel/__tests__/fixtures/permission-bar-summary-fixture.svelte`

**Approach:**
- Keep the attached shelf content-width using `inline-flex`/`fit-content`.
- Keep the shelf top border at `0`.
- Keep the shelf directly below the tool card; do not use negative overlap once the card bottom border is gone.
- Preserve matching background tokens between the tool card and shelf.
- Avoid adding masks, full-width bars, or decorative right-side border fillers.
- Do not add a corner-helper element or pseudo-element in this pass. If the plain shelf overlap fails QA, stop and revise the plan instead of inventing another decorative edge.

**Execution note:** DOM-first QA matters more than pixel guessing here.

**Patterns to follow:**
- Existing attached mode in `packages/ui/src/components/agent-panel/permission-bar.svelte`.
- Existing permission action layout in `packages/ui/src/components/agent-panel/permission-bar-actions.svelte`.

**Test scenarios:**
- Happy path: attached permission mode renders buttons only and does not render `Permission required`.
- Happy path: attached shelf remains content-width and keeps compact button padding.
- Regression: attached shelf has no top border.
- Regression: attached shelf has a nonzero top-right radius.
- Regression: standalone permission bars still render their normal summary/context behavior.
- Regression: tests assert behavior and computed shape, not a magic overlap class.

**Verification:**
- The shelf appears as a compact bottom-left cap.
- The top seam above the shelf is gone without a separate color mask.

- [ ] **Unit 3: Perform deterministic DOM-first QA**

**Goal:** Prove the shape from deterministic DOM state before relying on screenshots.

**Requirements:** R6

**Dependencies:** Units 1 and 2

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/scene-content-viewport.svelte.vitest.ts`
- Update only if implementation reveals a sharper rule: `docs/solutions/workflow-issues/dom-first-qa-for-css-shape-bugs-2026-05-20.md`

**Approach:**
- Prefer a real visible attached permission shelf in the running dev app. If none is available, use a temporary Tauri MCP DOM fixture injected into the dev WebView that uses the current app's loaded CSS/scoped classes, then remove it after measurement.
- Confirm the target is the running dev app before DOM QA. Do not inspect `/Applications/Acepe.app`.
- Check computed styles for the main card, shelf, and wrapper.
- Do not use a screenshot as the first proof.
- Keep any temporary DOM probe outside committed app code.

**Test scenarios:**
- Integration: live DOM has no far-right filler edge element.
- Integration: main tool card has `border-bottom-width: 0px` in attached mode so the top bar is gone.
- Integration: attached shelf has `border-top-width: 0px`.
- Integration: attached shelf has nonzero top-right radius.
- Integration: attached shelf width is less than the main card width and fits its buttons.
- Integration: pixel-level or screenshot sanity check focuses on the join area after computed-style checks pass, so an anti-aliased seam is not missed.

**Verification:**
- DOM QA output explicitly lists computed `border-*`, `border-radius`, `background-color`, and rect values.
- Screenshot is used only after DOM checks and is described plainly.

## System-Wide Impact

- **Interaction graph:** `scene-content-viewport.svelte` composes a tool call and its attached permission shelf; `permission-bar.svelte` remains the reusable visual surface.
- **Error propagation:** No error behavior changes.
- **State lifecycle risks:** No session, permission, or transcript state changes.
- **API surface parity:** `attachment="tool-call"` remains the shared UI API for attached permission mode.
- **Integration coverage:** Live DOM QA is required because unit tests cannot fully prove CSS shape composition.
- **Unchanged invariants:** Permission approval actions, permission labels, tool-call matching, and standalone permission bars remain unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Removing the card bottom border loses too much frame definition | DOM-check that the shelf owns the compact cap and visually inspect the join after DOM passes |
| The shelf seam remains visible on certain themes | Verify computed background tokens and run QA in the active theme |
| Fix regresses standalone permission bars | Keep attached-mode branches isolated and run `permission-bar.svelte.vitest.ts` |
| Another fake edge is introduced | Plan forbids filler border art and corner-helper elements in this pass |

## Documentation / Operational Notes

- Update the DOM-first QA learning if implementation reveals a sharper rule.
- Final report must include DOM QA facts, not just a screenshot claim.

## Sources & References

- Related code: `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte`
- Related code: `packages/ui/src/components/agent-panel/permission-bar.svelte`
- Related code: `packages/ui/src/components/agent-panel/agent-tool-card.svelte`
- Related learning: `docs/solutions/workflow-issues/dom-first-qa-for-css-shape-bugs-2026-05-20.md`
- Related learning: `docs/solutions/workflow-issues/visual-qa-screenshot-evidence-must-be-described-2026-05-20.md`
- Related learning: `docs/solutions/workflow-issues/visual-qa-target-dev-tauri-app-2026-05-20.md`
