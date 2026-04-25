---
title: "feat: Allow users to pick a default agent"
type: feat
status: active
date: 2026-04-13
origin: docs/brainstorms/2026-04-13-default-agent-selection-requirements.md
---

# feat: Allow users to pick a default agent

## Overview

Add a `default_agent_id` user setting so users can choose which agent is pre-selected in the chat bubble and new session flows. The setting is controllable from both the agent selector dropdown (context action) and the Settings → Agents & Models page.

## Problem Frame

Users who primarily use one agent (e.g., Opencode) see a different agent pre-selected because the empty state falls back to list order or backend-owned `default_selection_rank`. There is no user-facing way to override this. (See origin: `docs/brainstorms/2026-04-13-default-agent-selection-requirements.md`)

## Requirements Trace

- R1. New `default_agent_id` user setting, persisted. Empty state and new session flows pre-select this agent.
- R2. If the default agent is unavailable (uninstalled/deselected), fall back to first selected agent silently.
- R3. Context action on agent selector items to "Set as default".
- R4. Visual indicator in the selector showing which agent is the current default.
- R5. "Default agent" control in Settings → Agents & Models.

## Scope Boundaries

- No per-project default agents — single global default
- `default_selection_rank` backend behavior unchanged — user preference overrides it client-side
- No drag-to-reorder for the agent list

## Context & Research

### Relevant Code and Patterns

- **Rust UserSettingKey enum**: `packages/desktop/src-tauri/src/storage/types.rs` — add `DefaultAgentId` variant with `"default_agent_id"` string
- **Agent preferences store**: `packages/desktop/src/lib/acp/store/agent-preferences-store.svelte.ts` — owns `selectedAgentIds`, will own `defaultAgentId`
- **Empty state resolution**: `packages/desktop/src/lib/components/main-app-view/components/content/logic/empty-state-send-state.ts` — `resolveEmptyStateAgentId` picks first available; needs default-aware logic
- **Kanban resolution**: `packages/desktop/src/lib/components/main-app-view/components/content/kanban-new-session-dialog-state.ts` — `resolveDefaultAgentId` picks first selected; needs same treatment
- **Agent selector**: `packages/desktop/src/lib/acp/components/agent-selector.svelte` — uses `Selector` + `DropdownMenu.Item`
- **Context menu component**: `packages/desktop/src/lib/components/ui/context-menu/` — full bits-ui ContextMenu available, used in file-tree-item
- **Settings page**: `packages/desktop/src/lib/components/settings-page/sections/agents-models-section.svelte` — per-agent cards with toggles and model dropdowns
- **Specta type generation**: `packages/desktop/src/lib/services/converted-session-types.ts` — auto-generated from Rust, includes `UserSettingKey` union

### Institutional Learnings

- Use `neverthrow` ResultAsync for all async operations (never try/catch)
- Explicitly enumerate properties (never spread)
- New UI components go in `@acepe/ui` as presentational with prop-based data
- Provider-agnostic architecture: no provider assumptions in domain layers

## Key Technical Decisions

- **User preference overrides backend rank**: `resolveEmptyStateAgentId` checks `defaultAgentId` first, then falls back to `default_selection_rank` via existing ordering, then first-available. This keeps the backend rank as the sensible default for users who never set a preference.
- **Hover action icon over right-click context menu for R3**: The agent selector items live inside an already-open `DropdownMenu`. Nesting a `ContextMenu` inside `DropdownMenu.Item` is fragile with bits-ui. Instead, a small star icon appears on hover next to each agent, clicking it sets that agent as default. This is more discoverable and follows the file-tree-item hover-action pattern.
- **Store owns the setting, not the selector**: `AgentPreferencesStore` manages `defaultAgentId` with get/set/persist. Both the agent selector and settings page read/write through the store.

## Open Questions

### Resolved During Planning

- **UX pattern for R3**: Hover-reveal star icon within the dropdown item — avoids nested context menu inside DropdownMenu, more discoverable.
- **Visual indicator for R4**: Filled star icon next to the default agent name. Unfilled/outline star on non-default agents (visible on hover). Matches the "favorite" idiom users expect.
- **Specta regeneration**: After adding the Rust enum variant, run `cargo build` to regenerate `converted-session-types.ts`. The existing CI pipeline handles this.

### Deferred to Implementation

- Exact icon component from Phosphor icons library (likely `Star` with `weight="fill"` for default, `weight="regular"` on hover for non-default)

## Implementation Units

- [ ] **Unit 1: Add Rust UserSettingKey variant**

**Goal:** Register `default_agent_id` as a valid setting key so the frontend can persist it.

**Requirements:** R1

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src-tauri/src/storage/types.rs`

**Approach:**
- Add `DefaultAgentId` variant to `UserSettingKey` enum
- Add `UserSettingKey::DefaultAgentId => "default_agent_id"` to the `as_str()` match
- Add `"default_agent_id"` to the existing test's key list

**Patterns to follow:**
- Existing variants like `SelectedAgentIds`, `GitTextGenerationAgent` in same file

**Test scenarios:**
- Happy path: `"default_agent_id"` deserializes to `UserSettingKey::DefaultAgentId` and round-trips through `as_str()`

**Verification:**
- `cargo build` succeeds and regenerates specta types
- `cargo test` passes including the key acceptance test

---

- [ ] **Unit 2: Add defaultAgentId to AgentPreferencesStore**

**Goal:** Store, load, and persist the user's default agent preference.

**Requirements:** R1, R2

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/agent-preferences-store.svelte.ts`
- Test: `packages/desktop/src/lib/acp/store/__tests__/agent-preferences-store.test.ts` (create if absent, or add to existing)

**Approach:**
- Add `DEFAULT_AGENT_ID_KEY: UserSettingKey = "default_agent_id"` constant
- Add `defaultAgentId = $state<string | null>(null)` to the store class
- Load it in `initialize()` alongside existing settings via `tauriClient.settings.get<string>`
- Add `setDefaultAgentId(agentId: string | null): ResultAsync<void, Error>` method that updates state and persists
- Validate that the agent ID is in `selectedAgentIds` before accepting; if not, silently set to `null` (R2 fallback)
- On `setSelectedAgentIds`, if the removed agent was the default, clear `defaultAgentId` automatically

**Patterns to follow:**
- `setSelectedAgentIds` and `completeOnboarding` in same file for persist pattern
- `SELECTED_AGENT_IDS_KEY` usage pattern

**Test scenarios:**
- Happy path: `setDefaultAgentId("opencode")` persists and reads back correctly
- Happy path: `defaultAgentId` loads from persisted settings on `initialize()`
- Edge case: `setDefaultAgentId("nonexistent-agent")` when agent not in `selectedAgentIds` → remains `null`
- Edge case: deselecting the default agent via `setSelectedAgentIds` clears `defaultAgentId`
- Edge case: `defaultAgentId` is `null` when never set (fresh install)

**Verification:**
- `bun test` passes for the new/updated test file
- `bun run check` passes

---

- [ ] **Unit 3: Wire default agent into empty state and kanban resolution**

**Goal:** All new-session entry points pre-select the user's default agent when available.

**Requirements:** R1, R2

**Dependencies:** Unit 2

**Files:**
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/logic/empty-state-send-state.ts`
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/kanban-new-session-dialog-state.ts`
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/empty-states.svelte`
- Modify: `packages/desktop/src/lib/components/main-app-view/components/content/kanban-view.svelte`
- Test: `packages/desktop/src/lib/components/main-app-view/components/content/logic/__tests__/empty-state-send-state.test.ts`

**Approach:**
- Add `defaultAgentId: string | null` to `resolveEmptyStateAgentId` options. Resolution order: (1) explicit `selectedAgentId` if still available, (2) `defaultAgentId` if in available list, (3) first available.
- Add `defaultAgentId: string | null` to `ResolveKanbanNewSessionDefaultsInput`. Same precedence: requested → default → first selected → first available.
- In `empty-states.svelte`, pass `agentPreferencesStore.defaultAgentId` to the resolution function.
- In `kanban-view.svelte`, same treatment.

**Patterns to follow:**
- Existing `resolveEmptyStateAgentId` structure in `empty-state-send-state.ts`
- `resolveDefaultAgentId` in `kanban-new-session-dialog-state.ts`

**Test scenarios:**
- Happy path: when `defaultAgentId` is set and available, it is returned as the effective agent
- Happy path: when `selectedAgentId` is explicitly set (user chose in current session), it wins over `defaultAgentId`
- Edge case: `defaultAgentId` set but not in `availableAgentIds` → falls back to first available
- Edge case: `defaultAgentId` is `null` → existing behavior (first available)
- Edge case: empty `availableAgentIds` → returns `null` regardless of default

**Verification:**
- `bun test` passes for updated test files
- Opening a new chat with a set default pre-selects that agent

---

- [ ] **Unit 4: Add "Set as default" action to agent selector**

**Goal:** Users can set their default agent directly from the agent selector dropdown.

**Requirements:** R3, R4

**Dependencies:** Unit 2

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-selector.svelte`

**Approach:**
- Import `getAgentPreferencesStore` and read `defaultAgentId` from it.
- For each `DropdownMenu.Item`: add a star icon button (Phosphor `Star`) on the right side.
  - If this agent is the default: filled star (`weight="fill"`, primary color), always visible.
  - If not: outline star (`weight="regular"`, muted), visible on hover via `group-hover:opacity-100` or on the item's `data-highlighted` state.
- Clicking the star calls `agentPreferencesStore.setDefaultAgentId(agent.id)`. Clicking the filled star on the current default clears it (`setDefaultAgentId(null)`).
- Clicking the agent name/row still selects it for the current session (existing behavior unchanged).

**Patterns to follow:**
- Hover-reveal action pattern from `file-tree-item.svelte` (group-hover opacity)
- `SelectorCheck` component pattern for showing/hiding per-item indicators
- `getAgentIcon` pattern for theming

**Test scenarios:**
- Test expectation: none — pure UI interaction on a dropdown item with no behavioral logic beyond calling store methods (covered by Unit 2 tests for persistence, Unit 3 tests for resolution)

**Verification:**
- Visual: star icon appears on hover, filled star on default agent
- Clicking star updates the default; clicking again clears it
- Agent name click still selects for current session

---

- [ ] **Unit 5: Add "Default agent" control to Settings page**

**Goal:** Users can view and change their default agent from Settings → Agents & Models.

**Requirements:** R5

**Dependencies:** Unit 2

**Files:**
- Modify: `packages/desktop/src/lib/components/settings-page/sections/agents-models-section.svelte`

**Approach:**
- Add a "Default agent" section above or below the agent list. Use a `DropdownMenu`-based selector showing only agents in `selectedAgentIds`.
- The dropdown displays the current default agent (icon + name), or "None" / "First available" when unset.
- Selecting an agent calls `agentPreferencesStore.setDefaultAgentId(agent.id)`.
- Include a "Clear" or "Auto" option to reset to `null` (first-available fallback).
- When an agent is toggled off and it was the default, the dropdown updates automatically (store handles this in Unit 2).

**Patterns to follow:**
- Model dropdown per agent in same file (existing `DropdownMenu.Root` pattern with icon + label)
- `AgentToolCard` header styling

**Test scenarios:**
- Test expectation: none — settings dropdown wiring to store methods, covered by Unit 2 store tests and Unit 3 resolution tests

**Verification:**
- Dropdown shows selected agents, current default is highlighted
- Changing default here is immediately reflected in the chat bubble agent selector
- Disabling the default agent auto-clears the dropdown

## System-Wide Impact

- **Interaction graph:** `AgentPreferencesStore.defaultAgentId` → read by `resolveEmptyStateAgentId` (empty state), `resolveDefaultAgentId` (kanban), agent selector (visual indicator), settings page (dropdown). Written by agent selector star action and settings dropdown.
- **Error propagation:** Invalid `defaultAgentId` (agent removed/deselected) silently falls back to `null`. No error toasts.
- **State lifecycle risks:** Race between `setSelectedAgentIds` removing an agent and `defaultAgentId` still pointing to it — Unit 2 clears the default when its agent is deselected, so no stale state.
- **API surface parity:** The kanban new-session dialog uses its own `resolveDefaultAgentId` (not the one in `agent-store.svelte.ts`). Both need updating.
- **Unchanged invariants:** `default_selection_rank` backend behavior is untouched. `getDefaultAgentId()` on `AgentStore` continues to use backend rank. Only the empty-state and kanban resolution functions gain the user preference override.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Specta type regeneration might not auto-run in worktree | Run `cargo build` explicitly after adding the Rust variant; verify `converted-session-types.ts` updates |
| Star icon in tight dropdown items could feel cramped | Use small 14px icon, only show on hover for non-default agents |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-13-default-agent-selection-requirements.md](docs/brainstorms/2026-04-13-default-agent-selection-requirements.md)
- Related: #101, PR #102
- Relevant code: `agent-preferences-store.svelte.ts`, `empty-state-send-state.ts`, `kanban-new-session-dialog-state.ts`, `agent-selector.svelte`, `agents-models-section.svelte`
