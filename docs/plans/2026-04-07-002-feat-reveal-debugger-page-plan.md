---
title: feat: Add reveal debugger dev page
type: feat
status: active
date: 2026-04-07
---

# feat: Add reveal debugger dev page

## Overview

Add a dev-only reveal debugger page that opens from the desktop top-bar dev tools menu and renders the real streaming markdown reveal path with inspection controls. This gives us a reproducible surface to audit the current fade/reveal behavior before we change the animation itself.

## Problem Frame

The current reveal animation complaint is about smoothness in the desktop agent thread UI, but the live behavior is buried inside the normal app shell and hard to probe. We need a controlled route that uses the real `MarkdownText` streaming path, lets us step through representative streaming states, and shows enough diagnostic state to separate observed behavior from guesses about the cause.

## Requirements Trace

- R1. The top-right dev tools menu in desktop dev mode must expose a reveal debugger entry.
- R2. The reveal debugger must open as a dedicated dev page that is easy to revisit while auditing animation behavior.
- R3. The page must render the real streaming message reveal path used by desktop threads, not a fake animation demo.
- R4. The page must expose enough controls and diagnostics to reproduce message growth, section transitions, and reveal/fade state changes.
- R5. This change is debugging infrastructure only; it does not change the production reveal animation behavior yet.

## Scope Boundaries

- No animation fix in this change.
- No production-facing navigation or settings surface for the debugger.
- No new shared UI package component unless a purely presentational extraction becomes obviously necessary.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src/lib/components/top-bar/top-bar.svelte` already exposes a dev-only tools menu with overlay actions.
- `packages/desktop/src/lib/components/main-app-view.svelte` is the right desktop shell seam for wiring new dev actions from the top bar.
- `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte` owns the streaming markdown rendering path and already applies `use:streamingReveal`.
- `packages/desktop/src/lib/acp/components/messages/logic/streaming-reveal-action.ts` contains the reveal fingerprinting logic we want to inspect.
- `packages/desktop/src/lib/acp/components/messages/logic/parse-streaming-tail.js` is the existing sectioning logic the debugger should surface rather than reimplement.
- `packages/desktop/src/lib/components/main-app-view/tests/design-system-wiring.contract.test.ts` shows the existing contract-test pattern for top-bar dev tool wiring.

### Institutional Learnings

- None directly on reveal debugging, but current desktop test posture favors contract tests for shell wiring and focused behavior tests for logic-heavy utilities.

## Key Technical Decisions

- **Route-based debugger:** Use a dedicated `/dev/reveal` route so the audit surface is bookmarkable and isolated from live session state.
- **Real render path:** Drive the debugger through `MarkdownText` with `isStreaming` rather than duplicating reveal logic in a demo-only component.
- **Inline diagnostics from the real reveal state:** Expose the exact reveal decision state used at runtime (current fingerprints, settled fingerprints, animate-from index, active scenario step) in-page rather than relying on derived guesses or console-only logging.
- **Dev-only route, not just dev-only discovery:** Keep access behind the existing dev menu and also guard the `/dev/reveal` route itself outside `import.meta.env.DEV`.
- **Repeatable audit controls:** Require explicit replay controls (preset picker, reset, play/pause, next step, previous step, speed, and visible current step) so audits can reproduce the same transition multiple times.

## Open Questions

### Resolved During Planning

- **Should this be an overlay or a route?** Route. The user explicitly asked for a dev page, and a route is easier to reopen and iterate on during animation audits.
- **Should the debugger use a mock animation component?** No. It should use the existing streaming markdown path so the reproduced behavior matches the real bug surface.

### Deferred to Implementation

- **Whether the debugger also needs a thin parity scenario through `AssistantMessage` / `MessageWrapper` in addition to standalone `MarkdownText`:** depends on how much of the roughness reproduces once the first route lands, but the debugger should leave room for this escalation without rework.

## Implementation Units

- [ ] **Unit 1: Add dev menu wiring for the reveal debugger**

**Goal:** Expose a reveal debugger entry from the desktop dev tools menu and route it from the main app shell.

**Requirements:** R1, R2

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src/lib/components/top-bar/top-bar.svelte`
- Modify: `packages/desktop/src/lib/components/main-app-view.svelte`
- Test: `packages/desktop/src/lib/components/main-app-view/tests/reveal-debugger-wiring.contract.test.ts`

**Approach:**
- Extend the existing dev tools prop surface with a reveal debugger action.
- Render a new menu item next to the existing design system/update entries.
- Navigate from `main-app-view` into the new route rather than opening another overlay.
- Land a stub route or pair the routing change with the route file so Unit 1 remains self-contained.

**Execution note:** Start with a failing contract test for the new dev menu entry and route wiring.

**Patterns to follow:**
- `packages/desktop/src/lib/components/main-app-view/tests/design-system-wiring.contract.test.ts`
- Existing `onDevShowUpdatePage` / `onDevShowDesignSystem` flow in `packages/desktop/src/lib/components/main-app-view.svelte`

**Test scenarios:**
- Happy path — the top-bar source exposes a reveal debugger callback prop and renders a `Reveal Debugger` dev tools entry wired to that callback.
- Integration — the main app shell source passes a reveal debugger handler into `TopBar` and routes to `/dev/reveal`.

**Verification:**
- In dev mode, the top-bar dev tools menu offers a reveal debugger entry wired to `/dev/reveal`.

- [ ] **Unit 2: Build the reveal debugger route around the real streaming renderer**

**Goal:** Create a dedicated dev page that can reproduce streaming reveal behavior and surface inspection data.

**Requirements:** R2, R3, R4, R5

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/messages/logic/streaming-reveal-action.ts`
- Create: `packages/desktop/src/routes/dev/reveal/+page.svelte`
- Test: `packages/desktop/src/routes/dev/reveal/reveal-debugger-page.contract.test.ts`
- Test: `packages/desktop/src/lib/acp/components/messages/logic/__tests__/streaming-reveal-action.test.ts`

**Approach:**
- Add a narrow debug seam to `streaming-reveal-action.ts` so the debugger can observe the exact reveal state already used by runtime logic instead of reconstructing it independently.
- Render `MarkdownText` with a controllable streaming source.
- Include a small set of representative presets for paragraph growth, section boundary changes, settled/live transitions, and at least one replayable real transcript fixture or parity case that better matches the reported roughness.
- Show all audit-critical diagnostics in-page: current markdown, parsed streaming sections, current fingerprints, settled fingerprints, animate-from index, active preset, active step, and current playback state. Console logging is supplemental only.
- Guard the route itself outside dev mode so direct navigation does not expose the debugger in production.

**Execution note:** Start with a failing contract test that proves the route exists and uses the real streaming markdown path.

**Patterns to follow:**
- `packages/desktop/src/routes/test-agent-panel/+page.svelte` for a dedicated dev/test route
- `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte`
- `packages/desktop/src/lib/acp/components/messages/logic/streaming-reveal-action.ts`

**Test scenarios:**
- Happy path — the route renders a reveal debugger page that mounts `MarkdownText` in streaming mode.
- Happy path — the route exposes explicit replay controls: preset picker, reset, play/pause, next step, previous step, speed, and visible current-step state.
- Integration — the route surfaces parsed streaming section diagnostics and the exact reveal state exported by `streaming-reveal-action.ts`.
- Edge case — the debugger includes a way to inspect transitions where a settled block changes shape, not only simple appended text.
- Edge case — the route blocks or redirects outside dev mode.
- Integration — at least one preset or fixture exercises behavior closer to the real thread rendering path than a trivial paragraph append.

**Verification:**
- Opening `/dev/reveal` in dev mode shows a reproducible streaming render plus readable in-page diagnostics for reveal audits, and the route is unavailable outside dev mode.

## System-Wide Impact

- **Interaction graph:** Top bar dev menu -> main app shell handler -> SvelteKit route -> reveal debugger page -> existing `MarkdownText` / `streamingReveal` pipeline.
- **Unchanged invariants:** Live production message rendering stays unchanged; only dev-only navigation and debugging infrastructure are added in this phase.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| The debugger accidentally reproduces only a simplified version of the bug | Drive it through `MarkdownText`, expose actual reveal state from `streaming-reveal-action.ts`, and include at least one parity-oriented preset or fixture |
| The route becomes cluttered and hard to use | Keep diagnostics focused on reveal-specific state and use a few high-value presets instead of exhaustive controls |

## Documentation / Operational Notes

- No user-facing docs required; this is a dev-only inspection surface.

## Sources & References

- Related code: `packages/desktop/src/lib/acp/components/messages/markdown-text.svelte`
- Related code: `packages/desktop/src/lib/acp/components/messages/logic/streaming-reveal-action.ts`
- Related code: `packages/desktop/src/lib/components/top-bar/top-bar.svelte`
