---
date: 2026-05-21
topic: agent-specific-modes
---

# Agent-Specific Modes

## Problem Frame

Acepe currently treats the composer mode as a global `Plan` / `Build` choice. That is too small for the product: each agent can expose different modes, and the UI should show the modes that belong to the selected agent.

The left composer dropdown should stop teaching users that all agents work through the same two phases. It should display the current agent's available modes, with labels and descriptions that make sense for that agent.

## Current Mode Facts

| Agent | Provider-native modes seen in the code | Current Acepe display |
| --- | --- | --- |
| Claude Code | `default`, `acceptEdits`, `bypassPermissions`, `plan` | `Build`, `Plan` |
| GitHub Copilot | ACP agent/autopilot URIs, ACP plan URI, legacy Copilot mode URIs | `Build`, `Plan` |
| Cursor | `agent`, `ask`, other provider-returned IDs | `Build` for `agent` / `ask` |
| OpenCode | Acepe currently supplies `build` and `plan` defaults around OpenCode sessions | `Build`, `Plan` |
| Codex | Acepe currently supplies `build` and `plan` defaults for native Codex sessions | `Build`, `Plan` |
| Custom / Forge | Provider-specific or fallback modes | Usually forced into `Build` / `Plan` fallback |

## Requirements

**Agent-Owned Mode Lists**
- R1. Acepe must treat modes as agent-owned capabilities, not as a fixed global `Plan` / `Build` enum.
- R2. The left composer dropdown must show the available modes for the selected agent/session.
- R3. The dropdown must use the label and description supplied by the provider when those are clear.
- R4. If a provider supplies a low-quality technical ID, Acepe may map it to a clearer agent-specific label, but must not collapse unrelated modes into `Build`.
- R5. Unknown custom-agent modes must still be visible, using a readable fallback label based on the mode ID.

**Per-Agent Presentation**
- R6. Claude Code modes should be presented with Claude-native meaning. For example, `default`/`acceptEdits` can be shown as an editing-capable Claude mode, while `plan` can remain a planning or read-only Claude mode if that is what Claude exposes.
- R7. Copilot modes should preserve the difference between agent/autopilot and plan modes instead of converting the user-facing choice into generic Acepe `Build`.
- R8. Cursor modes must stop mapping both `agent` and `ask` to the same visible mode. If Cursor exposes both, users should be able to choose between them.
- R9. Codex and OpenCode should not pretend to have `Plan` / `Build` if the provider does not really expose those concepts. If Acepe creates fallback modes for them, the labels must describe the real behavior.
- R10. Custom and future agents must not require code changes just to show their modes.

**Remove Plan / Build As App Concepts**
- R11. Shared UI components must stop hardcoding `PlanIcon` and `BuildIcon` as the only mode icons.
- R12. The composer mode selector, tab indicators, queue mode indicators, and model-default UI must use generic mode metadata instead of `plan` / `build` booleans.
- R13. Kanban must not group, color, or icon sessions around a generic planning/building concept.
- R14. Copy that says `Build`, `Building`, `Plan`, or `Planning` must be removed when it refers to the old global app mode.
- R15. Provider-specific plan artifacts, such as Claude `ExitPlanMode` approval cards or stored plan documents, may keep plan wording because they describe real agent output, not the global app mode.

**Preferences and Memory**
- R16. Default model preferences must support defaults by arbitrary mode ID per agent, not only `plan` and `build`.
- R17. Per-session model memory should continue to remember `sessionId -> modeId -> modelId`.
- R18. Existing saved `plan` / `build` preferences should be migrated or interpreted as mode IDs without losing user choices.

**Autonomous Behavior**
- R19. Autonomous support must be modeled per agent mode. It should not assume that the only autonomous-compatible mode is `build`.
- R20. If an agent has no autonomous-compatible mode, the UI should hide or disable the autonomous choice for that agent.

## Success Criteria

- A user selecting Claude Code, Copilot, Cursor, Codex, OpenCode, or a custom agent sees a mode dropdown that matches that agent's real capabilities.
- Cursor `ask` and `agent` no longer appear as the same mode.
- No shared UI component assumes there are only two modes.
- Kanban no longer uses generic plan/build language, icons, or grouping for sessions.
- Real provider plan objects still render correctly where they are actual agent artifacts.

## Scope Boundaries

- This does not remove plan documents, plan sidebars, or plan approval cards when they represent real provider output.
- This does not redesign model discovery.
- This does not require each provider to expose the same number of modes.
- This does not require new agent runtimes.

## Key Decisions

- Modes are provider capabilities: Acepe should preserve provider meaning at the Rust/provider boundary and pass canonical display metadata to the UI.
- `Plan` / `Build` should no longer be product-wide concepts: they can exist only as provider-specific labels when the provider really has those modes.
- The UI should degrade gracefully for unknown modes: showing a plain readable label is better than hiding the mode.

## Alternatives Considered

| Option | Description | Pros | Cons | Fit |
| --- | --- | --- | --- | --- |
| Keep global `Plan` / `Build` | Continue mapping every provider into two Acepe modes. | Smallest change. | Incorrect for agents with different mode systems. Hides real choices. | Poor |
| Show raw provider modes directly | Display provider mode IDs exactly as returned. | Preserves all choices. Low mapping risk. | Raw IDs and URIs can be confusing. | Useful fallback, not enough alone |
| Agent-specific mode metadata | Preserve each mode ID and attach per-agent label, description, icon, and autonomous support. | Correct, extensible, good UX. | Requires touching mode filters, selectors, preferences, and kanban. | Recommended |

## Dependencies / Assumptions

- The backend already has provider hooks for mode normalization, outbound mapping, visible mode IDs, and autonomous-supported mode IDs.
- The frontend already receives `availableModes` and `currentModeId`, but currently filters and presents them through the global `Build` / `Plan` model.

## Outstanding Questions

### Deferred to Planning
- [Affects R6-R10][Needs research] What exact labels and icons should each built-in agent use for its known native modes?
- [Affects R13][Technical] What should replace plan/build status in kanban: lifecycle state, attention state, provider mode, or no mode indicator?
- [Affects R16-R18][Technical] What is the safest shape for persisted default-model data so old preferences keep working?
- [Affects R19-R20][Technical] Should autonomous be a normal mode option, a separate toggle, or a provider-owned capability badge?

## Next Steps

-> /ce:plan for structured implementation planning
