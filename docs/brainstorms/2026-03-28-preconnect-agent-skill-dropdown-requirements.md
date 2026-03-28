---
date: 2026-03-28
topic: preconnect-agent-skill-dropdown
---

# Pre-Connection Agent Skill Dropdown

## Problem Frame
Today the `/` dropdown in the agent input is populated from live session capabilities, so skill suggestions only appear after a session has connected. This creates a dead zone for new or not-yet-connected sessions where the user has already picked an agent, but cannot discover or insert that agent's skills from the input. We want the app to parse each agent's on-disk skill files so pre-connection panels can still offer skill suggestions immediately.

## Requirements

**Pre-Connection Skill Source**
- R1. When a panel has a selected agent but no connected session capabilities yet, typing `/` must use that agent's on-disk skill definitions as the dropdown source.
- R2. The pre-connection dropdown must be scoped to the currently selected agent only; it must not mix in skills from other agents.
- R3. The pre-connection dropdown must show only parsed on-disk skills, with no additional built-in or fallback slash commands.

**Connected Session Behavior**
- R4. Once a session has connected and live slash command capabilities are available, the dropdown must use the existing connected-session command source instead of the on-disk pre-connection source.
- R5. The pre-connection source must not be merged with the connected-session command list.

**Startup and Availability**
- R6. The app must load the on-disk skills for supported agents during app startup so the first pre-connection `/` interaction can use locally available skill data without waiting for an on-demand scan.
- R7. The parsed skill data must remain available to panels that only have `selectedAgentId` and no session yet.

**No-Skills Behavior**
- R8. If the selected agent has no usable on-disk skills, typing `/` before connection must not open the slash dropdown.
- R9. Unusable skill files, including missing folders and parse failures, must not block the rest of that agent's valid skills from being available.

## Success Criteria
- A new panel with a selected agent and no session can type `/` and immediately see that agent's on-disk skills.
- Switching the selected agent before connecting changes the pre-connection skill suggestions to that agent's skills.
- After a session connects, the dropdown behavior matches the current live capabilities flow.
- Agents with no readable skills do not show an empty pre-connection dropdown.

## Scope Boundaries
- No change to how connected sessions receive or render live slash commands.
- No merging of on-disk skills with live commands.
- No requirement for file watching or live disk refresh after startup in this change.
- No requirement to surface plugin skills, library skills, or cross-agent skills in the pre-connection dropdown.

## Key Decisions
- Pre-connection source: Use on-disk skills only for panels without connected session capabilities.
- Connected source: Keep the existing live capabilities source once the session connects.
- Empty state handling: Hide the pre-connection dropdown when the selected agent has no usable skills.
- Freshness model: Load agent skills at app startup rather than scanning on demand.

## Dependencies / Assumptions
- The existing Rust skills service remains the source of truth for locating agent skill directories and parsing `SKILL.md` files.
- The selected agent ID in the panel maps to the same agent IDs used by the skills service.

## Outstanding Questions

### Deferred to Planning
- [Affects R6][Technical] Where the startup-loaded skill cache should live so pre-connection panels can read it without coupling agent input directly to Tauri command timing.
- [Affects R8][Technical] Whether the UI should suppress dropdown opening before render or allow open-then-immediate-close behavior in shared slash-dropdown logic.
- [Affects R9][Needs research] What level of logging or diagnostics is needed for parse failures so invalid skill files are debuggable without disrupting normal input behavior.

## Next Steps
-> /ce:plan for structured implementation planning
