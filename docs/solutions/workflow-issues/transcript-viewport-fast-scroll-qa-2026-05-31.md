---
title: Deterministic QA for transcript viewport fast-scroll blanks
date: 2026-05-31
last_updated: 2026-05-31
category: docs/solutions/workflow-issues
module: transcript viewport QA
problem_type: workflow_issue
component: agent panel
severity: high
applies_when:
  - Verifying fast scroll behavior in Rust-owned transcript viewports
  - A blank transcript pane may stabilize before an agent can inspect it
  - Comparing two visible agent panel sections after rapid scroll gestures
tags: [visual-qa, transcript-viewport, fast-scroll, tauri-mcp, deterministic-qa]
---

# Deterministic QA for transcript viewport fast-scroll blanks

## Context

Fast upward scrolling could leave the browser at `scrollTop = 0` while the rendered transcript rows still belonged to a deep buffered slice. Visually this looked like an empty pane. The bug was easy to miss because the viewport could recover before inspection.

## Command

Restart the desktop dev app, or explicitly confirm the running Tauri dev window was rebuilt from the current checkout, then run:

```bash
cd packages/desktop
bun run qa:transcript-viewport-scroll
```

Useful focused run:

```bash
cd packages/desktop
bun run qa:transcript-viewport-scroll --iterations=1
```

The command talks to the real Tauri dev WebView through Tauri MCP. It writes a JSON artifact to `/tmp/acepe-transcript-viewport-scroll-qa-*.json`.

Do not trust visual QA after viewport code changes until the dev app has been restarted or confirmed fresh. Stale WebView code can make a fixed branch look broken, or make a broken branch look fixed.

## What It Checks

- All visible, scrollable transcript viewports are present.
- The initial state is not already blank.
- After fast scroll down, each viewport reaches near the bottom and still has visible rows.
- After fast scroll up, rendered rows are still near the visible top.
- After refill settles, each viewport still has rows intersecting the visible viewport.
- During settle, the viewport does not jump downward into a blank rendered gap.

The important failure signal is `blank_top_gap`. That means the first rendered row starts far below the visible viewport, so the user sees blank space.

## Failure Modes Caught

- Rust viewport height was `0` on startup, so a non-empty transcript produced an empty buffer.
- The DOM remounted at `scrollTop = 0` while the detached Rust buffer started deeper in the transcript.
- Outside-buffer recovery kept an old pending request, so a fast jump to the opposite edge retried the wrong scroll target.
- Multiple Svelte paths wrote `scrollTop` directly, so fast scroll could make stale targets, recovery clamps, and follow-tail pinning fight each other. Keep exactly one physical DOM scroll actuator; all other paths should emit typed scroll commands.
- Fast wheel gestures at a rendered buffer edge can flood Rust with repeated semantic scroll commands. Queue them: allow one command in flight, but accumulate wheel deltas so the gesture still covers the intended distance.
- Jumping the browser scrollbar to the physical bottom is a tail reveal, not just a normal detached refill. Scroll/reveal commands should force a fresh Rust viewport push so the WebView is not left clamped to an old buffer.
- Request generations must be per-session store state, not local component state. If a viewport remounts or the same session opens in another pane, a local counter starting again at `0` can make fresh command replies look stale and get dropped.
- A jump-to-bottom has two steps: Rust must load the tail rows, then the DOM must pin to the rendered bottom after those rows exist. Keep an explicit bottom-jump pin retry alive through the temporary outside-buffer clamp.
- Do not force a fresh push for every normal scroll/refill command. Ordinary edge refills should stay cheap; reserve forced fresh pushes for jump/recovery paths that need a canonical rebaseline.
- In a virtualized viewport, raw `scrollTop` distance can be misleading after row measurement drift. Treat the bottom as reached when the canonical last buffered row is visibly aligned with the viewport bottom.
- Synthetic `WheelEvent` does not perform native browser scrolling. Use it only to exercise semantic edge handlers; use direct `scrollTop` movement or Tauri interactions to test physical scroll movement.

## If The User Catches It Live

Run the one-iteration command immediately. The script snapshots the starting state before it changes scroll position, so it can catch an already-bad pane before the UI stabilizes.

## Related

- [Visual QA must target the changed app build](./visual-qa-target-dev-tauri-app-2026-05-20.md)
