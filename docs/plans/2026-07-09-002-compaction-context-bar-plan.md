# Compaction Context Bar Plan

## Goal

Make compaction activity easier to understand at a glance by showing how much context was used before compaction, how much remains after it, and how much was reclaimed.

## Architecture

- Keep token counts canonical: Rust continues to own the compaction event values.
- Add an optional structured `contextUsage` presentation model to `AgentSessionActivityEntry`.
- Populate that model in the desktop transcript viewport mapper from canonical numeric fields.
- Keep `@acepe/ui` purely presentational. It must not parse formatted metadata strings or import desktop/runtime state.

## UI

- Completed events with before and after values render one compact horizontal context track.
- The track layers a muted Before fill under a success-colored After fill, leaving unused context visible.
- Labels show Before and After counts with percentages when the context window is known.
- Preparing renders an honest indeterminate meter with `aria-busy`; it does not claim numeric progress.
- The indeterminate treatment becomes static when reduced motion is requested.
- Usage-reset and failed states keep their text treatment when no comparable values exist.
- Ancillary metadata such as trigger, duration, and preserved messages remains below the visualization.
- Before, After, and Window are removed from metadata chips when represented by structured context usage.
- Numeric labels use tabular figures and the layout must wrap safely at narrow transcript widths.

## Numeric Rules

- Negative and non-finite values are treated as missing.
- Segment percentages are clamped to `0..100`.
- A positive context window is the preferred scale; otherwise the largest valid before/after value is the scale.
- If after exceeds before, reclaimed context is zero and the bars remain clamped without implying savings.
- The comparison visualization requires valid before and after values; partial values remain available as text only.

## Files

- `packages/ui/src/components/agent-panel/types.ts`
- `packages/ui/src/components/agent-panel/agent-session-activity-entry.svelte`
- `packages/ui/src/components/agent-panel/compaction-context-usage.ts` and focused tests
- `packages/desktop/src/lib/acp/components/agent-panel/logic/transcript-viewport-row-mapper.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/transcript-viewport-row-mapper.test.ts`
- `packages/desktop/src/lib/components/dev/design-system-compaction-activity-specimens.ts`

## TDD And Verification

1. Add failing pure view-model tests for normal, missing-window, clamped, and invalid token values.
2. Extend the mapper test to require structured context usage and non-duplicated metadata.
3. Implement the smallest model, mapper, and Svelte rendering changes.
4. Run focused UI and desktop tests, then `bun run check` in `packages/desktop`.
5. Use the real Tauri QA wrapper to inspect the completed and preparing specimens and capture a screenshot.

## Scope Boundaries

- No provider-specific UI branches.
- No fabricated percentage for live compaction progress.
- No changes to Rust compaction parsing or canonical transcript order.
- No general progress-component extraction unless the final treatment exactly matches an existing reusable primitive.
