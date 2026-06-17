# Pattern catalog — UI package MVC extraction

Four canonical shapes. Pick one before extracting.

## 1. Leaf widget

**When:** Single presentational unit; props carry all display state.

| Layer | File |
|-------|------|
| View | [`packages/ui/src/components/agent-panel/agent-tool-read.svelte`](../../../../packages/ui/src/components/agent-panel/agent-tool-read.svelte) |
| View helpers (optional) | [`agent-tool-read-state.ts`](../../../../packages/ui/src/components/agent-panel/agent-tool-read-state.ts), [`agent-tool-read-effects.ts`](../../../../packages/ui/src/components/agent-panel/agent-tool-read-effects.ts) |
| Model | — (props sufficient) |
| Controller | Consumed by agent-panel content runtime |

**Extra step:** Pass English copy as props; no paraglide in View.

---

## 2. Smart wrapper

**When:** Desktop domain types must map to view props.

| Layer | File |
|-------|------|
| View | [`packages/ui/src/components/checkpoint/checkpoint-card.svelte`](../../../../packages/ui/src/components/checkpoint/checkpoint-card.svelte) |
| Model | [`packages/desktop/src/lib/acp/components/checkpoint/checkpoint-card-state.ts`](../../../../packages/desktop/src/lib/acp/components/checkpoint/checkpoint-card-state.ts) |
| Controller | [`packages/desktop/src/lib/acp/components/checkpoint/checkpoint-card.svelte`](../../../../packages/desktop/src/lib/acp/components/checkpoint/checkpoint-card.svelte) |

**Extra step:** Always add a desktop Model file for domain → prop mapping.

---

## 3. Layout shell

**When:** Shared chrome with host-specific regions injected via snippets.

| Layer | File |
|-------|------|
| View | [`packages/ui/src/components/app-layout/app-sidebar-layout.svelte`](../../../../packages/ui/src/components/app-layout/app-sidebar-layout.svelte) |
| Model | — |
| Controller | [`packages/desktop/src/lib/components/main-app-view/components/sidebar/app-sidebar.svelte`](../../../../packages/desktop/src/lib/components/main-app-view/components/sidebar/app-sidebar.svelte) |

**Extra step:** Define snippet props (`sessionList`, `footer`, etc.) for platform content.

**Pending extraction example:** Inline project card markup in [`session-list-ui.svelte`](../../../../packages/desktop/src/lib/acp/components/session-list/session-list-ui.svelte) should align with [`app-sidebar-project-group.svelte`](../../../../packages/ui/src/components/app-layout/app-sidebar-project-group.svelte) — see [`dry-run-session-list-project-card.md`](dry-run-session-list-project-card.md).

---

## 4. Scene board

**When:** View renders a scene DTO built from desktop runtime state.

| Layer | File |
|-------|------|
| View | [`packages/ui/src/components/kanban/kanban-scene-board.svelte`](../../../../packages/ui/src/components/kanban/kanban-scene-board.svelte) |
| Model | [`packages/desktop/src/lib/components/main-app-view/components/content/desktop-kanban-scene.ts`](../../../../packages/desktop/src/lib/components/main-app-view/components/content/desktop-kanban-scene.ts) |
| Controller | [`packages/desktop/src/lib/components/main-app-view/components/content/kanban-view.svelte`](../../../../packages/desktop/src/lib/components/main-app-view/components/content/kanban-view.svelte) |

**Extra step:** Model owns the full prop tree; View stays a thin renderer.
