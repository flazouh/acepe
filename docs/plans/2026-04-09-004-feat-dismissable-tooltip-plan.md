---
title: "feat: Add dismissable tooltips to layout dropdown pills"
type: feat
status: completed
date: 2026-04-09
origin: docs/brainstorms/2026-04-09-dismissable-tooltip-requirements.md
---

# feat: Add dismissable tooltips to layout dropdown pills

## Overview

Add contextual explanatory tooltips to every layout dropdown pill (View, Grouping, Tab Bar) that can be permanently dismissed per-tooltip via a "Got it" button. The component is reusable for any future feature needing one-time hints.

## Problem Frame

The layout dropdown has pill controls (Standard/Kanban, Single/Project/Multi, Tab Bar toggle) with no explanation of what each option does. New users don't know what "Project" grouping means or how "Multi" differs from "Single." Once learned, explanations should disappear permanently (see origin: `docs/brainstorms/2026-04-09-dismissable-tooltip-requirements.md`).

## Requirements Trace

- R1. New `DismissableTooltip` component wrapping content with explanatory tooltip + dismiss action
- R2. Component is presentational in `packages/ui` — accepts `dismissed` boolean + `onDismiss` callback
- R3. When not dismissed: hover shows title, description, and "Got it" button
- R4. When dismissed: no tooltip appears at all
- R5. Per-tooltip dismiss by stable string key (e.g., `"layout.view.standard"`)
- R6. Dismissed keys persist across restarts via `tauriClient.settings`
- R7. Lightweight store manages dismissed keys in memory, syncs to disk; parents pass state as props
- R8. Each layout pill option gets a dismissable tooltip with the following copy:
  - Standard → title: "Standard View", description: "Default view with a single conversation panel"
  - Kanban → title: "Kanban View", description: "Board view showing all agent sessions as columns"
  - Single → title: "Single Mode", description: "One conversation at a time"
  - Project → title: "Project Grouping", description: "Group conversations by project"
  - Multi → title: "Multi Panel", description: "Multiple conversations side by side"
  - Tab Bar → title: "Tab Bar", description: "Show a tab bar for switching between conversations"
- R9. Tooltip content is title + one sentence — no multi-paragraph
- R10. Keyboard accessible: focus triggers tooltip, Escape closes the tooltip temporarily (does not persist dismissal), "Got it" reachable via Tab and is the sole action that permanently dismisses
- R11. Screen readers announce content; dismiss button has appropriate aria-label

## Scope Boundaries

- No "reset all tips" UI (see origin)
- No sequential onboarding tour
- No tooltip on the layout trigger button itself — only options inside the dropdown
- No "rich → simple" tooltip degradation — dismissed means gone entirely

## Context & Research

### Relevant Code and Patterns

- **Existing tooltip primitives**: `packages/desktop/src/lib/components/ui/tooltip/` — Bits UI wrappers. `tooltip-content.svelte` auto-wraps in Portal, defaults `side="top"`, styling: `bg-popover border border-border text-foreground rounded-md px-2 py-1.5 text-xs shadow-md`
- **Preference store pattern**: standalone `.svelte.ts` files with `$state` fields, `initialized` guard, `createXStore()`/`getXStore()` context. Load via `tauriClient.settings.get<T>(KEY)`, save via `.set(KEY, value).mapErr(...)`. Examples: `chat-preferences-store.svelte.ts`, `voice-settings-store.svelte.ts`
- **UserSettingKey**: Rust enum in `packages/desktop/src-tauri/src/storage/types.rs` with `#[serde(rename_all = "snake_case")]` PascalCase variants. TS mirror at `packages/desktop/src/lib/services/converted-session-types.ts` as string-literal union
- **packages/ui convention**: components at `packages/ui/src/components/<name>/`, re-exported from `packages/ui/src/index.ts`
- **Layout pills**: plain `<button role="radio">` elements inside `DropdownMenu.Content` in `packages/desktop/src/lib/components/top-bar/top-bar.svelte`

### Institutional Learnings

- Keep UI dumb; store/domain owns semantics (see `docs/solutions/logic-errors/operation-interaction-association-2026-04-07.md`)
- Persist provenance/identity fields explicitly; add round-trip tests (see `docs/solutions/logic-errors/worktree-session-restore-2026-03-27.md`)
- Shared UI must not infer provider policy from presentation (see `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md`)

### External References

Skipped — codebase has strong local patterns for all three layers (tooltip, store, settings).

## Key Technical Decisions

- **Standalone store file** over extending an existing preferences store: follows the established pattern where each concern gets its own file (`dismissed-tips-store.svelte.ts` alongside `voice-settings-store.svelte.ts` and `notification-preferences-store.svelte.ts`)
- **Set\<string\> in memory, string[] on disk**: dismissed keys are a set semantically, serialized as JSON array for `tauriClient.settings`
- **Popover primitive instead of Tooltip** for the dismissable hint: the app's global `TooltipProvider` uses `disableHoverableContent`, which prevents pointer interaction with tooltip content. Since the "Got it" button must be clickable, DismissableTooltip uses Bits UI Popover (or HoverCard) which natively supports interactive content. This also provides better keyboard focus management for the dismiss action
- **Default `side="right"`, per-control override**: pills in a vertical list use `side="right"` to avoid vertical overlap. The Tab Bar toggle row (at the bottom) can override to `side="top"` if right-side clipping occurs. Portal auto-wrapping prevents container clipping
- **Single open at a time**: only one dismissable hint may be open within the layout dropdown. Opening one closes any previously open hint. This prevents visual clutter from overlapping overlays
- **No `$effect`**: the store uses event-handler-driven saves (on dismiss), not reactive effect-based persistence
- **Accepted risk: no recovery path after dismiss** — once dismissed, a tooltip is gone permanently with no "reset all tips" UI. Pill labels + icons are self-documenting enough for v1. A reset option can be added later if users report confusion

## Open Questions

### Resolved During Planning

- **Store location**: `packages/desktop/src/lib/stores/dismissed-tips-store.svelte.ts` — non-ACP concern, goes alongside other app-wide preference stores
- **Tooltip positioning**: `side="right"` with Portal auto-wrapping — avoids clipping inside dropdown
- **UserSettingKey naming**: `DismissedTooltips` → serializes to `"dismissed_tooltips"` via serde rename_all

### Deferred to Implementation

- Exact tooltip offset tuning (`sideOffset`) — depends on visual testing inside the dropdown at runtime
- Whether the "Got it" button needs a brief delay before becoming focusable (accessibility polish — test with keyboard navigation)

## Implementation Units

- [ ] **Unit 1: Add UserSettingKey for dismissed tooltips**

**Goal:** Add the Rust enum variant and TS mirror so the store can persist dismissed keys.

**Requirements:** R6 (persistence infrastructure)

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src-tauri/src/storage/types.rs`
- Modify: `packages/desktop/src/lib/services/converted-session-types.ts`

**Approach:**
- Add `DismissedTooltips` variant to the `UserSettingKey` enum in Rust — serde will auto-rename to `"dismissed_tooltips"`
- Add matching `as_str()` arm returning `"dismissed_tooltips"`
- Add `"dismissed_tooltips"` to the TS string-literal union type `UserSettingKey`

**Patterns to follow:**
- Existing variants like `ReviewPreferFullscreen` → `"review_prefer_fullscreen"`
- The `as_str()` match arm pattern in the same file

**Test scenarios:**
- Happy path: Rust round-trip test — serialize `UserSettingKey::DismissedTooltips` to JSON string `"dismissed_tooltips"` and deserialize back

**Verification:**
- `cargo clippy` passes
- `bun run check` passes (TS mirror compiles)

---

- [ ] **Unit 2: Create dismissed-tips store**

**Goal:** A lightweight Svelte 5 store that manages the set of dismissed tooltip keys in memory and syncs to the Tauri settings backend.

**Requirements:** R5, R6, R7

**Dependencies:** Unit 1

**Files:**
- Create: `packages/desktop/src/lib/stores/dismissed-tips-store.svelte.ts`
- Modify: `packages/desktop/src/lib/components/main-app-view.svelte` (create + initialize store in ancestor context)
- Test: `packages/desktop/src/lib/stores/dismissed-tips-store.test.ts`

**Approach:**
- Class with `$state` fields: `dismissedKeys: Set<string>`, `initialized: boolean`
- `initialize()` loads from `tauriClient.settings.get<string[]>(UserSettingKey.DismissedTooltips)`, populates the Set
- `isDismissed(key: string): boolean` — checks Set membership
- `dismiss(key: string): void` — adds to Set, optimistic local update, then fire-and-forget persist via `tauriClient.settings.set(KEY, Array.from(set)).mapErr(...)` with warning log on failure
- `createDismissedTipsStore()` / `getDismissedTipsStore()` for Svelte context pattern
- Wire `createDismissedTipsStore()` in `main-app-view.svelte` (alongside existing store providers) and call `initialize()` so the store is available to `top-bar.svelte` via `getDismissedTipsStore()`
- No `$effect` — persistence is triggered by the `dismiss()` method call, not reactively

**Patterns to follow:**
- `packages/desktop/src/lib/acp/store/chat-preferences-store.svelte.ts` — optimistic local update + fire-and-forget `.mapErr(...)` persist pattern
- `packages/desktop/src/lib/stores/notification-preferences-store.svelte.ts` — standalone non-ACP store with initialization guard
- `packages/desktop/src/lib/stores/voice-settings-store.svelte.ts` — standalone store structure and context access pattern

**Test scenarios:**
- Happy path: `isDismissed` returns false for unknown key, true after `dismiss(key)` is called
- Happy path: `dismiss` calls settings.set with the key included in the array
- Edge case: `dismiss` with an already-dismissed key does not duplicate in the persisted array
- Happy path: `initialize` loads previously dismissed keys from settings and populates the Set
- Edge case: `initialize` handles null return (no prior dismissals) gracefully — empty Set
- Error path: settings.get failure during initialize leaves store with empty Set and logs warning

**Verification:**
- All store tests pass
- `bun run check` passes

---

- [ ] **Unit 3: Create DismissableTooltip component in packages/ui**

**Goal:** A presentational hint component that conditionally shows rich explanatory content with a "Got it" dismiss button, using Popover semantics for interactive content support.

**Requirements:** R1, R2, R3, R4, R9, R10, R11

**Dependencies:** None (presentational, no store dependency)

**Files:**
- Create: `packages/ui/src/components/dismissable-tooltip/dismissable-tooltip.svelte`
- Create: `packages/ui/src/components/dismissable-tooltip/index.ts`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/components/dismissable-tooltip/dismissable-tooltip.test.ts`

**Approach:**
- Props: `dismissed: boolean`, `onDismiss: () => void`, `title: string`, `description: string`, `side?: "top" | "right" | "bottom" | "left"` (default `"right"`), `sideOffset?: number`, `open?: boolean` (controlled open state for single-open-at-a-time)
- When `dismissed` is true: render only the children (slot), no popover wrapper
- When `dismissed` is false: wrap children in Bits UI `Popover.Root` / `Popover.Trigger` / `Popover.Content` (via Portal), triggered on hover/focus with `openDelay`
- Content layout: title (bold, text-xs), description (text-xs, muted), "Got it" button (text-xs, normal foreground contrast, right-aligned secondary action)
- "Got it" button: `onclick` calls `onDismiss`, has `aria-label="Dismiss this tip"`
- Content styling: `bg-popover border border-border text-foreground rounded-md px-2.5 py-2 text-xs shadow-md max-w-52`
- Keyboard contract: focus on trigger opens hint → Tab moves focus into content → activating "Got it" permanently dismisses and returns focus to trigger → Escape closes without dismissing and returns focus to trigger

**Patterns to follow:**
- `packages/desktop/src/lib/components/ui/popover/popover-content.svelte` — Portal wrapping, `sideOffset`, `cn()` usage
- `packages/ui/src/components/pill-button/index.ts` — component folder + re-export pattern

**Test scenarios:**
- Happy path: when `dismissed` is false, component renders popover trigger wrapper around children
- Happy path: popover content includes the title, description, and "Got it" button text
- Happy path: "Got it" button has `aria-label="Dismiss this tip"`
- Happy path: when `dismissed` is true, component renders only children with no popover wrapper
- Edge case: component renders children unchanged regardless of dismissed state (slot content is always visible)
- Integration: onDismiss callback is wired to the "Got it" button's onclick

**Verification:**
- Component tests pass
- `bun run check` passes
- Component is importable from `@acepe/ui`

---

- [ ] **Unit 4: Integrate dismissable tooltips into layout dropdown**

**Goal:** Wrap each layout pill button with DismissableTooltip, passing dismissed state from the store and tooltip content per R8.

**Requirements:** R8, R5

**Dependencies:** Unit 2, Unit 3

**Files:**
- Modify: `packages/desktop/src/lib/components/top-bar/top-bar.svelte`
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/kanban-layout.contract.test.ts`

**Approach:**
- Import `DismissableTooltip` from `@acepe/ui` and `getDismissedTipsStore` from the store
- Get store instance via `getDismissedTipsStore()`
- Define tooltip content map: object mapping stable keys to `{ title, description, side }` pairs per R8
- Manage single-open state: track `openHintKey` so only one DismissableTooltip is open at a time within the dropdown
- Wrap each pill `<button>` in `<DismissableTooltip dismissed={store.isDismissed(key)} onDismiss={() => store.dismiss(key)} title={...} description={...} side="right">`
- Wrap the Tab Bar toggle row with `side="top"` (bottom of dropdown, right-side may clip)
- Tooltip keys follow `layout.view.standard`, `layout.view.kanban`, `layout.grouping.single`, `layout.grouping.project`, `layout.grouping.multi`, `layout.tabbar` naming convention

**Patterns to follow:**
- Existing pill button structure in `top-bar.svelte` — wrap without changing button semantics or ARIA attributes
- Store context access pattern: `getDismissedTipsStore()` called at component level

**Test scenarios:**
- Happy path: contract test — top-bar.svelte imports DismissableTooltip from `@acepe/ui`
- Happy path: contract test — each tooltip key string (`layout.view.standard`, `layout.view.kanban`, `layout.grouping.single`, `layout.grouping.project`, `layout.grouping.multi`, `layout.tabbar`) appears in the file
- Happy path: contract test — tooltip descriptions from the R8 content map appear in the file
- Integration: each pill button is wrapped in a DismissableTooltip element

**Verification:**
- All contract tests pass (existing + new)
- `bun run check` passes
- Manual verification: hovering a pill shows the hint; clicking "Got it" hides it permanently; only one hint is open at a time; Tab Bar hint appears above (not clipped); each tooltip explains the user-visible outcome clearly enough that a new user could choose correctly

## System-Wide Impact

- **Interaction graph:** DismissableTooltip uses Popover (not Tooltip) to support interactive content — wraps pill buttons inside DropdownMenu. Popover uses Portal so it renders outside the dropdown DOM, avoiding z-index conflicts. The dropdown's own open/close state is independent of hint state. Only one hint is open at a time within the dropdown.
- **Error propagation:** Store save failures are logged but do not block UI — tooltips reappear on next launch if persistence failed (graceful degradation)
- **State lifecycle risks:** The dropdown may render before the store finishes initializing. The store defaults to `dismissed: false` (showing tooltips) until persisted dismissal state is loaded — safe default, no blocking required
- **API surface parity:** New `UserSettingKey::DismissedTooltips` variant is added to both Rust and TS — these must stay in sync
- **Integration coverage:** Contract tests verify wiring. Manual testing covers the tooltip-inside-dropdown positioning and dismiss persistence round-trip
- **Unchanged invariants:** The pill buttons' `role="radio"`, `aria-checked`, click handlers, and visual styling are unchanged. The DismissableTooltip wraps them without altering their semantics

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Popover Portal may z-index conflict with DropdownMenu Portal | Both use overlay z-index; popover renders on top of dropdown content. Test visually |
| Popover focus behavior may conflict with radio button focus inside dropdown | Defined keyboard contract: focus on trigger opens, Tab into content, Escape closes without dismiss. Test keyboard navigation |
| Store initialization race — dropdown renders before store loads | Default `dismissed: false` means hints show until store says otherwise — safe default |
| No recovery path after dismiss | Accepted for v1 — pill labels + icons are self-documenting. "Reset all tips" can be added later |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-09-dismissable-tooltip-requirements.md](docs/brainstorms/2026-04-09-dismissable-tooltip-requirements.md)
- Popover primitives: `packages/desktop/src/lib/components/ui/popover/`
- Tooltip primitives (styling reference): `packages/desktop/src/lib/components/ui/tooltip/`
- Store pattern: `packages/desktop/src/lib/stores/voice-settings-store.svelte.ts`
- UserSettingKey: `packages/desktop/src-tauri/src/storage/types.rs`
- Layout dropdown: `packages/desktop/src/lib/components/top-bar/top-bar.svelte`
