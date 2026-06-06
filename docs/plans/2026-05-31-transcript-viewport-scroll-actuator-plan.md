---
date: 2026-05-31
status: active
origin: docs/brainstorms/2026-05-28-rust-owned-transcript-viewport-requirements.md
module: transcript-viewport
tags:
  - svelte
  - tauri
  - transcript-viewport
  - scrolling
---

# Transcript Viewport Scroll Actuator Plan

## Problem

The Rust-owned transcript viewport is no longer failing only because of missing buffers. It now has a frontend authority problem: `scene-content-viewport.svelte` contains several direct `scrollTop = ...` writers inside effects and helper paths.

That means fast scroll can make different paths fight:

```
Rust viewport projection
        |
Svelte effect A -> scrollTop = x
Svelte effect B -> scrollTop = y
scroll handler  -> sends intent for z
effect C        -> scrollTop = old target
        |
flicker / empty rows / jumpy scroll
```

This violates the intended shape from the origin requirements:

```
Rust owns semantic viewport truth
        |
Svelte reports user intent + measurements
        |
one frontend DOM actuator writes physical scrollTop
```

Direct DOM scroll writes are not forbidden forever. The browser still needs one physical write so the scroll container moves. The rule is: Svelte may have one final scroll actuator, but effects must not each decide and write their own scroll target.

## Requirements Trace

- R2: Rust owns follow-tail vs detached, anchor row, logical offset, pending reveal, and visible range.
- R5: raw browser `scrollTop` is not product truth.
- R8: detached reading must preserve the anchor across row growth and height corrections.
- R11: WebView sends intent-level scroll and reveal events to Rust.
- R14: Svelte renders the Rust visible-window projection.
- R15: Svelte reports measurements and user input intent, but does not decide canonical viewport state.
- R16: no permanent duplicate viewport authority.
- R17/R18/R20: behavior, architecture, and boundedness must be tested.

## Current Evidence

`packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte` currently writes `scrollContainerRef.scrollTop` from multiple places:

- detached restore when the browser is outside the current buffer
- outside-buffer recovery clamp
- pending outside-buffer target apply
- Rust absolute `scrollTopTarget`
- anchor correction after height/layout changes
- follow-tail rendered-bottom pin

Those are valid needs, but invalid ownership. They must become typed scroll commands that pass through one ordered executor.

## Decision

Create one Svelte-side physical scroll actuator.

The actuator is not semantic truth. It is a small executor that receives typed commands from a pure controller and applies at most one selected DOM scroll write per frame/tick. Rust remains the source of canonical mode, visible range, logical offset, and corrections.

Target shape:

```
DOM user scroll / ResizeObserver / Rust projection
        |
        v
pure TS scroll controller
        |
        v
typed effects:
  - send scroll intent to Rust
  - send resize intent to Rust
  - send reveal intent to Rust
  - apply physical scrollTop target
  - schedule measurement confirmation
        |
        v
single Svelte executor
```

Priority for competing physical scroll commands:

1. outside-buffer clamp that keeps rendered rows visible while Rust refills
2. Rust anchor correction for measured height/layout changes
3. resolved pending outside-buffer target after Rust catches up
4. valid Rust absolute target for open/reveal/follow-tail
5. follow-tail rendered-bottom pin
6. detached restore target

User scroll events cancel or supersede stale programmatic targets unless the target is the active outside-buffer clamp required to avoid blank rows.

## Implementation Units

### Unit 1: Controller Characterization Tests

Files:

- `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/transcript-viewport-scroll-controller.test.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/logic/transcript-viewport-scroll-controller.ts`

Add tests before refactoring:

- multiple candidate scroll commands in one frame produce one physical scroll command
- outside-buffer clamp wins over stale Rust absolute targets
- user scroll away from tail suppresses stale follow-tail targets
- anchor correction is additive and does not send a user scroll intent back to Rust
- resolved pending outside-buffer target clears recovery state only when the buffer covers it
- same target within one pixel does not write again

### Unit 2: Typed Scroll Commands

Files:

- `packages/desktop/src/lib/acp/components/agent-panel/logic/transcript-viewport-scroll-controller.ts`

Add explicit command/effect types. Avoid `any`, `unknown`, and object spread.

Expected command examples:

- `physicalScroll`
- `dispatchScrollIntent`
- `dispatchResizeIntent`
- `dispatchRevealIntent`
- `scheduleRecovery`
- `confirmVisibleHeights`

The controller returns data. It does not touch DOM.

### Unit 3: Single DOM Actuator in Svelte

Files:

- `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte`

Replace direct `scrollContainerRef.scrollTop = ...` calls with one local function, for example `applyViewportScrollCommand`.

Rules:

- Only this function may assign `scrollContainerRef.scrollTop`.
- Effects may observe projection changes and enqueue controller events.
- Effects may call `tick()` when they need rendered DOM measurements.
- Effects must not choose final scroll order independently.
- The scroll handler reports user intent and visible position, then lets the controller decide whether recovery is needed.

### Unit 4: Architecture Boundary

Files:

- `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte`

Make the boundary obvious in code:

- one named actuator function owns the direct DOM assignment
- all call sites pass typed controller commands into that actuator
- behavior tests cover command ordering and stale-target suppression

Do not add a source-scanning test for this. The repo explicitly rejects tests that read source files and assert on string contents.

### Unit 5: QA Script Hardening

Files:

- `packages/desktop/scripts/qa-transcript-viewport-scroll.ts`

Extend the existing deterministic QA so it catches this bug class:

- fast scroll up/down/up in every visible transcript section
- failure when a pane has zero visible rows after the scroll settles
- failure when the scroll position oscillates for several frames after one input burst
- clearer error messages for the actual expected pane count

### Unit 6: Durable Learning

Files:

- `docs/solutions/workflow-issues/transcript-viewport-fast-scroll-qa-2026-05-31.md`

Update the learning: after changing viewport/scroll code, restart or confirm the dev app build before visual QA, because stale Tauri/WebView code can hide or fake scroll fixes.

## Test Plan

- `cd packages/desktop && AGENT=1 bun test src/lib/acp/components/agent-panel/logic/__tests__/transcript-viewport-scroll-controller.test.ts`
- `cd packages/desktop && bun run check`
- `cd packages/desktop/src-tauri && cargo test zero_height_viewport_still_buffers_non_empty_layout`
- `cd packages/desktop/src-tauri && cargo clippy`
- `cd packages/desktop && bun run qa:transcript-viewport-scroll --iterations=1 --skip-driver`
- Visual QA in the running dev Tauri app: open a long transcript, fast-scroll up in both sections, confirm rows remain visible and no pane blanks.

## Non-Goals

- Do not move semantic viewport truth back into Svelte.
- Do not restore TanStack Virtual as the transcript viewport authority.
- Do not make historical sessions read-only.
- Do not fix transcript ordering, row identity, or provider parsing in the UI.
- Do not start the dev server with `bun dev`; the user manages that process.

## Risks

- Some DOM measurements are only available after render. Keep these as measured inputs to the controller, not semantic decisions.
- One-frame clamping may still be needed when a native scroll jumps outside the current Rust buffer. This is acceptable only as temporary physical display protection while a Rust refill request is in flight.
- A too-strict architecture guard could slow normal refactors. Keep it focused on this component and this one assignment boundary.

## Done

- There is exactly one production assignment to `scrollContainerRef.scrollTop` in the Svelte viewport component.
- All previous scroll write needs still work through typed controller commands.
- Fast scroll no longer produces blank panes in deterministic QA.
- Tauri visual QA confirms rows remain visible after fast scroll up in both affected transcript sections.
