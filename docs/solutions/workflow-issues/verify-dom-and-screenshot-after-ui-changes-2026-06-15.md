---
title: Verify the DOM (not just the screenshot) after every UI change
date: 2026-06-15
last_updated: 2026-06-15
category: docs/solutions/workflow-issues
module: website /v2 landing, GrainGradientCard
problem_type: workflow_issue
component: landing-v2
severity: high
applies_when:
  - Shipping or editing any UI-affecting change (component, layout, styling, asset)
  - A change "looks done" from code review or a passing typecheck alone
  - A visual element is mounted lazily (IntersectionObserver, on-scroll, async init)
  - A screenshot looks plausible but the signature element may be silently absent
tags: [visual-qa, dom-verification, dev-browser, lazy-mount, intersection-observer, shader]
---

## Problem

A `/v2` landing change (logo SVG + replacing the bento's WebGL grain-gradient
cards with solid warp cards) passed code edits cleanly. Tests and `bun run check`
flagged nothing new in the touched files. The page rendered. It "looked done."

It was not. A DOM inspection — done only because we explicitly verified after the
UI change — found the **hero grain-gradient shader never mounts on a fresh load**:
`document.querySelectorAll("canvas").length === 0`, and the shader container stayed
`opacity-0` with zero children. The hero showed only its solid fallback color, so a
screenshot still looked "fine-ish" and would have shipped a blank hero backdrop.

The defect was pre-existing in `GrainGradientCard` (an initial-mount race in the
IntersectionObserver / noise-texture `init()` path), but it was *invisible* until
the DOM was asserted against expectation.

## Root cause of the miss (process)

Three weak verification habits, each individually defensible, combined to hide it:

1. **Trusting "the page renders" as success.** The container div, sizing, and props
   were all correct. Presence of the *wrapper* is not presence of the *content*.
2. **Trusting a screenshot that looks plausible.** A solid-color fallback behind a
   foreground screenshot reads as intentional. The eye fills the gap.
3. **Silent async failure.** `void init(version)` turns any throw into an unhandled
   rejection, which does **not** fire Playwright's `pageerror`. No console error
   appeared, so "no errors" was misleading.

## Lesson / Protocol

**After any UI-affecting change, verify the rendered DOM — do not stop at "it
compiles" or "the screenshot looks okay."** Concretely, via the dev-browser:

1. `bun run check` (catches type/markup regressions, not visual ones).
2. Load the real page and **assert the signature element actually rendered**, not
   just its container. For lazy/async visuals, poll and assert the terminal node:
   - shader/canvas visuals → `querySelectorAll("canvas").length > 0`
   - the changed component → its expected child count / fill / computed style
3. **Screenshot, then read it back and describe what is actually there** — name the
   element you changed and confirm it is present, not merely "the page looks right."
4. For **lazy-mounted** elements (IntersectionObserver, on-scroll, async init),
   test the **initial-load** state specifically, and the scroll/teardown/re-init
   cycle — initial mount is its own code path and races differently from re-mount.

### Decisive diagnostic for silent async mount failures

`page.on("pageerror")` does **not** catch unhandled promise rejections. To surface
a swallowed `void asyncInit()` failure, attach a listener in page context and force
a re-init, then read it back:

```js
await page.evaluate(() => {
  window.__rej = [];
  window.addEventListener("unhandledrejection", e =>
    window.__rej.push((e.reason && e.reason.stack) || String(e.reason)));
});
// force teardown + re-init for IntersectionObserver-gated mounts
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(600);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(2500);
// read window.__rej and the canvas/element count
```

Note: `evaluateOnNewDocument` (Puppeteer) and `addInitScript` are restricted in the
dev-browser sandbox — register the listener with a plain `page.evaluate` after
`goto`, then trigger the re-init.

## Outcome

The intended changes were confirmed correct by DOM assertion (header mark: 7 cream
bars + 75 speckle dots, `fill #f8f5ee`; bento: 5 solid `#1a1a1a` cards, zero
canvases). The hero-shader initial-mount race was caught as a separate, real,
pre-existing bug — found only because we verified the DOM instead of trusting the
screenshot.
