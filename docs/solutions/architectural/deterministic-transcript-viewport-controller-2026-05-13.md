---
module: agent-panel
tags:
  - transcript-viewport
  - scrolling
  - svelte
  - architecture
problem_type: architecture
---

# Deterministic Transcript Viewport Controller

## Problem

The agent transcript had several places that could move scroll: the Svelte viewport, the old auto-scroll helper, the old follow controller, fallback recovery effects, resize observers, and public panel commands.

That made send-time bugs hard to reason about. A waiting or streaming row could also swap the renderer, which risked mounting a fresh scroll container at the top before a later reveal moved it back down.

## Solution

The main transcript now uses one policy owner:

```text
scene rows -> transcript viewport controller -> typed effects -> scheduler -> renderer adapter
```

The controller is pure TypeScript. It decides follow, detach, renderer mode, anchors, and which effects should run. The Svelte component only builds compact row summaries, sends typed events, and schedules returned effects.

Renderer-specific work lives behind adapters:

- Virtua adapter: `scrollToIndex`, `scrollTo`, and measurements.
- Native adapter: bounded fallback DOM scroll and measurements.

The component no longer selects native fallback just because `isWaitingForResponse`, streaming, token reveal timing, or a thinking row is present.

## Invariants

- User scroll cancels pending programmatic scroll effects before they can run.
- Waiting rows are row changes, not renderer-fallback reasons.
- Send is an explicit follow override.
- Detached row growth preserves user control and does not reveal tail.
- Public commands dispatch controller events; they do not write scroll directly.
- Diagnostics store row keys, counts, state names, and effect names, never message text.
