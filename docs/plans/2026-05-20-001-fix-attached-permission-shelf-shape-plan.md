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
- [ ] The main tool card should keep its real bottom border and bottom-right rounding on the right side.
- [ ] QA must use DOM/computed-style checks first, then screenshot only as a final sanity check.
- [ ] The QA fixture or live state must be deterministic; do not inspect a random current app state and call it proof.

## Overview

Replace the fake far-right edge with a simpler attached-shelf shape. The tool card should own its full-width frame. The permission shelf should own only the compact button cap attached to the bottom-left. The shelf may overlap the tool card's bottom border by the border width so the left seam disappears, but it must not create a new full-width border or far-right curve.

## Problem Frame

We tried to make two DOM boxes look like one shape: the tool call card and the attached permission shelf. The latest fix added a flex filler after the shelf to redraw the missing right-side border. That made DOM checks pass for a missing edge, but the user correctly saw a new bad shape: a weird curve at the far-right side of the tool call.

The better model is not "draw a second right edge." The better model is:

- the real tool card keeps its own bottom border and bottom-right radius;
- the shelf locally covers/intersects the left part of that border where the buttons attach;
- no sibling after the shelf draws decorative border art.

## Requirements Trace

- R1. Remove the far-right fake curve caused by `.tool-call-permission-main-edge`.
- R2. Preserve the compact attached shelf: buttons only, bottom-left, width fits content.
- R3. Keep the shelf visually attached with no top seam above it.
- R4. Preserve the main tool card's real right-side bottom border and bottom-right radius.
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

- Keep the real tool card as the owner of the main full-width outline: this prevents decorative far-right border artifacts.
- Remove `.tool-call-permission-main-edge`: the far-right filler is the direct cause of the wrong curve.
- Attach the shelf by local overlap instead of global border replacement: the shelf can sit over the left part of the card bottom border, while the right side remains the card's real border.
- Keep attached mode in `AgentPanelPermissionBar` compact: the shared permission bar already supports buttons-only attached mode.

## Open Questions

### Resolved During Planning

- Should the far-right filler edge remain? No. It produces the visible wrong curve and splits border ownership across unrelated elements.
- Should this be fixed in canonical/session data? No. This is a visual composition bug only.

### Deferred to Implementation

- Exact CSS offset value: use a named local CSS variable for the attachment overlap, starting at the existing border width (`1px`). DOM QA must verify the shelf top is within one CSS pixel of the card bottom and that the shelf does not move the card's right-side border/radius ownership.

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
- tool card owns the full rectangle border, including the far-right bottom curve
- shelf owns only the compact bottom-left cap
- shelf overlaps the card bottom border locally so there is no top seam above the buttons
- no filler element draws a border to the right of the shelf
```

## Implementation Units

- [ ] **Unit 1: Remove split-border ownership**

**Goal:** Remove the current fake far-right edge and stop removing the main card's bottom-right outline.

**Requirements:** R1, R4

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/scene-content-viewport.svelte.vitest.ts`

**Approach:**
- Delete the `.tool-call-permission-main-edge` DOM element and CSS.
- Stop clearing the tool card's bottom border and bottom-right radius globally for attached permissions.
- If any radius/border adjustment remains necessary, limit it to the left side where the shelf attaches.

**Execution note:** Test-first: add a failing regression test that attached permission rendering does not create a filler edge and does not remove the card's right-side outline.

**Patterns to follow:**
- Existing viewport wrapper logic in `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte`.
- Existing component test style in `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/scene-content-viewport.svelte.vitest.ts`.

**Test scenarios:**
- Happy path: attached permission renders a tool wrapper plus a permission shelf, with no `tool-call-permission-main-edge` element.
- Regression: attached permission styles do not set the tool card's bottom-right radius to `0`.
- Regression: attached permission styles do not remove the tool card's entire bottom border.

**Verification:**
- DOM structure has no far-right filler element.
- The real `.agent-tool-card` remains the owner of the far-right bottom curve.

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
- Position the shelf so its top edge overlaps the tool card's bottom border by `--tool-call-permission-overlap`, a named local CSS variable set to the existing card border width (`1px`) unless DOM QA proves the token differs.
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
- Regression: standalone permission bars still render their normal summary/context behavior.
- Regression: tests assert behavior and computed shape, not the presence of a specific negative-margin utility class.

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
- Integration: main tool card has nonzero bottom border and nonzero bottom-right radius.
- Integration: attached shelf has `border-top-width: 0px`.
- Integration: attached shelf width is less than the main card width and fits its buttons.
- Integration: shelf top position is within one CSS pixel of the main card bottom after applying the named overlap variable.
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
| A local overlap hides too much of the tool card border | DOM-check rects and computed borders, then visually inspect only after DOM passes |
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
