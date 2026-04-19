# External Session Visibility Toggle — Requirements

**Date:** 2026-04-19
**Status:** Ready for planning

## Problem

When a user adds a project in Acepe, the session list immediately fills with transcripts from external CLIs (Claude Code, Cursor, OpenCode, Codex) discovered on disk under `~/.claude/projects/<slug>/` and analogous directories. These were never created in Acepe, but they appear indistinguishably alongside Acepe-created sessions.

The schema already tracks the distinction via `is_acepe_managed` on `session_metadata`, but no read path filters on it.

## Goal

Give users per-project control over whether externally-discovered sessions appear in the session list, defaulting new projects to a clean Acepe-only view.

## In Scope

- Per-project boolean setting: **show external sessions** (off by default for new projects).
- Toggle UI in the **project settings panel**.
- Setting applies uniformly to all four external sources (Claude, Cursor, OpenCode, Codex) — single toggle, not per-agent.
- When off: hide **all** externally-discovered sessions for that project, regardless of timestamp.
- Existing projects (already in DB at the time of this change) preserve current behavior — default to **on**.

## Out of Scope

- Per-agent toggles.
- Watermark/timestamp-based partial filtering.
- Global (cross-project) preference.
- Deleting external session data from disk or DB — this is a visibility filter only.
- Changes to project discovery, worktree handling, or the `__session_registry__` / `__worktree__` sentinels.

## User-Facing Behavior

1. **Add a new project** → session list shows only sessions created in Acepe (empty for fresh projects).
2. **Open project settings** → "Show external CLI sessions" toggle, off by default for new projects.
3. **Toggle on** → external sessions from Claude/Cursor/OpenCode/Codex history dirs appear in the list, mixed with Acepe sessions, sorted as today.
4. **Toggle off again** → external sessions disappear from the list. Underlying data is untouched.
5. **Existing projects after upgrade** → toggle is on, list looks identical to before.

## Success Criteria

- New project added → session list does not contain entries with `is_acepe_managed = 0` until the user enables the toggle.
- Toggling does not require a re-scan or app restart; the list updates reactively.
- Existing projects open after upgrade with no visible change to their session list.
- All four external scanners are gated by the same setting.

## Open Questions

None — decisions captured above. Implementation choices (where the setting is persisted, whether filtering happens in SQL or post-query, store wiring) are deferred to `/ce:plan`.
