# Attestation — session-list project card (implemented)

## UI extraction attestation

**Component:** Sidebar project card (session list group)
**Pattern:** layout-shell + leaf widgets
**Status:** Implemented

| Concern | Layer | File |
|---------|-------|------|
| Card shell | View | `packages/ui/src/components/app-layout/app-sidebar-project-group.svelte` |
| Project header row | View | `packages/ui/src/components/app-layout/project-header.svelte` |
| Overflow menu | View | `packages/ui/src/components/app-layout/project-header-overflow-menu.svelte` |
| Menu derivations | View helper | `packages/ui/src/components/app-layout/project-menu-state.ts` |
| Color palette | View helper | `packages/ui/src/components/app-layout/project-color-options.ts` |
| Session list body | Controller snippet | `session-list-ui.svelte` → `children` snippet |
| Git overview / branch picker | Controller snippet | `session-list-ui.svelte` → `footer` snippet |
| Store reads, Tauri, session actions | Controller | `session-list-ui.svelte` |

## Verification

- [x] `cd packages/ui && bun test`
- [x] `cd packages/desktop && bun run check`
- [x] Session-list logic tests
- [ ] `acepe-dev-app-qa` — sidebar project card visible (requires running dev app)

**Fixture updated:** Website demos already use `AppSidebarProjectGroup`; card chrome now matches desktop production styling.
