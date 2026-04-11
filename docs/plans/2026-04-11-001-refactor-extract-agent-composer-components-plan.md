---
title: Extract Agent Composer Components to @acepe/ui
type: refactor
status: completed
date: 2026-04-11
---

# Extract Agent Composer Components to @acepe/ui

## Overview

Extract every visual component of the desktop agent panel composer into `@acepe/ui` as presentational components, then update the desktop to render through the shared components and wire the website demo to use them. No logic moves — voice state machines, message preparation, slash command parsing, file picker integration, and inline artefact DOM manipulation all stay in the desktop controller.

## Problem Frame

The website demo for the agent panel currently renders faked HTML elements (inline `<button>` tags, hand-written mock toolbars) that do not match the real desktop composer. Previous attempts at "hallucinated" reusable components (`ComposerEditor`, `ComposerSubmitButton`, etc.) have been deleted because they diverged from what the desktop actually uses.

The desktop's `agent-input-ui.svelte` is a 2254-line monolith that inlines the entire composer UI template. The visual rendering is tightly interwoven with behavioral logic. This makes it impossible to show a truthful composer in the website demo without duplicating the template — which would immediately drift from reality.

The fix: copy each visual component out of the desktop into `@acepe/ui`, turning it into a pure presentational component that accepts state via props. Then desktop uses the shared version (passing real state) and website uses it (passing mock state). The single source of truth for the composer view lives in `@acepe/ui`.

## Requirements Trace

- R1. Every visual piece of the desktop composer has a corresponding presentational component in `packages/ui/src/components/agent-panel/`.
- R2. Desktop `agent-input-ui.svelte` imports and renders the shared components instead of inlining templates.
- R3. Website `agent-panel-demo.svelte` renders the same shared components with mock data and visually matches the desktop.
- R4. No logic (state machines, message prep, DOM manipulation) moves to `@acepe/ui`. Only visual rendering.
- R5. All extracted components pass the existing architectural guard rails in `packages/ui/src/components/agent-panel/__tests__/agent-panel-architecture.test.ts` (no Tauri, store, paraglide, or service imports).
- R6. Desktop `bun run check` and `bun test` pass with no new regressions.
- R7. Website `bun run check` passes and the demo renders without SSR errors.

## Scope Boundaries

**In scope:**
- Visual extraction of every composer sub-component
- Desktop refactor to use shared components
- Website demo wiring

**Out of scope:**
- Refactoring the message preparation pipeline
- Refactoring voice state machine
- Changing composer UX or behavior
- Extracting other agent panel areas (header, body, footer) — covered in separate plans
- Moving i18n strings (labels stay in desktop, passed as props)
- Making website demo interactive (static render is sufficient)

## Context & Research

### Relevant Code and Patterns

**Desktop composer monolith:**
- `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte` (2254 lines) — the composer template lives in lines 1975-2254 inside `SharedAgentPanelComposer`'s `content` and `footer` snippets

**Desktop composer sub-components (already separate files):**
- `packages/desktop/src/lib/acp/components/agent-input/components/attachment-badge.svelte` → extract to `ArtefactBadge`
- `packages/desktop/src/lib/acp/components/agent-input/components/autonomous-toggle-button.svelte` → extract as-is
- `packages/desktop/src/lib/acp/components/agent-input/components/mic-button.svelte` → extract to `AgentInputMicButton`
- `packages/desktop/src/lib/acp/components/agent-input/components/pasted-text-overlay.svelte` → extract
- `packages/desktop/src/lib/acp/components/agent-input/components/voice-model-menu.svelte` → extract
- `packages/desktop/src/lib/acp/components/agent-input/components/voice-recording-overlay.svelte` → extract

**Desktop composer selectors (in parent dir):**
- `packages/desktop/src/lib/acp/components/mode-selector.svelte`
- `packages/desktop/src/lib/acp/components/model-selector.svelte`
- `packages/desktop/src/lib/acp/components/model-selector.metrics-chip.svelte`
- `packages/desktop/src/lib/acp/components/model-selector.content.svelte`
- `packages/desktop/src/lib/acp/components/model-selector.trigger.svelte`
- `packages/desktop/src/lib/acp/components/model-selector.favorite-star.svelte`
- `packages/desktop/src/lib/acp/components/model-selector.row.svelte`
- `packages/desktop/src/lib/acp/components/model-selector.mode-bar.svelte`
- `packages/desktop/src/lib/acp/components/config-option-selector.svelte`
- `packages/desktop/src/lib/acp/components/selector.svelte` (base selector primitive)
- `packages/desktop/src/lib/acp/components/selector-ui.svelte`

**Desktop dropdowns:**
- `packages/desktop/src/lib/acp/components/slash-command-dropdown/` (directory)
- `packages/desktop/src/lib/acp/components/file-picker/file-picker-dropdown.svelte`

**Already extracted (Phase 1 groundwork):**
- `packages/ui/src/components/agent-panel/agent-input-editor.svelte`
- `packages/ui/src/components/agent-panel/agent-input-toolbar.svelte`
- `packages/ui/src/components/agent-panel/agent-input-divider.svelte`

**Shell (already shared):**
- `packages/ui/src/components/agent-panel/agent-panel-composer.svelte` — the composer shell with `content` and `footer` snippets. Both desktop and website already use this.

**Pattern to follow:** Earlier MVC extractions for permission bar, review navigation, and PR button buttons (`packages/ui/src/components/agent-panel/permission-bar-icon.svelte`, `review-navigation.svelte`, `create-pr-button.svelte`). Each takes props, has no store access, and is used by both desktop and website demo.

### Institutional Learnings

- **SSR snippet name collision** (discovered in this session) — Svelte 5 snippet props shadow other names in the same scope. A `content?: Snippet` prop rendered inside a `{#snippet content()}` block causes infinite recursion during SSR. Fix: rename props (e.g., `contentSnippet`) or define the inner snippet with a different name. This is in `packages/ui/src/components/agent-panel/agent-panel-composer.svelte` already.
- **Scene layer recursion** — `AgentPanelScene` renders through `AgentPanelShell` directly, not through `AgentPanel` (which has a similar recursion bug). Never route scene snippets through wrapper components that re-pass them.
- **Architectural guard** — `packages/ui/src/components/agent-panel/__tests__/agent-panel-architecture.test.ts` blocks `@tauri-apps/*`, `$lib/store/*`, `$lib/paraglide/*`, `$lib/services/*`, `svelte-sonner` imports. All extractions must pass this test.
- **Labels as props** — `@acepe/ui` components cannot import paraglide. All user-facing strings must be optional props with English defaults.

### External References

Not needed. This is pure internal refactoring following patterns already established in this repo.

## Key Technical Decisions

- **Copy-first, not abstract-first.** Each shared component is a copy of the desktop's existing template with desktop-specific imports replaced by props or `@acepe/ui` equivalents. No API design from scratch. No new abstractions. This protects the "no hallucinations" invariant.

- **Rename file conventions when extracting to @acepe/ui.** Desktop files use freeform names (`mic-button.svelte`, `autonomous-toggle-button.svelte`). In `@acepe/ui` they should use the `agent-input-*` prefix (`agent-input-mic-button.svelte`, `agent-input-autonomous-toggle.svelte`) to match the existing `agent-input-editor.svelte` and `agent-input-toolbar.svelte` convention and group them in imports.

- **Desktop re-exports the shared versions under original names.** Rather than deleting the desktop sub-component files, make them thin re-exports (`export { default } from "@acepe/ui/agent-panel/agent-input-mic-button.svelte"`) OR delete them and update all call sites to import from `@acepe/ui`. Prefer the latter for clarity — one import source per component.

- **State machines stay in desktop.** `VoiceInputState`, `PreconnectionRemoteCommandsState`, slash command state, file picker state — all stay in `agent-input-ui.svelte`. The extracted components accept plain data (phase strings, open/closed booleans, option lists) as props.

- **Tooltips become titles.** Desktop uses `$lib/components/ui/tooltip` (shadcn-svelte) which depends on desktop-specific context. For the shared versions, use plain `title` attributes. Rich tooltip content (kbd hints) is dropped — the desktop can wrap the shared component in its tooltip if needed.

- **Icons: phosphor-svelte and tabler icons only.** Both are already @acepe/ui dependencies. No new icon libraries. Desktop-specific icon wrappers are recreated inline.

- **Snippet overrides for dropdowns.** Slash command and file picker dropdowns are overlays anchored to the editor. Extract them as presentational components that accept `isOpen`, `position`, `items`, and callback props. Desktop owns the positioning logic and passes it in.

- **Model selector complexity.** The desktop model selector has 8 sub-files (content, trigger, row, favorite-star, mode-bar, metrics-chip, plus the main file). Extract ALL of them as a unit to preserve the existing structure. The main `ModelSelector` becomes the public entry point.

- **Metrics chip is its own extraction.** `model-selector.metrics-chip.svelte` is rendered independently in the toolbar (not inside the selector dropdown). It's its own component.

- **Config option selector is its own extraction.** Reads `configOption` data which is domain-neutral — easy extraction.

- **Pasted text overlay is positioning-only.** It renders at a given anchor rect. Extract the visual, pass the anchor in as a prop.

## Open Questions

### Resolved During Planning

- **Q: Should selector components (mode, model, config) use `bits-ui` or a custom dropdown?** A: Use what the desktop already uses. They import `selector.svelte` which is the desktop base. That base may need to be extracted too, OR the shared versions can use `bits-ui` Popover directly (already a @acepe/ui dep). Check during Unit 3 execution.

- **Q: Where should i18n labels live after extraction?** A: Stay in desktop `agent-input-ui.svelte`. When the desktop instantiates a shared component, it passes the paraglide-resolved string as a prop. Shared component has English defaults.

- **Q: Do we extract `agent-input-ui.svelte` itself as a shared component?** A: No. It has too much logic. Keep it as the desktop controller. After extraction, its template becomes a thin assembly of shared components with real state wired via props.

### Deferred to Implementation

- Exact prop names for each component (will mirror existing desktop prop names when sensible).
- Whether `SlashCommandDropdown` needs its own state machine or can be fully stateless — depends on how deeply positioning is coupled to the editor caret.
- Whether `selector.svelte` (base primitive) needs extraction or can be replaced with `bits-ui` directly.
- Whether to promote `attachment-badge.svelte` as-is or rename to `artefact-badge.svelte` (desktop calls it `ArtefactBadge` in usage).

## Implementation Units

- [x] **Unit 1: Extract leaf visual components (no selectors, no dropdowns)**

**Goal:** Move the simplest self-contained visual components from desktop to `@acepe/ui`. Each is a pure presentational component with no state coupling.

**Requirements:** R1, R4, R5

**Dependencies:** None

**Files:**
- Create: `packages/ui/src/components/agent-panel/agent-input-artefact-badge.svelte`
- Create: `packages/ui/src/components/agent-panel/agent-input-autonomous-toggle.svelte`
- Create: `packages/ui/src/components/agent-panel/agent-input-mic-button.svelte`
- Create: `packages/ui/src/components/agent-panel/agent-input-voice-recording-overlay.svelte`
- Create: `packages/ui/src/components/agent-panel/agent-input-voice-model-menu.svelte`
- Create: `packages/ui/src/components/agent-panel/agent-input-pasted-text-overlay.svelte`
- Modify: `packages/ui/src/components/agent-panel/index.ts` (add exports)
- Modify: `packages/ui/src/index.ts` (re-export new components)

**Approach:**
- For each component, copy the template from the desktop source file into the new `@acepe/ui` file.
- Replace desktop-specific imports (`$lib/*`, paraglide, shadcn tooltip/button/spinner) with `@acepe/ui` equivalents or plain HTML.
- Convert all i18n labels to optional props with English defaults.
- Convert desktop state references (e.g., `voiceState.phase`) to plain props (e.g., `phase: "recording" | "idle" | ...`).
- For `agent-input-mic-button.svelte`: accept `phase`, `disabled`, `downloadPercent`, event callbacks. No `VoiceInputState` dep.
- For `agent-input-voice-recording-overlay.svelte`: accept `phase`, `meterLevels`, `errorMessage`. No state dep.
- For `agent-input-artefact-badge.svelte`: accept `label`, `kind`, `detail`, `onRemove`. No desktop attachment type dep.

**Patterns to follow:**
- `packages/ui/src/components/agent-panel/permission-bar-icon.svelte` — prop-driven icon component
- `packages/ui/src/components/agent-panel/create-pr-button.svelte` — button with typed props and callback
- `packages/ui/src/components/agent-panel/review-navigation.svelte` — stateless control bar

**Test scenarios:**
- Happy path: Each component renders without errors when instantiated in the scene test or a standalone mount test.
- Integration: `packages/ui/src/components/agent-panel/__tests__/agent-panel-architecture.test.ts` passes — no forbidden imports in any new file.
- Happy path: Export existence test verifies each component is reachable via `@acepe/ui/agent-panel` and `@acepe/ui` root barrel.

**Verification:**
- `cd packages/ui && bun test` passes 68+ tests (add export checks for the 6 new components).
- `cd packages/website && bun run check` exits 0.
- The 6 new files contain no imports matching `/\$lib\/(store|paraglide|services|utils\/tauri-client)/` or `@tauri-apps/`.

---

- [x] **Unit 2: Extract selector components as a group**

**Goal:** Move mode selector, model selector (and its 7 sub-files), metrics chip, and config option selector to `@acepe/ui`. These are grouped because they share the desktop `selector.svelte` base primitive.

**Requirements:** R1, R4, R5

**Dependencies:** Unit 1 (for type/pattern consistency, not hard dependency)

**Files:**
- Create: `packages/ui/src/components/agent-panel/agent-input-selector.svelte` (base dropdown primitive — extracted from desktop `selector.svelte`)
- Create: `packages/ui/src/components/agent-panel/agent-input-selector-ui.svelte` (from `selector-ui.svelte`)
- Create: `packages/ui/src/components/agent-panel/agent-input-mode-selector.svelte`
- Create: `packages/ui/src/components/agent-panel/agent-input-model-selector.svelte` (entry point)
- Create: `packages/ui/src/components/agent-panel/agent-input-model-selector-content.svelte`
- Create: `packages/ui/src/components/agent-panel/agent-input-model-selector-trigger.svelte`
- Create: `packages/ui/src/components/agent-panel/agent-input-model-selector-row.svelte`
- Create: `packages/ui/src/components/agent-panel/agent-input-model-selector-favorite-star.svelte`
- Create: `packages/ui/src/components/agent-panel/agent-input-model-selector-mode-bar.svelte`
- Create: `packages/ui/src/components/agent-panel/agent-input-model-selector-metrics-chip.svelte`
- Create: `packages/ui/src/components/agent-panel/agent-input-config-option-selector.svelte`
- Modify: `packages/ui/src/components/agent-panel/index.ts`
- Modify: `packages/ui/src/index.ts`

**Approach:**
- Start with the base `agent-input-selector.svelte` — this is the primitive that the other selectors depend on. Copy from desktop `selector.svelte`, strip store/tauri deps, accept items and callbacks as props.
- Then `agent-input-mode-selector.svelte` — simplest consumer of the base. Accepts `availableModes`, `currentModeId`, `onModeChange` as props.
- Then the `agent-input-model-selector-*.svelte` family. Preserve the desktop's internal structure (1 entry file + 7 sub-files) since it's already well-organized.
- The `metrics-chip` is the token counter shown in the toolbar right side. Accept `tokensUsed`, `tokensLimit`, `trend` as props. Desktop-specific data fetching (e.g., reading from session store) is handled upstream.
- `agent-input-config-option-selector.svelte`: accept `configOption` (already a serializable data type in desktop), `onValueChange`, `disabled`.
- Replace any `Skeleton` usage with a simple div (or extract `Skeleton` separately — check if it's already in `@acepe/ui`).

**Patterns to follow:**
- `packages/ui/src/components/dropdown-menu/*` — existing `@acepe/ui` dropdown primitives using `bits-ui`
- `packages/ui/src/components/selector/*` (if it exists) — or use `bits-ui Popover` directly

**Test scenarios:**
- Happy path: Each selector renders a closed trigger with the selected item label.
- Happy path: Clicking the trigger calls the open callback (verified via spy or mock callback).
- Integration: Architecture test passes — no forbidden imports.
- Edge case: Model selector with empty `availableModels` renders placeholder state.
- Edge case: Metrics chip with `tokensUsed === 0` renders zero state without errors.

**Verification:**
- `cd packages/ui && bun run check` (if check script exists) or `cd packages/desktop && bun run check` exits 0.
- Visual smoke test via the website demo: model selector displays "Claude Sonnet 4" and opens a dropdown with mock items.
- Architectural guard test still passes.

---

- [x] **Unit 3: Extract dropdowns (slash command, file picker)**

**Goal:** Move the `@` file picker and `/` slash command dropdowns to `@acepe/ui` as presentational overlays that accept anchor position and item lists as props.

**Requirements:** R1, R4, R5

**Dependencies:** None (independent of Units 1 and 2)

**Files:**
- Create: `packages/ui/src/components/agent-panel/agent-input-slash-command-dropdown.svelte`
- Create: `packages/ui/src/components/agent-panel/agent-input-file-picker-dropdown.svelte`
- Modify: `packages/ui/src/components/agent-panel/index.ts`
- Modify: `packages/ui/src/index.ts`

**Approach:**
- Read the desktop `slash-command-dropdown/` directory and identify the top-level file. Copy its template to `@acepe/ui`.
- The slash dropdown takes `commands: Array<{ id, label, description }>`, `isOpen: boolean`, `query: string`, `position: { top, left }`, `onSelect: (cmd) => void`, `onClose: () => void` as props.
- The file picker dropdown takes `files: Array<{ path, name, ... }>`, `isLoading: boolean`, `projectPath: string`, plus same open/query/position/select/close pattern.
- Both render floating panels at absolute positions. Do NOT compute anchor from caret — accept pre-computed `position` prop.
- Strip any bindable `this` patterns where possible — desktop couples via `bind:this={inputState.slashDropdownRef}` to call methods. Replace with explicit callbacks (`onHighlightNext`, `onHighlightPrev`, `onSelectHighlighted`). If the method-based pattern is essential, expose methods via `bind:this` on the shared component too.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/components/slash-command-dropdown/` — existing structure
- `packages/desktop/src/lib/acp/components/file-picker/file-picker-dropdown.svelte`
- `packages/ui/src/components/agent-panel/review-tab-strip.svelte` — example of list rendering with keyboard nav

**Test scenarios:**
- Happy path: Dropdown renders when `isOpen=true` with the supplied items.
- Happy path: Dropdown renders nothing when `isOpen=false`.
- Happy path: Clicking an item fires `onSelect` with the item data.
- Edge case: Empty items list renders an empty state (or nothing, matching desktop).
- Integration: Architecture test passes.

**Verification:**
- `bun run check` exits 0 in website and desktop.
- Architectural guard test passes.

---

- [x] **Unit 4: Refactor desktop `agent-input-ui.svelte` to use shared components**

**Goal:** Replace inline template usage and imports of desktop sub-components with imports from `@acepe/ui`. The desktop file shrinks as pure visual code moves out.

**Requirements:** R2, R4, R6

**Dependencies:** Units 1, 2, 3

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte` (main refactor)
- Delete: `packages/desktop/src/lib/acp/components/agent-input/components/attachment-badge.svelte`
- Delete: `packages/desktop/src/lib/acp/components/agent-input/components/autonomous-toggle-button.svelte`
- Delete: `packages/desktop/src/lib/acp/components/agent-input/components/mic-button.svelte`
- Delete: `packages/desktop/src/lib/acp/components/agent-input/components/voice-model-menu.svelte`
- Delete: `packages/desktop/src/lib/acp/components/agent-input/components/voice-recording-overlay.svelte`
- Delete: `packages/desktop/src/lib/acp/components/agent-input/components/pasted-text-overlay.svelte`
- Delete: `packages/desktop/src/lib/acp/components/mode-selector.svelte`
- Delete: `packages/desktop/src/lib/acp/components/model-selector.svelte` + 7 sub-files
- Delete: `packages/desktop/src/lib/acp/components/config-option-selector.svelte`
- Delete: `packages/desktop/src/lib/acp/components/selector.svelte`
- Delete: `packages/desktop/src/lib/acp/components/selector-ui.svelte`
- Delete (if no other consumers): `packages/desktop/src/lib/acp/components/slash-command-dropdown/` directory
- Delete (if no other consumers): `packages/desktop/src/lib/acp/components/file-picker/file-picker-dropdown.svelte`
- Modify: `packages/desktop/src/lib/acp/components/index.ts` (remove deleted exports)
- Modify: any other desktop file that imports the deleted components (search-wide rename)

**Approach:**
- Update all imports in `agent-input-ui.svelte` from desktop paths to `@acepe/ui/agent-panel`.
- Keep the logic (event handlers, state machines, derived values) unchanged.
- Pass the existing desktop values as props to the shared components.
- For each i18n label, resolve via paraglide and pass as a prop.
- For state-coupled interactions (e.g., `voiceState.phase`), derive the plain prop value at the call site.
- After each replacement, run `bun run check` in `packages/desktop` to catch type errors early.
- Search for all external usages of the deleted desktop sub-components (`grep -r "from.*mode-selector"`) and update them to import from `@acepe/ui`.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/components/tool-calls/permission-bar.svelte` — example of desktop file using shared components via props and callbacks

**Test scenarios:**
- Happy path: `bun run check` passes in both packages.
- Happy path: Existing desktop tests (2513+) still pass with same 9 pre-existing failures unchanged.
- Integration: Manual verification — open the desktop app, open a session, interact with the composer. The visual appearance should be unchanged. Mode selector, model selector, autonomous toggle, mic button, and slash command dropdown should all work.
- Edge case: Voice recording flow still triggers the `agent-input-voice-recording-overlay.svelte` with real waveform data.
- Edge case: File picker `@` trigger still opens with real file list.

**Verification:**
- `cd packages/desktop && bun run check` exits 0.
- `cd packages/desktop && bun test` shows 2513+ passing, 9 pre-existing failures (no NEW failures).
- Architectural guard test in `@acepe/ui` passes.
- Manual smoke test: run the desktop app, confirm the composer area renders and interacts correctly.

---

- [x] **Unit 5: Wire shared components into the website demo**

**Goal:** Update `packages/website/src/lib/components/agent-panel-demo.svelte` to use every extracted shared component with mock data, replacing the current inline `<button>` placeholders.

**Requirements:** R3, R7

**Dependencies:** Unit 1 (for leaf components), Unit 2 (for selectors and metrics chip). Unit 3 (dropdowns) is optional for the demo — the website can show the composer in its idle state without dropdowns open.

**Files:**
- Modify: `packages/website/src/lib/components/agent-panel-demo.svelte`

**Approach:**
- Replace the current `composerOverride` snippet that uses inline `<button>` elements with one that uses the new shared components.
- Render: `AgentInputEditor` + inside the toolbar slot: `AgentInputModeSelector`, `AgentInputAutonomousToggle`, `AgentInputModelSelector`, `AgentInputConfigOptionSelector` (optional), divider components between groups.
- Right-side trailing: `AgentInputModelSelectorMetricsChip` with mock tokens.
- Mock data: `availableModes: [{ id: "plan" }, { id: "build" }]`, `availableModels: [{ id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" }]`, `currentModelId: "claude-sonnet-4.5"`, etc.
- All callbacks are no-ops (`() => {}`).
- Verify visually that the demo composer matches the desktop screenshot: pill input with submit button, toolbar row with 4 icons on left and token chip on right.

**Patterns to follow:**
- Current `packages/website/src/lib/components/agent-panel-demo.svelte` (Phase 1 groundwork) — already uses `AgentInputEditor`, `AgentInputToolbar`, `AgentInputDivider`.

**Test scenarios:**
- Happy path: Website dev server renders the Agent Panel tab without errors.
- Happy path: The composer visually matches the desktop screenshot structure: pill input, round submit button top-right, toolbar with wrench/mic/robot/model icons on left, token counter on right.
- Integration: Click the Agent Panel tab, confirm no 500 errors, no console errors.

**Verification:**
- `cd packages/website && bun run check` exits 0.
- Visual verification via Playwright screenshot: screenshot of the agent panel tab matches the intended desktop composer layout.
- No console errors when navigating to the page.

---

- [x] **Unit 6: Final integration verification**

**Goal:** Confirm the full migration achieves its intent: desktop still works, website demo matches desktop, no regressions, architectural guards pass.

**Requirements:** R5, R6, R7

**Dependencies:** Units 1-5

**Files:**
- None to modify. This is a verification unit.

**Approach:**
- Run `bun run check` in `packages/desktop`, `packages/website`, and `packages/ui` (if exists).
- Run `bun test` in `packages/desktop` and `packages/ui`. Confirm no new failures beyond the 9 pre-existing ones.
- Take a Playwright screenshot of the website agent panel tab and compare visually against a desktop screenshot. Both should show a pill composer with identical toolbar structure.
- Grep for any leftover references to deleted files in the desktop codebase: `grep -r "agent-input/components" packages/desktop/src`, `grep -r "mode-selector.svelte" packages/desktop/src`, etc.
- Verify `packages/ui/src/components/agent-panel/__tests__/agent-panel-architecture.test.ts` passes with all new components.

**Test scenarios:**
- Happy path: All test suites pass with expected counts.
- Happy path: Architecture test passes with 6+ new components checked.
- Integration: Playwright screenshot of website demo matches the intent visually.
- Integration: Grep returns zero results for references to deleted desktop composer files.

**Verification:**
- All typecheck and test commands exit 0 (or match pre-existing baselines).
- Visual parity confirmed via screenshot.
- No orphaned imports or dead code.

## System-Wide Impact

- **Interaction graph:** The desktop `agent-input-ui.svelte` is the only controller. All 14+ extracted components are used from there. No other desktop files consume the deleted sub-components unless discovered during Unit 4 — search is part of that unit.
- **Error propagation:** No new error paths. Visual rendering errors manifest as SSR crashes (caught in website `bun run check`) or runtime errors (caught in desktop `bun test`).
- **State lifecycle risks:** None — logic is not moving. Every state machine stays where it is.
- **API surface parity:** `@acepe/ui/agent-panel` barrel export grows by ~14 components. No existing exports change.
- **Integration coverage:** Desktop smoke test (manual) verifies voice recording, slash command, file picker, and model selector flows still work end-to-end. These are the integration scenarios unit tests alone cannot prove.
- **Unchanged invariants:**
  - `AgentPanelComposer` shell API stays identical.
  - `AgentPanelScene` API stays identical.
  - Desktop voice/slash/file picker behavior is unchanged.
  - No paraglide strings move to `@acepe/ui`.
  - No Tauri imports enter `@acepe/ui`.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| SSR snippet name collision in extracted components (same bug we already hit twice) | Every extraction uses the naming convention that avoids it: rename snippet props that are passed through to avoid shadowing. Test each component via `bun run check` in the website package after extraction. |
| Model selector has 8 files; extraction order matters | Extract them all in Unit 2 as a single commit. Start with the root entry, work down. If a sub-file depends on another, extract that dep first. |
| Desktop `selector.svelte` base primitive may be used by other desktop components besides the composer | Search `grep -r "from.*selector\.svelte"` across the desktop codebase in Unit 2. If other consumers exist, either extract all of them or keep the base local and duplicate only the selector variants we need. |
| Slash command and file picker use `bind:this` to expose imperative methods | Keep the same pattern in shared components. Document it explicitly in Unit 3 approach. |
| Refactoring `agent-input-ui.svelte` (2254 lines) may break subtle interactions | Unit 4 runs `bun run check` and `bun test` after each import swap. Smoke test the desktop app before marking Unit 4 complete. |
| Website demo rendering hits SSR recursion bugs in new components | Website typecheck uses svelte-check which catches these statically. Navigate with Playwright after each new component to confirm no 500. |
| Architectural guard test rejects components with forbidden imports | Each new component is reviewed against the forbidden list before being committed. If a dep is needed, the dep file is extracted too (e.g., `Skeleton` if used). |
| External consumers of deleted desktop files break | Unit 4 grep step catches this. If found, update those files to import from `@acepe/ui` too. |

## Documentation / Operational Notes

- Update `CLAUDE.md` Agent Panel MVC Separation table to mention that composer sub-components now live in `@acepe/ui`.
- The migration is complete after all 6 units land. No feature flag, no rollout — it's a pure refactor that produces identical visual output.

## Sources & References

- **Origin feature request:** User conversation describing the need to extract composer to make website demo truthful.
- Desktop composer: `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte`
- Desktop composer sub-components: `packages/desktop/src/lib/acp/components/agent-input/components/`
- Desktop selectors: `packages/desktop/src/lib/acp/components/{mode,model,config-option}-selector*.svelte`
- Shared shell: `packages/ui/src/components/agent-panel/agent-panel-composer.svelte`
- Already extracted groundwork: `packages/ui/src/components/agent-panel/agent-input-{editor,toolbar,divider}.svelte`
- Pattern reference: `packages/ui/src/components/agent-panel/{permission-bar-icon,review-navigation,create-pr-button}.svelte`
- Architectural guard: `packages/ui/src/components/agent-panel/__tests__/agent-panel-architecture.test.ts`
- Website demo: `packages/website/src/lib/components/agent-panel-demo.svelte`
