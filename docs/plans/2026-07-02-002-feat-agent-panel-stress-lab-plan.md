---
title: feat: Agent panel stress lab
type: feat
status: active
date: 2026-07-02
---

# feat: Agent panel stress lab

## Overview

Create a dev-only stress lab for the Acepe agent panel that can render thousands of synthetic transcript rows, drive scroll and streaming scenarios, and report repeatable performance metrics.

This is not a product page. It is an engineering harness for finding the next real bottleneck after the WebKit proxy-trap fix.

## Problem Frame

We want Acepe to feel faster than any competing agent workspace. To get there, we need a repeatable way to stress the agent panel with much larger conversations than normal manual testing covers.

Current local tools are useful but not enough:

- `packages/desktop/src/routes/test-agent-panel/+page.svelte` is a small full-panel fixture.
- `packages/desktop/src/lib/acp/components/debug-panel/streaming-repro-lab.svelte` exercises streaming phases.
- `packages/desktop/src/lib/acp/testing/long-session-fixture.ts` tops out at hundreds of entries, not thousands.

The next step is a dedicated lab that can generate 1k, 5k, 10k, and larger row counts and collect real browser/WebView metrics.

## Requirements Trace

- R1. Provide a dev-only route that stress-tests the real agent panel transcript rendering path.
- R2. Generate synthetic fixtures at large scales: at least 1k, 5k, 10k, and 25k rows.
- R3. Keep synthetic fixture data out of canonical session state and provider history.
- R4. Exercise representative row mixes: user messages, assistant text, assistant thought, tool rows, and an active streaming tail.
- R5. Show useful on-screen metrics: generation time, mount/render time, DOM row count, scroll timing, frame/jank samples, and memory when available.
- R6. Provide controls to switch scenarios without code edits.
- R7. Allow exporting a JSON performance dump outside watched source paths.
- R8. Support QA wrapper verification of the page and one repeatable scenario.
- R9. Prevent synthetic stress data from triggering real transcript row bootstrap or Tauri row fetches.

## Scope Boundaries

- This plan does not change canonical transcript identity, ordering, provider parsing, session lifecycle, or Rust-owned session truth.
- This plan does not optimize `MessageScroller` yet. It creates the lab that tells us which optimization to make next.
- This plan does not replace production telemetry.
- This plan does not add third-party benchmarking libraries.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src/routes/test-agent-panel/+page.svelte` already hosts a dev fixture route, but it uses a tiny mock and wraps the full `AgentPanel`.
- `packages/desktop/src/lib/acp/components/debug-panel/streaming-repro-lab.svelte` renders `AgentPanelContent` with synthetic `sceneEntries` and `rowsProjectionOverride`.
- `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte` owns `rust-transcript-viewport`, builds `MessageScroller` items, and renders `TranscriptViewportRowRenderer`.
- `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte` currently bootstraps rows when `sessionId` is non-null. The stress lab must skip that bootstrap when `rowsProjectionOverride` is present.
- `packages/ui/src/components/agent-panel/message-scroller.svelte` renders all rows in DOM flow with `content-visibility:auto`, not a windowed virtualizer.
- `packages/desktop/src/lib/acp/testing/long-session-fixture.ts` proves synthetic long-session fixture patterns already exist.
- `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/virtualized-entry-display.test.ts` already checks bounded scaling around display-row construction.

### Institutional Learnings

- `docs/solutions/performance-issues/svelte-prop-spread-descriptor-churn-2026-07-02.md`: WebKit hotspots can come from Svelte/rest prop proxy descriptor churn; keep hot render paths explicit.
- `docs/solutions/performance-issues/cursor-session-start-freeze-proxy-array-chain-2026-07-02.md`: avoid proxy-backed collections in Svelte-facing state; use plain arrays for large UI-facing data.
- `docs/solutions/performance-issues/session-open-freeze-closed-sdk-control-channel-2026-07-02.md`: sample the hot process before changing unrelated layers.

### External References

- None. Local patterns are enough for this first harness.

## Key Technical Decisions

- Use `AgentPanelContent` or `SceneContentViewport` as the primary stress target, not the full `AgentPanel` shell.
  - Rationale: the bottleneck we are studying is transcript rendering, scroll anchoring, and row content. Full shell stores add noise.
- Generate plain arrays of fixture rows.
  - Rationale: the recent WebKit issues showed proxy-backed data in hot Svelte paths is dangerous.
- Make the fixture generator a TypeScript logic module, not embedded page script.
  - Rationale: row mixes and counts need fast unit tests and future reuse in perf tests.
- Keep the route under a dev/test namespace.
  - Rationale: this is engineering tooling, not user product.
- Add the stress route at `/test-agent-panel-stress` and guard the UI with `import.meta.env.DEV`.
  - Rationale: existing local test routes use the `test-` namespace, and the page should stay out of product use.
- Skip `SceneContentViewport` row bootstrap when `rowsProjectionOverride` is present.
  - Rationale: synthetic rows must not request real Rust-owned rows for a fake session.
- Export dumps to `/tmp` or user-selected download text, not source-tree watched paths by default.
  - Rationale: writing perf artifacts into watched repo paths can trigger Vite/Tauri churn.

## Open Questions

### Resolved During Planning

- Should this create fake canonical sessions? No. It should pass synthetic render inputs directly through existing component props.
- Should the first target be full `AgentPanel`? No. Start with `AgentPanelContent` / viewport. Add full shell mode later only if needed.
- Should row counts exceed 10k? Yes. Include 25k as a stress preset because content-visibility needs to prove it can handle huge DOM-flow lists.
- What route should host it? Add a new `/test-agent-panel-stress` route.
- Should override-based fixtures trigger row bootstrap? No. Gate bootstrap whenever `rowsProjectionOverride` is present.

### Deferred to Implementation

- Exact thresholds for "pass/fail": first implementation records metrics; thresholds should be calibrated from local runs.
- Whether WebKit exposes useful memory APIs in the Tauri WebView: detect at runtime and show "unavailable" if missing.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
stress route
  |
  v
controls: row count, row mix, streaming tail, width, seed
  |
  v
fixture generator
  -> sceneEntries: AgentPanelSceneEntryModel[]
  -> rowsProjectionOverride: TranscriptRowsState
  |
  v
AgentPanelContent / SceneContentViewport
  |
  v
MessageScroller + real row renderers
  |
  v
metrics collector
  -> generation time
  -> render/mount time
  -> DOM row count
  -> scroll jump timings
  -> frame/jank samples
  -> JSON dump
```

## Implementation Units

- [x] **Unit 0: Bootstrap isolation guard**

**Goal:** Ensure synthetic override data does not trigger real transcript row bootstrap.

**Requirements:** R3, R9

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte`
- Test: add focused coverage near existing transcript viewport/component tests where practical

**Approach:**
- Update the bootstrap effect so it returns early when `rowsProjectionOverride` is present.
- Keep behavior unchanged for real sessions without an override.
- Add a test or targeted verification that an override render does not call `ensureRowsBootstrap`.

**Verification:**
- Existing transcript viewport tests still pass.
- New guard coverage proves override mode does not request real rows.

- [x] **Unit 1: Synthetic stress fixture generator**

**Goal:** Create a pure fixture module that can generate large transcript row sets and matching scene entries.

**Requirements:** R2, R3, R4

**Dependencies:** None

**Files:**
- Create: `packages/desktop/src/lib/acp/testing/agent-panel-stress-fixture.ts`
- Test: `packages/desktop/src/lib/acp/testing/agent-panel-stress-fixture.test.ts`

**Approach:**
- Generate plain arrays for `TranscriptViewportRow[]` and `AgentPanelSceneEntryModel[]`.
- Support deterministic seeds and named presets: text-heavy, tool-heavy, mixed, streaming-tail.
- Ensure generated row ids, source entry ids, and versions are stable and unique.
- Include an active tail preset that marks exactly one row with `activeStreamingTail`.

**Execution note:** Implement test-first for the generator because it is pure logic and easy to pin down.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/testing/long-session-fixture.ts`
- `packages/desktop/src/lib/acp/components/debug-panel/streaming-repro-lab.svelte`
- `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/agent-panel-pipeline-integration.test.ts`

**Test scenarios:**
- Happy path: generating 1k rows returns 1k viewport rows and matching scene entries with stable ids.
- Happy path: each preset includes the expected row-kind distribution.
- Edge case: generating 0 rows returns an empty projection without throwing.
- Edge case: 25k rows uses plain arrays and has unique row ids.
- Integration: generated rows can be passed into `buildRenderedTranscriptViewportRows` without missing-entry fallbacks for normal presets.

**Verification:**
- Fixture tests pass.
- No custom `Proxy` collections or Svelte state are used inside the generator.

- [x] **Unit 2: Stress lab route and controls**

**Goal:** Add a dev-only page that renders the real transcript content path with generated stress fixtures.

**Requirements:** R1, R2, R4, R6

**Dependencies:** Units 0 and 1

**Files:**
- Create: `packages/desktop/src/routes/test-agent-panel-stress/+page.svelte`

**Approach:**
- Render `AgentPanelContent` or `SceneContentViewport` inside a fixed-size workspace.
- Render an inert "dev-only" shell when `import.meta.env.DEV` is false.
- Provide controls for row count, preset, panel width, streaming tail on/off, and regenerate.
- Keep the UI dense and utilitarian; no marketing copy.
- Add stable selectors such as `data-testid="agent-panel-stress-lab"`, `data-testid="stress-metric-render-ms"`, and `data-testid="stress-transcript-host"`.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/components/debug-panel/streaming-repro-lab.svelte`
- `packages/desktop/src/routes/test-command-chip/+page.svelte`
- `packages/desktop/src/routes/test-agent-panel/+page.svelte`

**Test scenarios:**
- Happy path: default route renders a transcript viewport and stress controls.
- Happy path: selecting 5k rows updates the generated fixture summary.
- Edge case: switching presets does not leave stale row counts or stale active-tail labels.

**Verification:**
- Page renders in the Tauri dev WebView.
- QA wrapper can inspect the route root and transcript viewport selectors.

- [x] **Unit 3: Metrics collector and JSON dump**

**Goal:** Collect repeatable performance facts from the stress lab.

**Requirements:** R5, R7

**Dependencies:** Unit 2

**Files:**
- Create: `packages/desktop/src/lib/acp/testing/agent-panel-stress-metrics.ts`
- Test: `packages/desktop/src/lib/acp/testing/agent-panel-stress-metrics.test.ts`
- Modify: `packages/desktop/src/routes/agent-panel-stress/+page.svelte`

**Approach:**
- Use browser `performance.now()`, `performance.mark`, and `requestAnimationFrame`.
- Track fixture generation time, first settled render time, DOM row count, scroll-to-top time, scroll-to-bottom time, and frame samples during scripted scroll.
- Expose a JSON dump object on screen and via a copy/download action.
- Default dump destination should be user-controlled text or `/tmp`, not watched source paths.

**Patterns to follow:**
- Existing QA wrapper artifact behavior under `/tmp`.
- Existing page fixture controls in `test-command-chip`.

**Test scenarios:**
- Happy path: metrics summary formats finite numbers when supplied finite samples.
- Edge case: unavailable memory APIs produce `null`/`unavailable`, not crashes.
- Edge case: empty row set reports zero DOM rows and finite generation time.

**Verification:**
- Metrics are visible in the route.
- JSON dump contains route, preset, row count, timestamp, and measured values.

- [x] **Unit 4: QA wrapper scenario**

**Goal:** Make the stress page easy to verify through the existing Acepe QA wrapper.

**Requirements:** R8

**Dependencies:** Units 2 and 3

**Files:**
- Modify or create under: `packages/desktop/scripts/acepe-qa/`
- Modify if needed: `packages/desktop/scripts/acepe-qa.ts`
- Test: existing QA script tests if present, or targeted CLI smoke verification

**Approach:**
- Prefer adding a small wrapper command if current `qa inspect/click/send` cannot navigate and run the scenario smoothly.
- Scenario should navigate to the stress route, set a row count, wait for metrics, inspect the transcript viewport, and capture a screenshot.

**Patterns to follow:**
- Existing `bun run qa doctor`, `observe`, `inspect`, and `screenshot` behavior.

**Test scenarios:**
- Happy path: command reports route loaded, row count selected, metrics visible, and screenshot artifact path.
- Failure path: if dev app is unavailable, command exits with a clear message and does not report a false pass.

**Verification:**
- `bun run qa doctor` passes.
- Stress scenario can be verified in the real Tauri WebView.

## System-Wide Impact

- **Interaction graph:** None. Synthetic rows are local to the page and do not create interactions.
- **Error propagation:** Fixture generation errors should show a local page error, not crash app navigation.
- **State lifecycle risks:** Avoid writing synthetic rows into stores. Keep generated data page-local.
- **Production component behavior:** `SceneContentViewport` gets one guard for override mode only; real sessions still bootstrap rows from Rust.
- **API surface parity:** No user-facing API changes.
- **Integration coverage:** Component-level tests plus Tauri WebView QA are required because this is a UI/performance harness.
- **Unchanged invariants:** Rust remains the authority for real transcript order and identity. The lab is a synthetic render harness only.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| The lab accidentally tests a toy path, not production rendering | Render `AgentPanelContent` / `SceneContentViewport` with real row renderers and `MessageScroller`. |
| The lab pollutes canonical session state | Keep all fixture data local and pass it through explicit props only. |
| 25k rows freezes development while testing | Generate presets on demand, show progress, and keep controls responsive enough to recover by lowering counts. |
| Metrics become noisy | Record raw samples and environment metadata; use them for trend comparison, not absolute truth at first. |
| QA friction makes the lab unused | Add a QA wrapper scenario when basic inspect/click is not smooth enough. |

## Documentation / Operational Notes

- Add a short note to the page explaining that it is synthetic and dev-only.
- Document how to read the JSON dump after the first implementation lands.
- Follow-up optimizations should cite dumps from this lab.

## Sources & References

- Related code: `packages/desktop/src/routes/test-agent-panel/+page.svelte`
- Related code: `packages/desktop/src/lib/acp/components/debug-panel/streaming-repro-lab.svelte`
- Related code: `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte`
- Related code: `packages/ui/src/components/agent-panel/message-scroller.svelte`
- Related code: `packages/desktop/src/lib/acp/testing/long-session-fixture.ts`
- Related learning: `docs/solutions/performance-issues/svelte-prop-spread-descriptor-churn-2026-07-02.md`
- Related learning: `docs/solutions/performance-issues/cursor-session-start-freeze-proxy-array-chain-2026-07-02.md`
