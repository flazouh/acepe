---
date: 2026-06-28
topic: solid-sidebar-rebuild
---

# Solid Sidebar Rebuild (Collapsible Project/Session Tree)

## Problem Frame

The left sidebar today renders each project as a **floating card**: `AppSidebarProjectGroup`
(`packages/ui/src/components/app-layout/app-sidebar-project-group.svelte`) uses `opacity-50`,
rounded borders, `bg-card/75`, and a hover-to-reveal (`hover:opacity-100`) treatment. The result
reads as a loose stack of detached, semi-transparent cards rather than a coherent navigation
surface. Project actions hide behind hover and the whole row fades when not focused, which hurts
scannability and discoverability.

The user wants a **solid, persistent, VS Code / Cursor-style sidebar**: one continuous, full-opacity
project + session navigation tree with no opacity tricks and no floating-card styling. This is a
**structural rebuild** of the sidebar tree — the component tree and view layer are reorganized into a
solid collapsible tree, not a cosmetic restyle — while deliberately **reusing the existing state
seams** (collapse, sidebar-open, project-order) rather than re-owning state (see Key Decisions and
Scope Boundaries).

The rebuild is bounded to the **sidebar project/session tree**. The empty-state pickers, agent
selection/filtering, individual session-row internals, and the queue + footer behavior are
explicitly preserved (see Scope Boundaries).

## Requirements

**Structure & Visual Model**
- R1. Replace the floating-card project group with a **collapsible tree** (VS Code Explorer style):
  each project is a solid section-header row; its sessions nest, indented, directly beneath it; the
  whole thing reads as one continuous solid list with no inter-project card gaps.
- R2. Remove all opacity/floating treatment from project groups — no `opacity-50`, no
  hover-to-reveal-the-whole-card, no detached rounded card per project. Rows are full-opacity and
  solid at rest.
- R3. Clicking a project section header toggles collapse/expand of that project's sessions. The
  chevron/affordance is always visible on the header.
- R4. Collapsed/expanded state per project **persists** (carry forward the existing
  `collapsedProjectPaths` workspace state; do not regress it).
- R5. Do **not** introduce an active/selected-session highlight. Verified: the sidebar has no
  functioning selection state today — `SessionListItem.isActive` (which drives the `bg-accent/20`
  style in `packages/ui/src/components/app-layout/app-session-item.svelte`) is never set, and the
  `selectedSessionId` prop is never passed by the controller (`app-sidebar.svelte`), so it is always
  `null`. Clicking a session opens it; the tree shows no persistent selection. The rebuild preserves
  this behavior. (Adding a real selection model is a separate, out-of-scope decision — see Scope
  Boundaries.)

**Project Section Header**
- R6. The project header row is **always solid and full-opacity**. Project name + collapse chevron
  (and project color/icon) are always visible.
- R7. Per-project actions (new-session `+`, file browser, overflow menu) **appear on hover** of the
  header to keep rows clean; the active/focused project keeps its actions visible. The row itself
  never fades. (UX decision delegated to implementer; this is the chosen default.)
- R8. Preserve all existing project-header capabilities in the new header: new session for project,
  open file browser, color picker, custom icon set/reset, remove project, reorder, and the
  hide-external-CLI-sessions toggle. No capability regression.

**Sidebar-Level Chrome**
- R9. **Resizable width** — the user can drag the sidebar's right edge to resize it; the chosen
  width persists across sessions. (Replaces today's fixed 280px.)
- R10. **Collapse/hide toggle** — a first-class control to fully hide and re-show the sidebar; the
  hidden/shown state persists. (Promote the existing `sidebarOpen` flag to a real, discoverable
  control.)
- R11. **Preserve project drag-reorder** — dragging a project header to reposition it in the list
  must keep working in the new tree, with persisted order (today's
  `session-list-project-order.ts` behavior must survive the rebuild).

## Success Criteria

- The sidebar renders as one solid, continuous, full-opacity project/session tree — a screenshot
  shows no semi-transparent or detached cards.
- Projects collapse/expand on header click; collapse state survives an app reload.
- The user can resize the sidebar by dragging, hide/show it via a control, and reorder projects by
  drag — all three persist across reloads.
- All pre-existing project-header actions and session-row behaviors still work (no capability lost).
- Empty-state pickers, agent selection/filtering, session-row internals, and queue+footer behave
  exactly as before, reseated in the new layout.
- DOM verification via the QA CLI confirms the structure (not screenshots alone), per project QA
  rules.

## Scope Boundaries

- **Empty-state pickers** (`empty-states.svelte` project/agent/branch picker block in the main
  content area) — out of scope, left as-is.
- **Agent selection / filtering** — not touched; current behavior (including
  `agentPreferencesStore.filterItemsBySelectedAgents`) preserved.
- **Session row internals** — title, status, badges, context menu, etc. kept as-is; restyled only as
  needed to sit in the solid tree. The row itself is not redesigned.
- **Queue section + footer** — behavior preserved; reseated into the new solid layout, not
  redesigned.
- **Collapse-to-icon rail** (VS Code activity-bar style) — explicitly not in this rebuild; R10 is a
  full hide/show, not a rail.
- **Active/selected-session highlight** — out of scope (see R5). No selection state exists today;
  the rebuild does not add one. The dormant `isActive` / `selectedSessionId` wiring can be left as-is
  or removed as dead code during the rebuild, but no new selection behavior is built.
- **Session drag-reorder** — out of scope. Only project headers are draggable (R11); sessions keep
  their current ordering. Session reordering can be a later, separate feature.
- **State-ownership changes** — out of scope. The rebuild restructures the view/components only and
  reuses the existing state seams (collapse as a View-local set synced to workspace via callback;
  existing reorder plumbing). It does not move collapse/selection state into a new Model or Rust
  layer (see Key Decisions).
- This is a **display-layer / projection** rebuild. It must not change canonical session/transcript
  data ownership; it consumes canonical facts (see Dependencies / Assumptions).

## Key Decisions

- **Collapsible tree over single-active-project or flat list**: the user wants to see and navigate
  all projects and their sessions at once, with per-project collapse — the VS Code Explorer model,
  not the Cursor single-active-project model.
- **Solid header + hover actions over always-visible actions**: keeps rows clean and matches the
  VS Code/Cursor convention while staying fully solid at rest; chosen by the implementer per the
  user's "do as you feel is best UX" delegation.
- **Resizable + hideable, but no icon rail**: deliver the two highest-value "proper sidebar"
  affordances without the extra cost/complexity of a collapsed icon rail.
- **Preserve, don't redesign, adjacent surfaces**: the rebuild is deliberately scoped to the tree to
  avoid sprawl; everything the user marked out-of-scope is carried forward intact.
- **Restructure the view, keep the state model**: the "full structural rebuild" reworks the component
  tree and visuals into the solid collapsible tree, but deliberately keeps the existing state seams
  (collapse as a View-local `SvelteSet` synced to workspace via `onCollapsedProjectPathsChange`;
  `sidebarOpen`; existing project-order plumbing). Moving collapse/selection state into a Model or
  Rust layer was considered and rejected for this rebuild — lower risk, faster, and the current seams
  work. The `god-architecture-check` gate still runs (it may confirm no canonical change is needed).
- **No invented selection model**: there is no active/selected-session highlight today, and the
  rebuild does not add one — it would be net-new behavior the user did not request.
- **Projects-only drag**: only project headers reorder; session drag stays out to keep interaction
  and persistence scope small.

## Dependencies / Assumptions

- The new tree is a **projection of canonical, Rust-owned session/project data**; the rebuild is
  TypeScript/`@acepe/ui` display work and must consume canonical facts, not repair provider quirks.
  Planning should run the `god-architecture-check` gate before touching the session-list data path.
  **Escalation:** if the GOD gate finds that collapse state, sidebar width, or hide/show state must
  move upstream into Rust-owned canonical data to be correct, treat that as a scope expansion and
  re-confirm before implementing — do not patch it downstream.
- **Cross-package consumers of `AppSidebarProjectGroup`** (verified): besides
  `session-list-ui.svelte`, it is imported by `packages/ui/src/components/app-layout/index.ts`, the
  boundary test `packages/ui/src/__tests__/ui-package-boundary.test.ts`, and two website demos
  (`packages/website/src/lib/components/landing-single-demo.svelte`,
  `landing-by-project-demo.svelte`). Removing or restyling the floating card must update/audit these,
  or the website mocks will render the old floating-card look that R2 forbids.
- **Preserve virtualization** (verified): the current list renders through
  `packages/desktop/src/lib/acp/components/session-list/virtualized-session-list.svelte`. The solid
  collapsible tree must keep height-based virtualization so large workspaces (many projects ×
  sessions) stay performant; do not regress to an un-virtualized list.
- **Stale duplicate controller** (verified): two `app-sidebar.svelte` files exist —
  `packages/desktop/src/lib/components/main-app-view/components/sidebar/app-sidebar.svelte` (the
  active controller, imported by `main-app-view.svelte`) and
  `packages/desktop/src/lib/components/app-sidebar.svelte` (appears unused). Planning should confirm
  and remove the dead one rather than edit both.
- Current MVC seams exist and are reusable: View in `packages/ui/src/components/app-layout/`
  (`app-sidebar-layout.svelte`, `app-sidebar-project-group.svelte`), Controller in
  `packages/desktop/src/lib/components/main-app-view/components/sidebar/app-sidebar.svelte`, Model in
  `packages/desktop/src/lib/acp/components/session-list/`. New shared UI must follow the
  `@acepe/ui` MVC rules (invoke `extract-to-ui-package` before moving UI into the package).
- Persisted state hooks already exist and should be reused/extended rather than re-invented:
  `collapsedProjectPaths` (collapse), `sidebarOpen` (hide/show), and project `sortOrder` /
  `session-list-project-order.ts` (reorder). Sidebar width persistence is **assumed to need a new
  workspace preference** — to be verified during planning against `workspaceStore` (verified: no
  app-sidebar width pref exists today; the `SIDEBAR_WIDTH` constants under
  `packages/desktop/src/lib/components/ui/sidebar/` belong to a separate shadcn/bits-ui sidebar
  primitive and are not the app sidebar — do not conflate them).
- Active sidebar plans whose *capabilities* must survive (their card styling is superseded):
  `docs/plans/2026-04-13-001-feat-sidebar-project-management-plan.md`,
  `docs/plans/2026-04-14-001-feat-project-sidebar-reorder-plan.md`,
  `docs/plans/2026-04-14-002-feat-project-logo-auto-detection-plan.md`,
  `docs/plans/2026-04-17-002-feat-project-header-agent-picker-plan.md`.

## Outstanding Questions

### Deferred to Planning
- [Affects R9][Technical] Where does sidebar width persist — extend `workspaceStore` with a new
  preference, or is there an existing width/layout pref to reuse? Verify before implementing.
- [Affects R10][Technical] Where should the hide/show control live (top bar, sidebar edge, command)
  and what keybinding, if any? Confirm against existing top-bar/keybinding patterns.
- [Affects R1][Technical] Should nesting use an indent guide line and what density/row-height matches
  the existing session-row component (`app-session-item.svelte`)? Resolve during planning with the
  QA-driven design pass.
- [Affects R11][Technical] Confirm project drag-reorder still works cleanly with the collapsible tree
  (drag target = header row), reusing `session-list-project-order.ts`. (Session drag is decided
  out-of-scope — see Scope Boundaries.)
- [Affects R8][Technical] Verify each capability from the four cited active plans (new-session `+`,
  file browser, color picker, icon set/reset, remove project, reorder, agent-picker placement,
  hide-external-CLI toggle) has a smoke check in the rebuild's verification so none regress.

## Next Steps
-> Create a structured implementation plan in docs/plans/