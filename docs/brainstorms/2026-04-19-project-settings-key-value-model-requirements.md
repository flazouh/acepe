---
date: 2026-04-19
topic: project-settings-key-value-model
---

# Project Settings Key/Value Model

## Problem

Acepe currently spreads project-scoped settings across multiple storage shapes:

- `projects.color` in SQLite
- `projects.show_external_cli_sessions` in SQLite
- worktree setup commands in `.acepe.json` / `acepe.config.json`

That makes it expensive to add new per-project behavior because every new setting has to invent its own persistence path, migration story, read API, and UI binding.

## Goal

Introduce one project-scoped settings model backed by:

- `project_id`
- `key`
- `value`

This becomes the extensible storage layer for project-specific behavior.

## In Scope

- New SQLite-backed `project_settings` storage keyed by project id + setting key.
- Typed keys for the first settings slice:
  - project color
  - show non-Acepe / external sessions
  - setup script
  - run script
- Migration of existing project-scoped values into the new table:
  - `projects.color`
  - `projects.show_external_cli_sessions`
  - setup commands currently loaded from project config files
- Keep current Acepe behavior working after the migration:
  - project colors still render everywhere they do today
  - external session visibility still filters session history
  - worktree setup still runs the configured setup script
- First settings UI for:
  - Setup Script
  - Run Script
  - Show external CLI sessions

## Out of Scope

- Full removal of legacy columns in the `projects` table in this slice.
- Runtime execution for `run_script` if Acepe does not yet have a stable launch hook for it.
- CLAUDE.md automation itself. This change should unblock that future work by giving it a project settings home.
- Global settings refactor.

## User-Facing Behavior

1. A project still has a stable color and external-session visibility preference after upgrade.
2. Existing setup commands continue to work after upgrade, but their source of truth is the new project settings store.
3. Users can edit per-project Setup Script, Run Script, and Show external CLI sessions from a project settings surface.
4. New project-scoped settings can be added later without adding new top-level project columns or new config files.

## Data Requirements

- The persisted key names must be stable and human-readable.
- Values may be raw strings or serialized JSON strings depending on setting type.
- A missing value must fall back safely:
  - color: existing project/default behavior
  - external sessions: preserve legacy visibility for migrated projects
  - setup script: no-op
  - run script: empty

## Initial Setting Keys

- `color`
- `show_non_acepe_sessions`
- `setup_script`
- `run_script`

## Success Criteria

- Acepe reads and writes the initial project-scoped settings through the new `project_settings` store.
- Existing project data is migrated without losing user-visible behavior.
- Worktree setup execution uses the migrated setup-script value instead of project JSON config.
- The first project settings UI ships with Setup Script, Run Script, and Show external CLI sessions.
- Adding a future project setting does not require a new column on `projects`.

## Open Questions

- Should `run_script` remain storage-only in this slice if there is no runtime hook yet?
  - Working decision for planning: yes, unless a clean existing execution seam is found during implementation.

## Next Step

- `/ce:plan`
