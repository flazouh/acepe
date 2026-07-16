---
date: 2026-04-13
topic: default-agent-selection
---

# Default Agent Selection

## Problem Frame

Users who work primarily with one agent (e.g., Opencode) have no way to make it the default in the chat bubble. The empty state always pre-selects the first agent in the list, which is determined by backend ordering — not user preference. This is a minor but recurring friction for anyone whose preferred agent isn't first.

Related: issue #101 (partially addressed by PR #102 which filters inactive agents).

## Requirements

**User setting**
- R1. A new `default_agent_id` user setting persisted via the existing settings store. When set, the empty state and new session flows pre-select this agent instead of falling back to list order.
- R2. If the default agent is no longer available (uninstalled, deselected), fall back to the first selected agent silently — no error toast or broken state.

**Agent selector (chat bubble)**
- R3. Right-click (or equivalent context action) on an agent in the agent selector dropdown reveals a "Set as default" option.
- R4. The current default agent has a subtle visual indicator in the selector (e.g., a small star or "default" badge) so the user knows which one is set.

**Settings page**
- R5. The Agents & Models settings section shows a "Default agent" control (dropdown or equivalent) reflecting and controlling the same `default_agent_id` setting.

## Success Criteria

- Opening a new chat pre-selects the user's chosen default agent
- Changing the default from either surface (selector or settings) is reflected immediately in both
- Removing or disabling the default agent degrades gracefully to first-available

## Scope Boundaries

- Not adding per-project default agents — single global default is sufficient
- Not changing `default_selection_rank` backend behavior — user preference overrides it client-side
- Not adding drag-to-reorder for the full agent list

## Key Decisions

- **Both surfaces**: Default is settable from the agent selector context menu AND the settings page, sharing one underlying setting.
- **User preference overrides backend rank**: `default_agent_id` takes precedence over `default_selection_rank` when set. Backend rank remains the fallback for users who never set a preference.

## Dependencies / Assumptions

- The existing `UserSettingKey` system supports adding a new string key (verified — same pattern as `selected_agent_ids`, `agent_default_models`, etc.)

## Outstanding Questions

### Deferred to Planning

- [Affects R3][Technical] Best UX pattern for the context action — right-click menu, long-press, or hover action icon? Depends on what the Selector component already supports.
- [Affects R4][Technical] Visual indicator style for the default agent — needs to fit the existing agent selector design.

## Next Steps

-> Create a structured implementation plan in docs/plans/