---
date: 2026-04-09
topic: dismissable-tooltip
---

# Dismissable Tooltip

## Problem Frame

The layout dropdown has pill controls (View: Standard/Kanban, Grouping: Single/Project/Multi, Tab Bar toggle) with no explanation of what each option does. New users don't know what "Project" grouping means or how "Multi" differs from "Single." Once a user learns the options, they don't need to see the explanations again — but there's currently no mechanism to show contextual help that can be permanently dismissed.

This is a reusable pattern: any feature with non-obvious options benefits from one-time explanatory hints.

## Requirements

**Component**

- R1. A new `DismissableTooltip` component that wraps content in a tooltip showing explanatory text with a dismiss action
- R2. The component is presentational and lives in `packages/ui` — it accepts `dismissed` state and an `onDismiss` callback, with no runtime or store coupling
- R3. When not dismissed: hovering shows a tooltip with a title, a brief description, and a small "Got it" dismiss button
- R4. When dismissed: the tooltip no longer appears on hover for that element
- R5. The dismiss action is per-tooltip, identified by a stable string key (e.g., `"layout.view.standard"`)

**Persistence**

- R6. Dismissed tooltip keys are persisted across app restarts using the existing user settings mechanism (`tauriClient.settings`)
- R7. A lightweight store manages the set of dismissed keys in memory and syncs to disk — parent components (not DismissableTooltip itself) read from this store and pass `dismissed` state and `onDismiss` callbacks as props

**Layout Dropdown Integration**

- R8. Each layout pill option gets a dismissable tooltip explaining what it does:
  - Standard: "Default view with a single conversation panel"
  - Kanban: "Board view showing all agent sessions as columns"
  - Single: "One conversation at a time"
  - Project: "Group conversations by project"
  - Multi: "Multiple conversations side by side"
  - Tab Bar: "Show a tab bar for switching between conversations"
- R9. Tooltip content is concise — a short title and one sentence. No multi-paragraph explanations.

**Accessibility**

- R10. The tooltip is keyboard-accessible: focus on the wrapped element triggers it, Escape dismisses it, and the "Got it" button is reachable via Tab
- R11. Screen readers announce the tooltip content; the dismiss button has an appropriate aria-label

## Success Criteria

- New users can hover over any layout pill and immediately understand what it does
- A user who clicks "Got it" never sees that tooltip again, even after restarting
- The component is reusable for any future feature that needs dismissable hints (command palette, settings, etc.)

## Scope Boundaries

- No "reset all tips" UI — can be added later if needed
- No step-by-step guided tour or sequential onboarding flow
- No tooltip for the layout trigger button itself (the sliders icon) — only the options inside the dropdown
- The component does not own persistence logic — it delegates via props

## Key Decisions

- **Per-tooltip dismiss over global dismiss**: Users may understand some options but not others. Per-key granularity respects that.
- **Plain buttons over ToggleGroup**: The layout pills already use plain `<button>` elements (not Bits UI ToggleGroup), so the dismissable tooltip wraps these directly.
- **"Got it" button over "Don't show again" checkbox**: A single action is simpler. The act of dismissing is the intent — no need for a separate confirmation.
- **No tooltip after dismiss**: Once dismissed, the element has no tooltip at all. The pill label + icon is self-documenting enough. This avoids the complexity of "rich tooltip → simple tooltip" degradation.

## Dependencies / Assumptions

- The existing `tauriClient.settings.get/set` API supports storing a JSON array of dismissed keys (verified — it JSON-serializes arbitrary values)
- A new `UserSettingKey` will need to be added on the Rust side for the dismissed tooltips store

## Outstanding Questions

### Deferred to Planning

- [Affects R7][Technical] Should the store be a new standalone file (e.g., `dismissed-tips-store.svelte.ts`) or extend an existing preferences store?
- [Affects R1][Needs research] What's the best tooltip positioning strategy inside the dropdown to avoid clipping or overlapping the dropdown edges?

## Next Steps

-> Create a structured implementation plan in docs/plans/