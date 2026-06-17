---
date: 2026-06-12
topic: composer-cursor-layout
---

# Composer Cursor Layout

## Problem Frame

Acepe's composer uses a two-row layout: contenteditable + send on top, mode/model/voice/config footer below. Cursor's composer consolidates into a single row with a `+` attach menu, an active mode pill, the input, and trailing model/mic controls.

This brainstorm defines a layout refactor that preserves existing composer behavior while adopting Cursor's density and discoverability patterns.

## Requirements

**Single-row primary bar**
- R1. Production desktop composer must render one primary control row: `[+] [active mode pill] [input] [model] [mic] [send]`.
- R2. The footer row (mode dropdown, autonomous, model-left, config, agent/project, metrics, checkpoint) must be removed from the primary composer chrome.
- R3. Attachment badges remain above the primary row when present.

**+ attach menu**
- R4. A `+` button opens a searchable popover titled "Add context, tools…".
- R5. Mode selection moves into the + menu with checkmarked rows (reuse agent-specific mode metadata).
- R6. Context actions: "Add file context" (same as typing `@`) and "Attach image" (existing image attachment path).
- R7. Skills/commands appear in a nested submenu sourced from the same data as the `/` slash dropdown.
- R8. Overflow section holds former footer controls: autonomous toggle, config option selectors, agent/project picker, checkpoint button, metrics chip.
- R9. `@` and `/` typing shortcuts must continue to work unchanged.

**Active mode pill**
- R10. When a mode is active and more than one mode exists, show a dismissible pill inline left of the input.
- R11. Dismiss (X) resets mode to the agent's default (first available mode in capability list).
- R12. Pill is hidden when only one mode is available.

**Trailing controls**
- R13. Model selector stays on the right side of the row.
- R14. Mic and voice model menu stay on the right; voice recording bar behavior unchanged.
- R15. Round send/stop button stays on the right (Acepe-specific; Enter semantics unchanged).

**Placeholder**
- R16. Placeholder may reflect active mode description when available; fallback: "Plan, @ for context, / for commands".

**Architecture**
- R17. New presentational components live in `@acepe/ui`; desktop controller wires existing handlers only.
- R18. No changes to canonical submit/stop/queue semantics or session capability resolution.

## Out of Scope

- MCP Servers submenu (no composer listing surface yet).
- Duplicate model picker inside + menu (right-side selector is sufficient).

## Success Criteria

- Composer renders as a single row matching Cursor density.
- Mode, context, skills, and overflow controls are reachable from + menu.
- All existing composer interaction tests pass.
- Pre-session agent/project selection remains reachable via + overflow.
- Visual QA confirms + menu, mode pill, model/mic/send cluster in dev app.
