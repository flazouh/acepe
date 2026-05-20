---
title: fix: Correct attached permission shelf shape
type: fix
status: implemented
date: 2026-05-20
---

# fix: Correct attached permission shelf shape

## Situation Checklist

- [x] The current committed fix is wrong: `.tool-call-permission-main-edge` draws a fake curved border at the far right of the tool card.
- [x] The permission shelf should stay bottom-left and only as wide as the buttons need.
- [x] The shelf should not add a toolbar, left icon, or `Permission required` label in attached mode.
- [x] There should be no top border or visible seam above the shelf.
- [x] The main tool card should keep its real bottom border on the right, while the shelf overlaps the left part so no top bar appears above the buttons.
- [x] The attached shelf should use a normal compact border; the inverse join was too artifact-prone.
- [x] QA must use DOM/computed-style checks first, then screenshot only as a final sanity check.
- [x] The QA fixture or live state must be deterministic; do not inspect a random current app state and call it proof.

## Overview

Replace the fake far-right edge with a real attached-shelf shape. The permission shelf should own only the compact button cap attached to the bottom-left. In attached mode, the tool card keeps its real bottom edge to the right of the shelf, while the shelf overlaps the left part of that edge so no top bar appears above the buttons.

## Problem Frame

We tried to make two DOM boxes look like one shape: the tool call card and the attached permission shelf. The latest fix added a flex filler after the shelf to redraw the missing right-side border. That made DOM checks pass for a missing edge, but the user correctly saw a new bad shape: a weird curve at the far-right side of the tool call.

The better model is not "draw a second right edge." The better model is:

- the tool card keeps its real bottom-right edge;
- the shelf owns the compact attached surface and hides the bottom edge only where the shelf attaches;
- the shelf uses a normal compact border instead of an inverse radius;
- no sibling after the shelf draws decorative border art.

## Requirements Trace

- R1. Remove the far-right fake curve caused by `.tool-call-permission-main-edge`.
- R2. Preserve the compact attached shelf: buttons only, bottom-left, width fits content.
- R3. Keep the shelf visually attached with no top seam or top bar above it.
- R4. Give the attached shelf a normal compact border that avoids hook artifacts.
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
- `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte` currently wraps attached permission rows and can overlap the shelf over the tool card bottom edge.
- `packages/ui/src/components/agent-panel/permission-bar.svelte` owns the attached shelf surface through `.permission-attached-card`.
- `packages/desktop/src/lib/acp/components/tool-calls/permission-bar.svelte` maps desktop permission data into the shared UI permission bar.

### Institutional Learnings

- `docs/solutions/workflow-issues/dom-first-qa-for-css-shape-bugs-2026-05-20.md`: for CSS shape bugs, inspect element ownership, computed borders, radii, backgrounds, and rects before claiming success.
- `docs/solutions/workflow-issues/visual-qa-screenshot-evidence-must-be-described-2026-05-20.md`: screenshot QA must describe what is visible and must not remove permission context.
- `docs/solutions/workflow-issues/visual-qa-target-dev-tauri-app-2026-05-20.md`: QA must target the running dev app, not the installed production app.

### External References

- MDN: `border-radius` rounds an element's own outer border edge. That is fine for the fallback normal-border design.
- Inverted-radius CSS references describe inverse joins as non-native CSS shapes usually built with pseudo-elements or masking; for this case, the added complexity produced visible hook artifacts.

## Key Technical Decisions

- In attached mode, keep the tool card's real bottom edge on the right, and overlap the shelf over the left section where it attaches.
- Remove `.tool-call-permission-main-edge`: the far-right filler is the direct cause of the wrong curve.
- Use a normal shelf border and remove the inverse helper entirely.
- Keep attached mode in `AgentPanelPermissionBar` compact: the shared permission bar already supports buttons-only attached mode.

## Open Questions

### Resolved During Planning

- Should the far-right filler edge remain? No. It produces the visible wrong curve and splits border ownership across unrelated elements.
- Should this be fixed in canonical/session data? No. This is a visual composition bug only.

### Deferred to Implementation

- Exact corner feel: if the normal border still looks wrong, re-check the DOM geometry before adding decorative helpers.

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
- tool card keeps its bottom border to the right of the shelf
- shelf owns only the compact bottom-left cap
- shelf overlaps the left section of the bottom border
- shelf owns a normal compact border
- no filler element draws a border to the right of the shelf
```

## Implementation Units

- [x] **Unit 1: Remove split-border ownership**

**Goal:** Remove the current fake far-right edge and stop drawing a main-card top bar above the attached shelf.

**Requirements:** R1, R3

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/scene-content-viewport.svelte.vitest.ts`

**Approach:**
- Delete the `.tool-call-permission-main-edge` DOM element and CSS.
- Preserve the tool card bottom-right edge.
- Clear only the bottom-left radius where the shelf extends downward.
- Overlap the shelf by one border pixel so the card's bottom edge does not appear as a top bar above the buttons.

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

- [x] **Unit 2: Make the shelf attach locally**

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
- Keep the shelf directly below the tool card with a one-pixel overlap to cover only the border section under the shelf.
- Preserve matching background tokens between the tool card and shelf.
- Avoid full-width bars or decorative right-side border fillers.
- Do not use a pseudo-element or inverse-radius helper in this pass; use a plain compact border.

**Execution note:** DOM-first QA matters more than pixel guessing here.

**Patterns to follow:**
- Existing attached mode in `packages/ui/src/components/agent-panel/permission-bar.svelte`.
- Existing permission action layout in `packages/ui/src/components/agent-panel/permission-bar-actions.svelte`.

**Test scenarios:**
- Happy path: attached permission mode renders buttons only and does not render `Permission required`.
- Happy path: attached shelf remains content-width and keeps compact button padding.
- Regression: attached shelf has no top border.
- Regression: attached shelf does not expose an inverse-radius helper or pseudo-element.
- Regression: standalone permission bars still render their normal summary/context behavior.
- Regression: tests assert behavior and computed shape, not a magic overlap class.

**Verification:**
- The shelf appears as a compact bottom-left cap.
- The top seam above the shelf is gone without a separate color mask.

- [x] **Unit 3: Perform deterministic DOM-first QA**

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
- Integration: main tool card keeps a visible bottom edge to the right of the shelf.
- Integration: attached shelf has `border-top-width: 0px`.
- Integration: attached shelf has a normal border and no active inverse-radius pseudo-element.
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
| Hiding the whole card bottom border loses too much frame definition | Keep the real right-side bottom edge and overlap only the section under the shelf |
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
