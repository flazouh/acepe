---
title: "feat: Acepe-themed reasoning-effort slider"
type: feat
status: active
date: 2026-06-23
---

# feat: Acepe-themed reasoning-effort slider

## Overview

Replace the reasoning config-option dropdown (a Brain icon trigger opening a vertical list of effort levels) with an Acepe-themed **effort slider**: a stepped, dithered "Effort heat" gradient track (green → coral → red) with a draggable knob and `Faster` / `Smarter` end labels. Reference affordance: Claude Code's "Effort: Ultracode" popover slider. The slider is a new presentational **View** over data the app already owns — it reads the canonical `ConfigOptionData.currentValue` / `options[]` and emits the existing `onValueChange(configId, value)` write. No new state, no new persistence path.

The change has one behavioral correction baked in: the shared effort ladder currently **drops `max`** (ranks it 0), so today the ladder tops out at `xhigh`. The slider requires the full `low · medium · high · xhigh · max` ladder, fixed at the single shared definition so the dropdown bar, the step-up cycle, and the slider all agree.

## Problem Frame

The reasoning effort control today is a compact Brain-icon dropdown. It works but (a) hides a real canonical level (`max`), and (b) reads as a generic list rather than a deliberate "faster ↔ smarter" tradeoff. The product goal (per `CONTEXT.md` vision: production-grade reviewability, durable internal models) is a clearer, on-brand affordance that communicates the effort tradeoff at a glance while staying strictly a View over canonical session capability data.

This plan was preceded by a GOD architecture pre-flight (cleared with conditions, carried into Key Technical Decisions) and a codebase map. No `docs/brainstorms/` requirements doc exists for this work; decisions were locked interactively with the user.

## Requirements Trace

- R1. The reasoning config option (`presentation === "compactReasoning"`) renders as a slider, not a dropdown list, in **both** surfaces that show it: the in-session composer toolbar and the new-thread setup bar.
- R2. The slider exposes 5 discrete levels including `max` (`low · medium · high · xhigh · max`), snapping to provider option values; `minimal` is retained where present.
- R3. The knob emits the **exact provider string** (`"low" … "max"`) via the existing `onValueChange(configId, value)` path — never a synthetic integer.
- R4. Visual: "Effort heat" gradient using `--token-level-fill-low` → `--token-brand-primary` → `--token-level-fill-high`; `Faster` / `Smarter` end labels; the Brain reasoning identity stays purple (`Colors.purple`).
- R5. Non-reasoning config options (boolean / fast / general) keep their existing dropdown / toggle View, unchanged.
- R6. The new View lives in `@acepe/ui`, imports zero Tauri/stores/desktop runtime, and passes the import-boundary guard.
- R7. No new hot-state write and no UI value repair — `currentValue` updates only via the canonical round-trip.

## Scope Boundaries

- Not changing Rust: the `Effort` enum (`packages/desktop/src-tauri/src/cc_sdk/types/effort.rs`), `acp_set_config_option`, or the `session_config_selection` table. The value model and persistence are already correct and canonical.
- Not changing the canonical capability projection (`capability-projection.ts`, `capability-projection-reader.ts`) — config options are already canonical, read-only in the UI.
- Not changing which surfaces show reasoning, nor the `shouldHideReasoningOption` rule in `toolbar-config-options.ts` (models with a native effort picker still hide it — the slider inherits this automatically).
- Not building a theme-switchable second gradient ("Effort heat" only, per locked decision).
- Not redesigning non-reasoning config options.

### Deferred to Separate Tasks

- The desktop wrapper `packages/desktop/src/lib/acp/components/config-option-selector.svelte` (exported as `ConfigOptionSelector`) has **no render site** in the app (it appears to be legacy/dead; the live path is the `@acepe/ui` View consumed by `AgentInputComposerTrailingControls` / `AgentInputNewThreadOptions`). Confirming and removing it is a separate cleanup task, not part of this feature.
- Replacing the hardcoded name→rank table with provider `options[]`-order ranking (the "deepen, don't patch" alternative) — flag for `/document-review` to weigh; out of scope here unless review elevates it.

## Context & Research

### Relevant Code and Patterns

- **Shared effort ladder + bar math (already exists, partly unrendered):** `packages/ui/src/components/agent-panel/agent-input-config-option-selector-state.ts` — `getReasoningEffortRank()` (maps `minimal=1, low=2, medium=3, high=4, xhigh=5`, returns `0` for `max` → dropped), `getReasoningEffortRankedValues()`, `getReasoningEffortBarSegments()`, `getReasoningEffortBarPercent()`, `getReasoningEffortNextValue()`, `isReasoningConfigOption()`.
- **The View to modify:** `packages/ui/src/components/agent-panel/agent-input-config-option-selector.svelte` — for reasoning (non-boolean) it renders a `Selector` shell with a `Brain` trigger and a list of `AgentInputSelectorItemRow`. Boolean variant renders a toggle. The slider replaces the *list-of-rows* for the reasoning branch only.
- **Both reasoning surfaces route through that View:**
  - `packages/ui/src/components/agent-panel/agent-input-composer-trailing-controls.svelte` (line ~121) renders `AgentInputConfigOptionSelector` per `toolbarConfigOptions`.
  - `packages/ui/src/components/agent-panel/agent-input-new-thread-options.svelte` (line ~153) renders `AgentInputConfigOptionSelector` for `reasoningConfigOption`.
  - Host wiring: `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte` — `setupBarReasoningConfigOption` (line ~157), `composerTrailingConfigOptions` (line ~161), `handleConfigOptionChange` (line ~772) → `sessionStore.connection.setConfigOption(...)` (line ~787).
- **Canonical source of config options:** `packages/ui/.../capability-projection.ts` (`configOptions`), read via `capability-projection-reader.ts` — Rust-owned `SessionGraphCapabilities`.
- **Adjacent reusable primitive:** `packages/ui/src/components/segmented-progress/segmented-progress.svelte` — a `$derived` segment array (`current`/`total`); note its filled fill hardcodes `var(--success)`, so it is a *pattern reference* for the stepped track, not a drop-in for a multi-color gradient.
- **Theming tokens (verified in `packages/ui/src/lib/design-tokens.css`):** `--token-brand-primary: #d97757`; `--token-level-fill-low: var(--success)`; `--token-level-fill-high: var(--destructive)` (no `--token-level-fill-mid` — coral brand is the midpoint). Reasoning accent: `Colors.purple` (`packages/ui/src/lib/colors.ts`).
- **Existing tests to extend:** `packages/ui/src/components/agent-panel/agent-input-config-option-selector-state.test.ts` (has `"maps reasoning effort to segmented bar fill"`, `"cycles reasoning effort forward and wraps at maximum"`). Desktop: `config-option-selector-state.vitest.ts`, `toolbar-config-options.vitest.ts`.
- **Boundary enforcement:** `scripts/forbid-ui-package-imports.ts` + `packages/ui/src/__tests__/ui-package-boundary.test.ts`.

### Institutional Learnings

- `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md` — directly supports R3/R7: the provider/canonical layer owns the value and identity; the UI must not invent or repair it.
- `docs/solutions/architectural/canonical-projection-widening-2026-04-28.md` — supports widening the shared ladder upstream rather than patching downstream consumers.
- `docs/solutions/architectural/final-god-architecture-2026-04-25.md`, `god-architecture-verification-2026-04-25.md` — the GOD rules this plan was checked against.

### External References

- Reference affordance only (no external research needed; strong local patterns exist): Claude Code "Effort: Ultracode" popover slider — used purely as a visual/interaction reference, not a contract.

## Key Technical Decisions

- **Slider is a View, not a new authority.** It reads canonical `ConfigOptionData.currentValue` / `options[]` and emits the existing `onValueChange(configId, value: string)`. No optimistic local mutation; `currentValue` updates only when the canonical capability envelope returns. *(GOD condition.)*
- **One shared ladder.** Fix only `getReasoningEffortRank()` (`max` → 6). Do not fork a slider-local ranking. Dropdown bar, step-up cycle, and slider all consume the same definition, staying consistent automatically. *(GOD condition.)*
- **Single integration seam.** Swap the slider into the **reasoning branch of `agent-input-config-option-selector.svelte`** (inside the existing `Selector` popover, keeping the Brain trigger). Because both surfaces render this View, one change covers the in-session toolbar and the new-thread setup bar. No host (`agent-input-ui.svelte`) changes required for the swap itself.
- **Popover-hosted slider.** The compact Brain trigger stays; the popover content becomes the slider (matches the reference and fits the compact toolbar). Optional polish: render the existing (currently-unused) mini segmented bar beside the trigger to preview the current level.
- **Discrete snap.** The knob snaps to the N provider option values (`set_config_option` only accepts enum strings). Geometry math (value↔index↔position, snap-to-nearest) lives in a pure, tested `*-state.ts`; the `.svelte` View is thin.
- **Svelte 5, no `$effect`.** Drag/keyboard handled via pointer/keyboard event handlers writing a single `$state` index; all derived geometry via `$derived`. neverthrow for any fallible boundary; no `any`/`unknown`; no spread.
- **Token-driven theming.** Gradient from `--token-level-fill-low` → `--token-brand-primary` → `--token-level-fill-high`; knob `var(--foreground)`; auto light/dark via tokens. Polish per `make-interfaces-feel-better`: concentric radius (popover ⊃ track ⊃ knob), scale-on-press knob, interruptible CSS transitions, tabular-nums on any readout.

## Open Questions

### Resolved During Planning

- Replace vs. coexist? → **Replace** the reasoning dropdown View; keep dropdown for non-reasoning options. (User-locked.)
- 4 vs 5 levels? → **5, including `max`** (requires the rank-table fix). (User-locked.)
- Gradient identity? → **"Effort heat"** green→coral→red via existing level-fill tokens; Brain stays purple. (User-locked.)
- Which surfaces? → Both; covered by the single View change. (Verified via render-site trace.)
- Continuous vs snapped? → **Snapped** to provider option values.

### Deferred to Implementation

- Exact knob dimensions, dither block count, and tick spacing — tune during `acepe-dev-app-qa` DOM verification on real surfaces.
- Whether end-label copy (`Faster`/`Smarter`) is shared-UI literals or host-passed props — implementer's call within the UI-package copy rule; default to literals unless localization is needed.
- Whether to ship the optional trigger preview bar (Unit 6) now or defer — decide after the core slider lands and is QA'd.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
Canonical capabilities (Rust)  ──►  ConfigOptionData.currentValue / options[]
        │  (read-only)
        ▼
agent-input-config-option-selector.svelte  (View, reasoning branch)
        │   keep <Brain> trigger
        │   popover content: dropdown list ───► AgentInputEffortSlider
        ▼
AgentInputEffortSlider (new View)
        ├─ derives geometry from agent-input-effort-slider-state.ts
        │     getEffortSliderModel(configOption, currentValue) → { levels[], currentIndex, count }
        │     effortFractionFromIndex(i, count) / effortIndexFromFraction(f, count)  (snap)
        ├─ track: stepped "Effort heat" gradient (level-fill tokens)
        ├─ knob: drag (pointer) + arrows (keyboard), role="slider"
        └─ on change → onValueChange(provider string)
        ▼
onValueChange(configId, value) ─► handleConfigOptionChange (host)
        ─► setConfigOption ─► acp_set_config_option ─► session_config_selection
        ─► canonical envelope returns ─► currentValue updates ─► View re-derives
```

Shared by both surfaces because `AgentInputComposerTrailingControls` (toolbar) and `AgentInputNewThreadOptions` (setup bar) both render the same `AgentInputConfigOptionSelector`.

## Implementation Units

- [ ] **Unit 1: Widen the shared effort ladder to include `max`**

**Goal:** `getReasoningEffortRank()` ranks `max` so it stops being dropped; all shared consumers (bar, cycle, slider) see the full `low · medium · high · xhigh · max` ladder.

**Requirements:** R2, and the GOD "one ladder" condition.

**Dependencies:** None.

**Files:**
- Modify: `packages/ui/src/components/agent-panel/agent-input-config-option-selector-state.ts`
- Test: `packages/ui/src/components/agent-panel/agent-input-config-option-selector-state.test.ts`

**Approach:**
- Extend the rank map: `minimal=1, low=2, medium=3, high=4, xhigh=5, max=6`; keep `0` as the "unknown/filtered" sentinel. No other function changes — `getReasoningEffortRankedValues` / `getReasoningEffortBarSegments` / `getReasoningEffortNextValue` automatically include `max` once it ranks > 0.

**Execution note:** Characterization-first — capture the current "max dropped" behavior in a test before changing the rank table, then add the failing assertion that `max` is included.

**Patterns to follow:** Existing rank/bar tests in the same `.test.ts` (`"maps reasoning effort to segmented bar fill"`, `"cycles reasoning effort forward and wraps at maximum"`).

**Test scenarios:**
- Happy path: options `[low, medium, high, xhigh, max]`, current `max` → `getReasoningEffortBarSegments` returns `segmentCount: 5, filledSegmentCount: 5`; `getReasoningEffortBarPercent` = 100.
- Happy path: `getReasoningEffortRankedValues` includes `max` last; `getReasoningEffortNextValue` cycles `xhigh → max`, and `max → low` (wraps).
- Edge case: `minimal` present → ranked before `low`, still included.
- Edge case: unknown value (e.g. `"turbo"`) still ranks `0` and is filtered (sentinel preserved).
- Characterization (pre-change, then update): options including `max`, current `xhigh` → before fix `max` absent from ranked values; after fix present.

**Verification:** `bun test` for this file passes with `max` included across ranked values, segments, percent, and cycle; no regression in the boolean/fast/icon tests.

- [ ] **Unit 2: Pure slider geometry state**

**Goal:** A pure, fully-tested module that maps a reasoning `configOption` + `currentValue` to slider geometry and back, with snap-to-discrete.

**Requirements:** R2, R3.

**Dependencies:** Unit 1 (consumes the widened ranked values).

**Files:**
- Create: `packages/ui/src/components/agent-panel/agent-input-effort-slider-state.ts`
- Test: `packages/ui/src/components/agent-panel/agent-input-effort-slider-state.test.ts`

**Approach:**
- `getEffortSliderModel(configOption, currentValue) → { levels: { value: string; label: string }[]; currentIndex: number; count: number }` — `levels` built from `getReasoningEffortRankedValues` (single ladder) with labels from `configOption.options[].name`; `currentIndex` = index of `currentValue` in `levels` (or a defined fallback when absent).
- `effortFractionFromIndex(index, count) → number` in `[0,1]`; `effortIndexFromFraction(fraction, count) → number` snapped to nearest valid index and clamped.
- `valueAtIndex(model, index) → string` returns the exact provider string for `onValueChange`.
- No DOM, no Svelte — pure functions only.

**Execution note:** Test-first — geometry is the correctness core; write the table of (fraction → index) and (index → fraction) expectations before implementing.

**Patterns to follow:** Pure `*-state.ts` derivation style already used by `agent-input-config-option-selector-state.ts`.

**Test scenarios:**
- Happy path: 5-level model, `currentValue: "high"` → `currentIndex: 2`, `count: 5`.
- Happy path: `effortFractionFromIndex(0,5)=0`, `(4,5)=1`, midpoint indices evenly spaced.
- Snap: `effortIndexFromFraction(0.46, 5)` and `0.54` round to the nearest stop; values past the ends clamp to `0` / `count-1`.
- Edge case: 4-level model (no `max`) → `count: 4`, ends map correctly.
- Edge case: `currentValue` null or not in ladder → defined fallback index (document the choice; no throw).
- Round-trip: `valueAtIndex(model, effortIndexFromFraction(f, count))` returns a real provider string for all `f` in `[0,1]`.

**Verification:** `bun test` passes; no `any`/`unknown`; function signatures consumed cleanly by Unit 3.

- [ ] **Unit 3: `AgentInputEffortSlider` View component**

**Goal:** The presentational slider — stepped "Effort heat" gradient track, draggable + keyboard-operable knob, `Faster`/`Smarter` end labels — emitting the provider string on change.

**Requirements:** R3, R4, R6, R7.

**Dependencies:** Unit 2.

**Files:**
- Create: `packages/ui/src/components/agent-panel/agent-input-effort-slider.svelte`
- Test: `packages/ui/src/components/agent-panel/agent-input-effort-slider.svelte.vitest.ts`

**Approach:**
- Props: `configOption: AgentInputConfigOption`, `currentValue: string | null`, `onValueChange: (value: string) => void`, `disabled?: boolean`, optional `minLabel`/`maxLabel` (default `"Faster"`/`"Smarter"`).
- Single `$state` for the active index while dragging; everything else `$derived` from `getEffortSliderModel` + geometry helpers. **No `$effect`.**
- Interaction: pointer handlers on the track/knob compute `effortIndexFromFraction` from the pointer x; on settle, emit `onValueChange(valueAtIndex(...))` only when the value actually changes (mirror `shouldEmitConfigOptionValueChange`). Keyboard: `role="slider"`, `aria-valuemin/max/now/text`, Arrow Left/Down decrement, Right/Up increment.
- Theming: track gradient via `--token-level-fill-low` → `--token-brand-primary` → `--token-level-fill-high`; knob `var(--foreground)`; dim track beyond the knob for fill affordance. Polish per `make-interfaces-feel-better`: concentric radius, scale-on-press knob (`transform`), interruptible CSS transitions (`cubic-bezier(0.2,0,0,1)`), `tabular-nums` on any numeric readout. Honor `disabled`.
- Zero imports from Tauri/stores/desktop.

**Execution note:** Render-smoke + interaction-emit tests (props in, callback out); geometry correctness is already covered in Unit 2, so keep View tests behavioral-but-light.

**Patterns to follow:** `agent-input-config-option-selector.svelte` (prop shape, `$derived` usage), `segmented-progress.svelte` (`$derived` segment array). Svelte skills: `svelte-core-bestpractices`, `svelte-runes`.

**Test scenarios:**
- Happy path: renders N steps for a 5-level option; knob positioned at `currentValue`'s index; end labels present.
- Happy path: ArrowRight from `high` emits `onValueChange("xhigh")`; ArrowRight from `max` does not emit (already at max / no-op at clamp).
- Edge case: `disabled` → no emit on interaction; appropriate `aria-disabled`.
- Edge case: 4-level option renders 4 stops, no `max`.
- A11y: `role="slider"` with correct `aria-valuenow`/`aria-valuetext` reflecting the current level.
- Boundary: component imports only `@acepe/ui`-internal modules (asserted by the existing `ui-package-boundary.test.ts`; ensure no new desktop import sneaks in).

**Verification:** `bun test` green; `bun run check` clean; renders in isolation (the `packages/website` mock harness can render it with mock `configOption`).

- [ ] **Unit 4: Export the slider View and state**

**Goal:** Make `AgentInputEffortSlider` (and its state, if needed by consumers) importable from `@acepe/ui`.

**Requirements:** R6.

**Dependencies:** Units 2–3.

**Files:**
- Modify: `packages/ui/src/components/agent-panel/index.ts` (export `AgentInputEffortSlider`; export geometry helpers/types if a consumer needs them)
- Modify (if required for public surface): `packages/ui/src/index.ts`

**Approach:** Mirror the existing `AgentInputConfigOptionSelector` export (line ~30 of the agent-panel index). Internal-only helpers need not be re-exported from the root index.

**Test scenarios:** Test expectation: none — pure export wiring, covered by `bun run check` and by Unit 5's import resolving.

**Verification:** `bun run check` resolves the new import from `@acepe/ui` with no unused-export or type errors.

- [ ] **Unit 5: Swap the slider into the reasoning branch of the selector View**

**Goal:** For reasoning config options, render `AgentInputEffortSlider` as the popover content (keeping the Brain trigger) instead of the option-row list; non-reasoning options unchanged. Covers both surfaces.

**Requirements:** R1, R3, R5, R7.

**Dependencies:** Unit 4.

**Files:**
- Modify: `packages/ui/src/components/agent-panel/agent-input-config-option-selector.svelte`
- Test: `packages/ui/src/components/agent-panel/agent-input-config-option-selector.svelte.vitest.ts` (create if absent; otherwise extend the existing selector render test)

**Approach:**
- In the non-boolean branch, when `isReasoningConfigOption` (`selectorState.kind === "reasoning"`), render `AgentInputEffortSlider` inside the existing `Selector` popover, wiring `currentValue` and `onValueChange={(value) => handleSelect(value)}` (which already guards via `value !== currentValue` and calls `onValueChange(configOption.id, value)`). Keep the `Brain` trigger and tooltip.
- For `fast` / `default` / boolean options, keep the current dropdown / toggle rendering verbatim.
- Optional within this unit: render the existing `reasoningBar*` segmented preview beside the trigger (or defer to Unit 6).

**Execution note:** Add a failing render test asserting the reasoning branch renders the slider (not `AgentInputSelectorItemRow`) before wiring it.

**Patterns to follow:** The current branch structure in `agent-input-config-option-selector.svelte` (`{#if !isBooleanConfigOption}` → `Selector`); the `handleSelect` guard.

**Test scenarios:**
- Happy path: a `compactReasoning` option renders `AgentInputEffortSlider` in the popover; selecting a level invokes `onValueChange(configOption.id, "<level>")`.
- Regression: a `compactSpeed` (fast) option still renders the existing control; a boolean option still renders the toggle.
- Integration: emitting from the slider calls the same `onValueChange` contract the host already consumes (no signature change at the `AgentInputConfigOptionSelector` boundary).
- Edge case: reasoning option with only one ranked value (or none) degrades gracefully (slider disabled / hidden), no crash.

**Verification:** `bun test` green for the selector + state tests; `bun run check` clean; the `AgentInputConfigOptionSelector` public prop contract is unchanged so `AgentInputComposerTrailingControls` and `AgentInputNewThreadOptions` compile untouched.

- [ ] **Unit 6: (Optional) Compact trigger level-preview bar**

**Goal:** Show the current effort level on the closed Brain trigger using the already-computed `reasoningBarSegmentCount` / `reasoningBarFilledSegmentCount` (now including `max`), so users see the level without opening the popover.

**Requirements:** R4 (polish); advances at-a-glance reviewability.

**Dependencies:** Unit 1 (ladder), Unit 5 (trigger context).

**Files:**
- Modify: `packages/ui/src/components/agent-panel/agent-input-config-option-selector.svelte`
- Test: extend `agent-input-config-option-selector.svelte.vitest.ts`

**Approach:** Render a small `segmented-progress`-style indicator next to the `Brain` icon driven by the existing view-state fields. Token-driven; no new state.

**Test scenarios:**
- Happy path: trigger shows `filled === currentRank` segments for a mid-level value; full for `max`.
- Edge case: `currentValue` null → zero filled, no crash.

**Verification:** DOM verification (Unit 7) shows the preview reflecting the selected level on both surfaces.

- [ ] **Unit 7: Desktop integration verification + QA**

**Goal:** Prove the slider works end-to-end in the running app on both surfaces, including the canonical round-trip and persistence.

**Requirements:** R1, R3, R7 (observed, not just unit-tested).

**Dependencies:** Units 1–5 (6 if shipped).

**Files:**
- No source changes expected. If integration reveals a host-side gap (e.g. disabled-state plumbing), modify `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte` minimally and note it.

**Approach:** Invoke `acepe-dev-app-qa`; run `bun run qa doctor` → `bun run qa observe` → `bun run qa inspect --selector=<reasoning slider>` → `bun run qa screenshot`. Verify on the in-session composer toolbar **and** the new-thread setup bar. Confirm: changing the knob persists (value survives reopen / reflects after the canonical envelope), `max` is reachable, and the model-with-native-picker case still hides reasoning.

**Test scenarios:** Test expectation: none (manual/DOM verification gate) — but record the DOM-verified selectors and observed state transitions, per the project's "DOM-verify UI changes, never rely on screenshots" rule.

**Verification:** `bun run check` + `bun test` + `cargo clippy` (if any Rust touched — none expected) all clean; DOM inspection confirms the slider on both surfaces; selecting `max` round-trips and persists.

## System-Wide Impact

- **Interaction graph:** The slider re-uses `onValueChange(configId, value)` → `handleConfigOptionChange` → `setConfigOption`. No new callback or entry point. The `AgentInputConfigOptionSelector` prop contract is unchanged, so both render sites are untouched.
- **Error propagation:** Failures stay on the existing `setConfigOption` path (the controller's "optimistic update / rollback on error" is pre-existing and shared, not widened here). The slider adds no new error surface.
- **State lifecycle risks:** None new — no hot-state write, no parallel value store. The widened rank ladder affects the dropdown bar and step-up cycle too; covered by Unit 1 regression tests.
- **API surface parity:** Both reasoning surfaces are covered by the single View change. Non-reasoning options unaffected.
- **Integration coverage:** Unit 7 proves the cross-layer round-trip (UI → ACP → DB → canonical envelope → UI) that unit tests can't.
- **Unchanged invariants:** `Effort` enum, `acp_set_config_option`, `session_config_selection`, canonical capability projection, `toolbar-config-options.ts` filtering, and the `AgentInputConfigOptionSelector` public props all stay as-is.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Widening the rank table changes the dropdown bar / step-up cycle behavior (now includes `max`) | This is intended (R2). Unit 1 characterization tests capture before/after; the single shared definition keeps all consumers consistent. |
| Slider too wide for the compact in-session toolbar | Host the slider inside the existing popover (trigger unchanged); slider only appears on open. Verified in Unit 7 on the real toolbar. |
| Accidental hot-state write or UI value repair creeping in | Explicit GOD conditions in Key Technical Decisions; Unit 3 emits provider strings only; reviewer checks no optimistic mutation added. |
| `@acepe/ui` boundary violation (importing desktop/Tauri) | `ui-package-boundary.test.ts` + `forbid-ui-package-imports.ts` fail the build; Unit 3 test scenario asserts it. |
| `options[]` not ordered as expected from some provider | Ladder order comes from `getReasoningEffortRank` (deterministic), not raw `options[]` order, so ordering is stable regardless of provider order. (Options-order ranking remains a deferred alternative.) |
| Dead `ConfigOptionSelector` desktop wrapper causes confusion | Out of scope; flagged for separate cleanup so it isn't mistaken for the live path. |

## Documentation / Operational Notes

- No user-facing docs or migrations. If `CONTEXT.md` lacks a glossary entry for "reasoning effort" / "effort ladder", consider adding one (the vocabulary is now load-bearing across dropdown + slider).
- No feature flag needed; the change is a View swap behind the existing reasoning affordance.

## Sources & References

- GOD pre-flight: cleared with conditions (this session), carried into Key Technical Decisions.
- Related code: `packages/ui/src/components/agent-panel/agent-input-config-option-selector-state.ts`, `agent-input-config-option-selector.svelte`, `agent-input-composer-trailing-controls.svelte`, `agent-input-new-thread-options.svelte`; `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte`; `packages/desktop/src-tauri/src/cc_sdk/types/effort.rs`.
- Institutional learnings: `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md`, `docs/solutions/architectural/canonical-projection-widening-2026-04-28.md`.
- Reference affordance: Claude Code "Effort: Ultracode" slider (visual/interaction reference only).
