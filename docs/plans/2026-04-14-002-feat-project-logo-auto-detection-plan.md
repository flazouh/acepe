---
title: "feat: Auto-detect project logos and add icon context menu"
type: feat
status: active
date: 2026-04-14
origin: docs/brainstorms/2026-04-14-project-logo-auto-detection-requirements.md
---

# feat: Auto-detect project logos and add icon context menu

## Overview

Automatically detect project logos from the filesystem when projects are added, display them in the sidebar via the existing `icon_path` infrastructure, and provide a right-click context menu for manual override/reset. Includes a one-time backfill for existing projects and graceful fallback for missing icon files.

## Problem Frame

The sidebar shows generic letter badges for all projects even though most codebases contain recognizable logo files. The full icon infrastructure already exists (DB column, Tauri command, UI component) but nothing populates it and there is no UI to manage it. (see origin: `docs/brainstorms/2026-04-14-project-logo-auto-detection-requirements.md`)

## Requirements Trace

- R1. Auto-detect icons on project creation via `import_project` / `add_project`
- R2. Static priority list of 18 candidate file paths, checked in order
- R3. Simple file-existence check, first hit wins
- R4. Null fallback when no candidate matches
- R5. Right-click context menu on project header with "Change icon..." and "Reset to letter badge"
- R6. Native file picker for manual icon selection (png, svg, ico, jpg, webp)
- R7. Reset sets `icon_path` to `""` (empty string sentinel, not null)
- R8. "Reset to letter badge" only visible when icon is set
- R9. One-time backfill for existing projects with `icon_path = null` (skips `""`)
- R10. Backfill must not block app startup
- R11. Silent onerror fallback to letter badge; UI treats null and `""` as "no icon"

## Scope Boundaries

- No recursive search, content sniffing, or image validation
- No image resizing or processing
- No recurring re-scanning or file watch
- No drag-and-drop icon setting
- jpg/webp accepted in manual picker but excluded from auto-detection candidate list

## Context & Research

### Relevant Code and Patterns

**Backend (Rust):**
- `packages/desktop/src-tauri/src/storage/commands/projects.rs` — `import_project` (L114), `add_project` (L188), `browse_project` (L329), `update_project_icon` (L255)
- `packages/desktop/src-tauri/src/db/repository.rs` — `ProjectRepository::create_or_update()` (L70), `update_icon_path()` (L240)
- `packages/desktop/src-tauri/src/db/entities/project.rs` — `icon_path: Option<String>` field
- `packages/desktop/src-tauri/src/db/repository.rs` — `AppSettingsRepository::get/set` (L353+)
- rfd pattern: `browse_project` uses `AsyncFileDialog::new().set_title(...).pick_folder().await`

**Frontend (TypeScript/Svelte):**
- `packages/desktop/src/lib/acp/logic/project-client.ts` — `mapProject()`, `updateProjectIcon()`
- `packages/desktop/src/lib/acp/logic/project-manager.svelte.ts` — reactive `projects` state, `updateProjectIcon()` method
- `packages/desktop/src/lib/acp/components/project-header.svelte` — resolves `iconSrc` from project
- `packages/desktop/src/lib/acp/components/messages/acp-block-types/image-block.ts` — `convertFileSrc()` pattern with protocol check
- `packages/desktop/src/lib/acp/components/artefact/image-artefact-preview.svelte` — `onerror` handler pattern with `hasError` state
- `packages/ui/src/components/project-letter-badge/project-letter-badge.svelte` — `iconSrc` prop, `<img>` with `object-cover`, letter fallback
- `packages/desktop/src/lib/components/ui/context-menu/` — full ContextMenu component library
- `packages/desktop/src/lib/acp/components/file-list/file-tree-item.svelte` — reference context menu usage pattern

**Config:**
- `packages/desktop/src-tauri/capabilities/default.json` — needs asset protocol permission
- `packages/desktop/src-tauri/src/lib.rs` — command registration
- `packages/desktop/src/lib/services/command-names.ts` — frontend command name constants

### Institutional Learnings

- Never use `$effect` in Svelte 5 components — use `$derived` for computed values, event handlers for actions
- Never use `try/catch` — use `neverthrow` `ResultAsync` throughout
- Never use spread syntax — explicitly enumerate properties
- New UI components must be presentational in `@acepe/ui` — no Tauri, stores, or app-specific logic
- Rust commands: `#[tauri::command]` + `#[specta::specta]`, register in `lib.rs` + `collect_commands`
- Regenerate TS bindings: `cargo test export_command_bindings -- --nocapture`

## Key Technical Decisions

- **Detection runs Rust-side inside each Tauri command**: `import_project` and `add_project` are Rust commands where a shared `detect_project_icon()` helper runs after `create_or_update()`. If the project is new (returned `icon_path` is `None`), call `update_icon_path()` to set the detected icon. If the project already has an `icon_path` (user-set or previously detected), skip detection to avoid overwriting user choices. Note: `add_project` returns `()` so the frontend doesn't see the icon until `loadProjects()` refresh — this is acceptable. `import_project` returns `Project` and the frontend must use this response (not the stale `browse_project` result) for the optimistic UI update.
- **convertFileSrc at the mapping layer (project-client.ts)**: Apply conversion in `mapProject()` so `ProjectLetterBadge` (in `@acepe/ui`) stays pure and unaware of Tauri protocols. Follows the MVC separation principle.
- **File picker via existing rfd crate**: Use `AsyncFileDialog::new().add_filter("Images", &["png", "svg", "ico", "jpg", "webp"]).pick_file()` in a new `browse_project_icon` Tauri command, consistent with `browse_project`.
- **Backfill via AppSettingsRepository**: Use key `"icon_backfill_v1"` as a one-shot gate. Frontend checks on app init, invokes a dedicated `backfill_project_icons` Tauri command if not set.
- **Context menu at session-list-ui level**: Wrap `ProjectHeader` rendering in `ContextMenu.Root`/`Trigger` within `session-list-ui.svelte`. Use callback props (`onChangeProjectIcon`, `onResetProjectIcon`) following the existing `onProjectColorChange` pattern — `session-list-ui.svelte` is presentational and must not import `projectManager` directly. Note: there are two `ProjectHeader` render sites in the file — both must be wrapped.

## Open Questions

### Resolved During Planning

- **Detection: Rust-side vs frontend?** → Rust-side. File existence checks belong in the backend; avoids an extra Tauri invoke round-trip per project.
- **File picker: rfd or tauri-plugin-dialog?** → rfd. Already installed (`rfd = "0.15"` in Cargo.toml), used by `browse_project`. `tauri-plugin-dialog` is not installed.
- **Context menu: create new or extend existing?** → Create new. No project header context menu exists. Use existing `context-menu` component primitives from `packages/desktop/src/lib/components/ui/context-menu/`.
- **convertFileSrc: mapping layer or component?** → Mapping layer (`project-client.ts:mapProject()`). Keeps `@acepe/ui` components Tauri-agnostic.
- **Backfill trigger mechanism?** → `AppSettingsRepository::get("icon_backfill_v1")`. If null → run backfill → set key. Simple, no schema changes.

### Deferred to Implementation

- Exact `main-app-view.svelte` context menu event propagation behavior — may need `event.stopPropagation()` on the new handler
- Whether `capabilities/default.json` needs a scoped asset permission or blanket `core:asset:default` — try blanket first, scope if needed

## Implementation Units

- [ ] **Unit 1: Add Tauri asset protocol permission**

**Goal:** Enable `convertFileSrc()` to serve local filesystem images in the webview.

**Requirements:** Prerequisite for R1-R11 (all icon rendering depends on this)

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src-tauri/capabilities/default.json`

**Approach:**
- Add `"core:asset:default"` to the permissions array
- This grants the webview permission to load local files via the `asset://` protocol that `convertFileSrc()` produces

**Patterns to follow:**
- Existing permission entries in `capabilities/default.json`

**Test expectation:** none — config-only change. Verified by subsequent units rendering icons.

**Verification:**
- `convertFileSrc("/some/path")` produces a loadable `asset://` URL in the webview

---

- [ ] **Unit 2: Icon detection helper and wiring into project commands**

**Goal:** Create a Rust helper that checks the candidate file list and wire it into `import_project` and `add_project` so newly added projects get an icon automatically.

**Requirements:** R1, R2, R3, R4

**Dependencies:** None (detection logic is independent of rendering)

**Files:**
- Create: `packages/desktop/src-tauri/src/storage/commands/icon_detection.rs` (detection helper + `#[cfg(test)] mod tests` inline)
- Modify: `packages/desktop/src-tauri/src/storage/commands/mod.rs` (add module)
- Modify: `packages/desktop/src-tauri/src/storage/commands/projects.rs` (call detection in `import_project` and `add_project`)
- Modify: `packages/desktop/src/lib/acp/logic/project-manager.svelte.ts` (fix `importProject()` to use the returned Project)

**Approach:**
- `detect_project_icon(project_path: &Path) -> Option<String>` — iterates the 18-entry candidate list, returns absolute path of first existing file or `None`
- Candidate list as a `const` array of relative path strings
- In `import_project`: after `create_or_update()`, check if the returned project's `icon_path` is `None` (new project, never detected). Only then call `detect_project_icon()` → `update_icon_path()`. If `icon_path` is `Some(_)` (user-set, previously detected, or `""`-cleared), skip detection to avoid overwriting user choices.
- In `add_project`: same guard pattern. Since `add_project` returns `()`, the frontend won't see the icon until the subsequent `loadProjects()` reload — this is acceptable.
- **Fix importProject() optimistic update**: Change `project-manager.svelte.ts` `importProject()` from `.map(() => ...)` to `.map((importedProject) => ...)` and use `importedProject` (which carries the detected `icon_path`) for the optimistic UI update instead of the stale `browse_project` result.
- `browse_project` is **not modified** — detection only runs in commands that persist. The icon appears after `loadProjects()` refresh.

**Patterns to follow:**
- `browse_project` for filesystem path handling
- `create_or_update` for the existing project creation flow

**Test scenarios:**
- Happy path: Given a temp directory with `logo.png`, detection returns the absolute path to `logo.png`
- Happy path: Given a temp directory with both `logo.svg` and `logo.png`, detection returns `logo.svg` (higher priority)
- Happy path: Given a temp directory with `public/favicon.ico`, detection returns the path to `public/favicon.ico`
- Edge case: Given an empty temp directory, detection returns `None`
- Edge case: Given a path to a non-existent directory, detection returns `None` without panicking
- Priority: Given `icon.png` and `.github/logo.svg`, detection returns `icon.png` (root-level higher priority than subdirectory)

**Verification:**
- `cargo test icon_detection` passes
- Importing a project with a `logo.png` file results in `icon_path` being set in the database

---

- [ ] **Unit 3: Apply convertFileSrc in project-client mapping and wire icon through to ProjectHeader**

**Goal:** Convert filesystem `icon_path` values to `asset://` URLs at the mapping layer, and ensure the icon propagates through the session group → ProjectHeader rendering pipeline.

**Requirements:** R1, R11 (rendering pipeline)

**Dependencies:** Unit 1 (asset protocol permission)

**Files:**
- Modify: `packages/desktop/src/lib/acp/logic/project-client.ts`
- Modify: `packages/desktop/src/lib/acp/components/session-list/session-list-ui.svelte` (pass `projectIconSrc` to `ProjectHeader`)
- Test: `packages/desktop/src/lib/acp/logic/__tests__/project-client.vitest.ts`

**Approach:**
- In `mapProject()`, apply `convertFileSrc()` to `icon_path` when it is a non-empty, non-null, non-protocol string. Use a falsy guard (`if (!iconPath)`) to correctly handle both `null` and `""` — do NOT use `if (iconPath !== null)` which would pass `""` to `convertFileSrc()`.
- Follow the protocol-check pattern from `image-block.ts:normalizeImageUri()`: skip conversion if the value already starts with `http://`, `https://`, `data:`, or `asset://`
- Null and empty string (`""`) pass through unchanged — the UI handles these as "no icon"
- **Wire icon through to ProjectHeader:** `session-list-ui.svelte` currently passes only `projectColor` and `projectName` to `ProjectHeader`. Add `projectIconSrc={group.projectIconSrc}` to both `ProjectHeader` render sites. Verify the `SessionGroup` type (or equivalent) carries the icon path from the project list.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/components/messages/acp-block-types/image-block.ts` — `normalizeImageUri()` function

**Test scenarios:**
- Happy path: `icon_path = "/Users/alex/project/logo.png"` → converted to `asset://localhost/...` URL
- Edge case: `icon_path = null` → remains null
- Edge case: `icon_path = ""` → remains `""` (sentinel for user-cleared) — must NOT be passed to `convertFileSrc()`
- Edge case: `icon_path = "https://example.com/logo.png"` → passed through unchanged
- Edge case: `icon_path = "asset://localhost/..."` → passed through unchanged (already converted)
- Integration: `ProjectHeader` in `session-list-ui.svelte` receives converted `iconSrc` and displays the project icon

**Verification:**
- `bun test project-client` passes
- `bun run check` passes with no type errors

---

- [ ] **Unit 4: Add onerror fallback to ProjectLetterBadge**

**Goal:** Gracefully fall back to the letter badge when an icon file fails to load.

**Requirements:** R11

**Dependencies:** None

**Files:**
- Modify: `packages/ui/src/components/project-letter-badge/project-letter-badge.svelte`
- Test: `packages/ui/src/components/project-letter-badge/__tests__/project-letter-badge.vitest.ts`

**Approach:**
- Add `hasError` and `errorSrc` state variables (Svelte 5 `$state`)
- Add `onerror` handler to the `<img>` tag that sets `hasError = true` and `errorSrc = iconSrc`
- Derive display state: `const showImage = $derived(iconSrc && !(hasError && errorSrc === iconSrc))` — this auto-resets when `iconSrc` changes to a new value without needing `$effect`
- Render letter badge when `!showImage`
- Follow the pattern from `image-artefact-preview.svelte` but adapt to avoid `$effect` per CLAUDE.md

**Patterns to follow:**
- `packages/desktop/src/lib/acp/components/artefact/image-artefact-preview.svelte` — `hasError` state + `handleError` callback

**Test scenarios:**
- Happy path: When `iconSrc` is a valid image URL, renders `<img>` tag
- Happy path: When `iconSrc` is null, renders letter badge
- Error path: When `iconSrc` fails to load (onerror fires), renders letter badge instead of broken image
- Edge case: When `iconSrc` changes from a broken URL to a valid one, renders the new image (error state resets)

**Verification:**
- `bun test project-letter-badge` passes
- `bun run check` passes

---

- [ ] **Unit 5: Browse-icon Tauri command**

**Goal:** Add a native file picker command for selecting project icon images.

**Requirements:** R6

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src-tauri/src/storage/commands/projects.rs` (add `browse_project_icon` command)
- Modify: `packages/desktop/src-tauri/src/lib.rs` (register command)
- Modify: `packages/desktop/src/lib/services/command-names.ts` (add command name constant)
- Modify: `packages/desktop/src/lib/utils/tauri-client/projects.ts` (add frontend binding)
- Modify: `packages/desktop/src/lib/acp/logic/project-client.ts` (add `browseProjectIcon()` method)

**Approach:**
- New Rust command `browse_project_icon()` using `rfd::AsyncFileDialog::new().set_title("Select Project Icon").add_filter("Images", &["png", "svg", "ico", "jpg", "jpeg", "webp"]).pick_file().await`
- Returns `Option<String>` — the selected file's absolute path, or None if cancelled
- Frontend wiring: command name constant → tauri-client binding → project-client method returning `ResultAsync<string | null, ProjectError>`
- **Ordering:** Complete Rust command + `lib.rs` registration first, then run `cargo test export_command_bindings -- --nocapture` to regenerate TS bindings, then wire frontend code

**Patterns to follow:**
- `browse_project` in `projects.rs` — same rfd pattern but with `pick_file()` instead of `pick_folder()` and with `add_filter()`
- `packages/desktop/src/lib/utils/tauri-client/projects.ts` — existing command bindings

**Test scenarios:**
- Happy path: Command compiles and is registered (verified via `cargo test export_command_bindings`)
- Integration: Frontend client method returns `ResultAsync` with correct types

**Verification:**
- `cargo clippy` passes
- `cargo test export_command_bindings -- --nocapture` regenerates bindings including `browse_project_icon`
- `bun run check` passes with new frontend bindings

---

- [ ] **Unit 6: Project header context menu**

**Goal:** Add a right-click context menu to project headers in the sidebar with "Change icon..." and "Reset to letter badge" options.

**Requirements:** R5, R6, R7, R8

**Dependencies:** Unit 5 (browse-icon command), existing `updateProjectIcon` command

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/session-list/session-list-ui.svelte` (wrap both ProjectHeader instances in ContextMenu, add callback props)
- Modify: `packages/desktop/src/lib/acp/logic/project-manager.svelte.ts` (add `browseAndSetProjectIcon()` method)
- Modify: controller that renders `session-list-ui` (wire new callback props to `projectManager` methods)
- Test: `packages/desktop/src/lib/acp/components/session-list/__tests__/session-list-ui.vitest.ts` (create if needed)

**Approach:**
- Add `onChangeProjectIcon?: (projectPath: string) => void` and `onResetProjectIcon?: (projectPath: string) => void` callback props to `session-list-ui.svelte`, following the existing `onProjectColorChange` pattern. The component is presentational and must not import `projectManager` directly.
- Wrap **both** `ProjectHeader` render sites (~L782 and ~L930) with `<ContextMenu.Root>` / `<ContextMenu.Trigger>` / `<ContextMenu.Content>`. Extract into a shared snippet to avoid duplication.
- Two menu items:
  - "Change icon..." — calls `onChangeProjectIcon?.(projectPath)`
  - "Reset to letter badge" — calls `onResetProjectIcon?.(projectPath)` (empty string sentinel per R7). Conditionally rendered: only shown when the project has a non-empty `iconPath`
- Event handling: `event.stopPropagation()` on the trigger to prevent bubbling
- In the controller (the parent that renders `session-list-ui`): wire `onChangeProjectIcon` to `projectManager.browseAndSetProjectIcon(path)` and `onResetProjectIcon` to `projectManager.updateProjectIcon(path, "")`
- `browseAndSetProjectIcon()` in `project-manager.svelte.ts`: orchestrates browse → update flow, returns `ResultAsync`

**Patterns to follow:**
- `packages/desktop/src/lib/acp/components/file-list/file-tree-item.svelte` — ContextMenu usage pattern with `ContextMenu.Root`, `Trigger`, `Content`, `Item`
- Existing `onProjectColorChange` callback pattern in `session-list-ui.svelte`

**Test scenarios:**
- Happy path: Context menu renders with "Change icon..." when right-clicking a project header with no icon
- Happy path: Context menu renders with both "Change icon..." and "Reset to letter badge" when right-clicking a project header that has an icon
- Edge case: "Reset to letter badge" is hidden when project has no icon (R8)
- Integration: Selecting "Reset to letter badge" calls `updateProjectIcon` with empty string, and the icon disappears from the sidebar

**Verification:**
- `bun test session-list` passes
- `bun run check` passes
- Right-clicking a project header shows the context menu with appropriate options

---

- [ ] **Unit 7: One-time backfill for existing projects**

**Goal:** On first app launch after the feature ships, run auto-detection for all existing projects that have never had an icon set.

**Requirements:** R9, R10

**Dependencies:** Unit 2 (detection helper)

**Files:**
- Modify: `packages/desktop/src-tauri/src/storage/commands/projects.rs` (add `backfill_project_icons` command)
- Modify: `packages/desktop/src-tauri/src/lib.rs` (register command)
- Modify: `packages/desktop/src/lib/services/command-names.ts` (add command name)
- Modify: `packages/desktop/src/lib/utils/tauri-client/projects.ts` (add frontend binding)
- Modify: `packages/desktop/src/lib/acp/logic/project-manager.svelte.ts` (add `runIconBackfillIfNeeded()`)
- Modify: `packages/desktop/src/lib/components/main-app-view.svelte` (call backfill after `loadProjects()` completes)
- Test: `packages/desktop/src-tauri/src/storage/commands/icon_detection.rs` (extend inline tests)

**Approach:**
- New Rust command `backfill_project_icons()`:
  1. Check `AppSettingsRepository::get("icon_backfill_v1")` — if set, return early with 0
  2. Fetch all projects via `ProjectRepository::get_all()`, filter in Rust for rows where `icon_path.is_none()` (no new query method needed for the small project count)
  3. For each, run `detect_project_icon()` and if a match is found, use a conditional update: only write if `icon_path` is still `None` (guards against race with concurrent user actions)
  4. Set `AppSettingsRepository::set("icon_backfill_v1", "done")`
  5. Return count of projects updated
- Frontend: `projectManager.runIconBackfillIfNeeded()` calls the command, then reloads projects if count > 0
- Non-blocking (R10): Called from `main-app-view.svelte` after `loadProjects()` completes as a fire-and-forget — don't await before rendering UI

**Patterns to follow:**
- `AppSettingsRepository::get/set` pattern from `settings.rs` custom keybindings example
- `loadProjects()` in `project-manager.svelte.ts` for reactive project list refresh

**Test scenarios:**
- Happy path: Given 3 projects with `icon_path = null` and one has `logo.png`, backfill detects and sets the icon for that project
- Happy path: Backfill sets the `icon_backfill_v1` key after completion
- Edge case: If `icon_backfill_v1` is already set, command returns 0 immediately (no-op)
- Edge case: Projects with `icon_path = ""` (user-cleared) are skipped — not re-detected
- Edge case: If a project's directory no longer exists, detection skips it gracefully

**Verification:**
- `cargo test backfill` passes
- After running the app once, the `icon_backfill_v1` setting exists in the database
- Existing projects with logo files now show icons in the sidebar

## System-Wide Impact

- **Interaction graph:** `import_project` and `add_project` gain a synchronous `detect_project_icon()` call before returning. This adds ~1ms per project (18 filesystem stat calls). `browse_project` also returns a detected icon in the transient `Project` struct.
- **Error propagation:** Detection errors (e.g., permission denied on a candidate path) should be silently ignored — return `None` and let the letter badge display. Never fail project creation due to icon detection.
- **State lifecycle:** The `projects` array in `ProjectManager` is the reactive source of truth. All icon updates flow through `updateProjectIcon()` which replaces the project in the array, triggering re-render.
- **API surface parity:** The existing `update_project_icon` Tauri command handles all icon path updates — both the new context menu and the backfill use it (directly or via the repository).
- **Unchanged invariants:** `ProjectLetterBadge` in `@acepe/ui` stays presentational. It gains `onerror` handling but remains Tauri-agnostic. The `convertFileSrc` conversion happens in the desktop mapping layer, not in the shared UI component.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `core:asset:default` permission is too broad for security | Start with blanket permission. If CSP is later tightened, revisit with scoped asset paths. Current CSP is `null`. |
| Large SVG files cause rendering lag in sidebar | Scope boundary accepts this risk. Icons are displayed at ~20px — even large SVGs render fast at small sizes. |
| Candidate list has low hit rate in practice | List covers common conventions. Context menu provides manual fallback. List is trivially extensible in future. |
| `browse_project` returns detected icon but doesn't persist it | This is intentional — `browse_project` is transient. The icon displays immediately when the frontend subsequently calls `add_project`/`import_project`. |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-14-project-logo-auto-detection-requirements.md](docs/brainstorms/2026-04-14-project-logo-auto-detection-requirements.md)
- Related code: `packages/desktop/src-tauri/src/storage/commands/projects.rs` (project commands)
- Related code: `packages/desktop/src/lib/acp/logic/project-manager.svelte.ts` (reactive state)
- Related code: `packages/desktop/src/lib/acp/components/messages/acp-block-types/image-block.ts` (convertFileSrc pattern)
- Related code: `packages/desktop/src/lib/acp/components/artefact/image-artefact-preview.svelte` (onerror pattern)
- Related code: `packages/desktop/src/lib/acp/components/file-list/file-tree-item.svelte` (context menu pattern)
