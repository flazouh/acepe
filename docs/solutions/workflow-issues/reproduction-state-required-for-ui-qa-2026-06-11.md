---
title: UI QA must arrange a reproduction state when the target element is absent
date: 2026-06-11
category: docs/solutions/workflow-issues
module: visual QA workflow
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - Verifying Acepe UI-visible changes through the dev Tauri WebView
  - The currently open app state does not show the element or interaction that changed
  - A bug depends on a specific session, transcript entry, preference, or interaction state
symptoms:
  - QA stops after confirming the app is running but the modified control is not visible
  - The final report says the exact interaction could not be verified in-app
  - A targeted unit test exists, but no real user-visible reproduction was exercised
root_cause: missing_workflow_step
resolution_type: workflow_improvement
tags: [visual-qa, reproduction, tauri-webview, qa-wrapper, workflow]
---

# UI QA must arrange a reproduction state when the target element is absent

## Context

During the assistant thinking-block flicker fix, the dev Tauri app was inspected
with the QA wrapper, but the currently open session did not contain a visible
thinking block. The QA pass verified the dev target, wrapper, viewport, and
screenshot path, then reported that the exact interaction could not be clicked
because the element was absent.

That is not enough for UI-visible work. If the changed interface element is not
currently visible, the next QA step is to arrange a state that makes it visible.

## Guidance

Do not treat "the element is not on the current screen" as the end of visual QA.

Instead, create or navigate to a reproduction state that exercises the changed
interaction in the real dev Tauri WebView:

1. Prefer an existing session, route, fixture, story, or dev screen that already
   contains the target state.
2. If none exists, create the narrowest reliable fixture or wrapper primitive
   needed to make the state visible.
3. Use `bun run qa doctor` first, then the QA wrapper primitives to navigate,
   inspect, click, watch, and screenshot the reproduction.
4. If the wrapper cannot set up the state smoothly, improve the wrapper instead
   of falling back to repeated raw Tauri MCP snippets.
5. Only call UI QA complete after the modified element or interaction itself was
   exercised in the running dev app.

For stateful transcript or agent-panel bugs, the reproduction may be a seeded
session, a dev route, a test fixture exposed through the app, or a QA wrapper
command that injects controlled data through supported app seams. The important
part is that the evidence comes from the real Tauri WebView, not only from a
unit test or a nearby screen.

## Why This Matters

UI bugs often live in the exact state that is missing from the current screen:
expanded disclosure rows, permission bars, historical transcript entries,
streaming transitions, hover controls, preference defaults, or remount timing.

If QA stops because that state is absent, it creates false confidence. The code
may be covered by a focused test, but the product interaction can still be
broken by app wiring, context providers, viewport virtualization, CSS, or Tauri
runtime behavior.

The absence of the element is a setup problem, not a verification result.

## When to Apply

- A change affects a control that is conditionally rendered.
- The target appears only for particular transcript content or session history.
- The bug requires clicking, expanding, approving, hovering, streaming, or
  resizing in a specific state.
- The current dev app screen is valid but does not contain the changed element.
- The final QA evidence would otherwise say "could not verify the exact
  interaction because it was not visible."

## Example

Bad QA endpoint:

```text
QA wrapper passed doctor/observe/screenshot. The open session did not include a
thinking block, so I could not click the exact control.
```

Better QA flow:

```text
QA wrapper passed doctor. The open session did not include a thinking block, so
I opened or seeded a session with a settled thought chunk, clicked Expand
thinking, waited a frame, and inspected that thinking-block-content remained
visible in the dev Tauri WebView.
```

## Related

- [Acepe QA wrapper should hide raw Tauri MCP friction](acepe-qa-wrapper-for-tauri-mcp-friction-2026-06-07.md)
- [DOM-first QA for CSS shape bugs](dom-first-qa-for-css-shape-bugs-2026-05-20.md)
- [Visual QA screenshot evidence must be shown and described before claiming pass](visual-qa-screenshot-evidence-must-be-described-2026-05-20.md)
- [Visual QA must target the changed app build](visual-qa-target-dev-tauri-app-2026-05-20.md)
