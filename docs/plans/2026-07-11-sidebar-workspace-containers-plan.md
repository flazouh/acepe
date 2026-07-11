# Sidebar Workspace Containers Plan

## Goal

Make projects unmistakably separate in the main sidebar by rendering each project as a restrained workspace container. Preserve the current project/session hierarchy, collapse behavior, ordering, menus, and canonical session data.

## Design contract

- Each project is one full-width rounded surface with a subtle border and background contrast.
- The project header is the top band of that surface. It keeps the project badge, name, collapse affordance, create action, and overflow menu.
- Expanded session content is visually inset within the same surface.
- The active task remains stronger than the project surface, so project and task selection are not confused.
- Containers use spacing and shape for separation. Project color remains limited to the existing badge; color is not the only grouping signal.
- Collapsed projects remain compact and clearly clickable.
- Loading and scanning states use the same container shape.
- The container is exposed as an accessible named group using an explicit project-name prop. The existing header remains the keyboard-operable collapse control.
- Density is protected: container spacing stays compact, no project path is added, and the final QA state must include several adjacent projects.

## Architecture gate

- Authority surface: presentational UI.
- Existing project/session inputs remain read-only.
- No sorting, canonical status, transcript, activity, or provider behavior changes.
- `packages/ui` remains store- and Tauri-free.
- Desktop session-list code continues to own interaction wiring and supplies snippets to the presentational component.

## Files

- `packages/ui/src/components/app-layout/app-sidebar-project-group.svelte`
  - Add the workspace-container surface, an explicit project-name input for accessible naming, and stable DOM hooks for the surface, header region, and content region.
  - Keep the component dumb and snippet-driven.
- `packages/ui/src/components/app-layout/project-header.svelte`
  - Tune the header band only if needed for visual hierarchy inside the new surface.
- `packages/ui/src/components/app-layout/app-sidebar-project-group.svelte.vitest.ts`
  - Add behavior-focused DOM coverage for default and snippet-driven rendering.
- `packages/desktop/src/lib/acp/components/session-list/session-list-ui.svelte`
  - Pass the project name, add a stable collapse-control hook, and adjust group spacing/content inset only where the container composition requires it.
- `packages/desktop/src/lib/components/ui/skeleton/project-card-skeleton.svelte`
  - Match the final workspace-container surface, header band, and content inset for no-project loading and trailing scanning placeholders.

## TDD slices

1. Red: render a project group and assert a named project surface with `role="group"`, an accessible project name, a header region, and a content region.
2. Green: add the smallest presentational structure to satisfy the contract.
3. Red/green: prove custom header and child snippets still render inside the same surface without changing interaction ownership.
4. Red/green: prove collapsed content is absent according to existing desktop behavior and loading/scanning content remains inside the same project surface where a real project group exists. Keep the separate fallback skeleton visually aligned.

Tests must inspect rendered behavior and attributes, never source strings.

## Implementation

1. Give Claude Code ownership of the visual design and implementation within this contract.
2. Review its diff for Svelte 5 rules, dumb-component boundaries, accessible interaction, and preservation of existing user edits.
3. Keep styling restrained: no stacked-card shadows, no large per-project color fills, and no new motion beyond existing transitions.

## Verification

- Run the focused component test.
- Run `bun run check` in `packages/desktop`.
- Run relevant package tests.
- Run code review and resolve findings.
- In the real dev Tauri app, run:
  - `bun run qa doctor`
  - `bun run qa observe`
  - `bun run qa inspect --selector='[data-sidebar-project-surface]'`
  - `bun run qa click --selector='[data-sidebar-project-toggle]'` to collapse a project, inspect the corresponding named surface, click the same hook to expand it, and inspect again
  - `bun run qa screenshot`
- Use a state with several adjacent projects for the final screenshot. Confirm that each boundary is clear, long names remain readable, active-task emphasis is stronger than the container, and the number of visible task rows is not materially reduced by padding.
- Record the selector facts and screenshot path in the final report.

## Scope limits

- No project rail, global switcher, drag-and-drop behavior, new persistence, or project activity badges.
- No backend, canonical graph, session-store, or transcript changes.
- Do not modify or discard unrelated dirty-worktree changes.
