---
date: 2026-04-14
topic: project-logo-auto-detection
---

# Project Logo Auto-Detection

## Problem Frame

When users add a project, the sidebar shows a generic letter badge even though most codebases contain a logo or icon file (logo.png, favicon.ico, etc.). The infrastructure to display project icons already exists — DB column, Tauri command, UI component — but nothing populates it. Users get no visual identity for their projects without manual intervention that doesn't even have UI yet.

## Requirements

**Auto-detection**
- R1. When a project is added to Acepe (via `import_project` or `add_project`), scan the project directory for logo/icon files using a prioritized candidate list. Set the first match as the project's `icon_path`. Note: `browse_project` is a transient file dialog that does not persist — detection runs in the commands that actually save the project.
- R2. Priority list, checked in order (first existing file wins): `logo.svg`, `logo.png`, `icon.svg`, `icon.png`, `favicon.svg`, `favicon.png`, `favicon.ico`, `.github/logo.svg`, `.github/logo.png`, `public/logo.svg`, `public/logo.png`, `public/favicon.svg`, `public/favicon.png`, `public/favicon.ico`, `assets/logo.svg`, `assets/logo.png`, `static/logo.svg`, `static/logo.png`.
- R3. Detection is a simple file-existence check against the candidate list — no recursive search, no content sniffing, no image validation. First hit wins.
- R4. If no candidate matches, leave `icon_path` as null. The existing letter badge remains the fallback.

**Context menu (right-click on project header)**
- R5. Right-clicking the project header in the sidebar shows a context menu with "Change icon..." and "Reset to letter badge" options.
- R6. "Change icon..." opens a native file picker filtered to image types (png, svg, ico, jpg, webp). The selected file path becomes the new `icon_path`.
- R7. "Reset to letter badge" sets `icon_path` to an empty string (`""`), clearing any auto-detected or manually chosen icon. This distinguishes "user explicitly cleared" from "never detected" (`null`), so the backfill (R9) does not override an intentional reset.
- R8. "Reset to letter badge" only appears when an icon is currently set (i.e., `icon_path` is a non-empty path).

**One-time backfill for existing projects**
- R9. On first app launch after the feature ships, run auto-detection for all existing projects with `icon_path` = null (not empty string — those were explicitly cleared by the user). Same candidate list and logic as R1-R4.
- R10. The backfill must not block app startup — run it in the background after the UI is ready.

**Graceful fallback for missing icons**
- R11. If the icon file at `icon_path` fails to load (deleted, moved, corrupt), fall back to the letter badge silently via `<img>` `onerror`. No toast or error message. The UI treats both `null` and `""` as "no icon" (show letter badge).

## Success Criteria

- Importing a project that contains `logo.png` (or any candidate file) immediately shows the logo in the sidebar — no manual action needed
- Existing projects gain icons automatically after the update (backfill) without delaying app startup or initial UI render
- Users can override or clear the auto-detected icon via right-click
- Right-clicking a project header shows icon management options; selecting a custom image updates the sidebar icon immediately, and resetting clears it back to the letter badge
- Right-clicking a project with no icon set does not show the "Reset to letter badge" option
- A deleted or moved icon file degrades gracefully to the letter badge — no broken images
- Projects with no recognizable logo file show the letter badge as before — no change in behavior

## Scope Boundaries

- No recursive filesystem search — only checks exact paths from the candidate list
- No image resizing, cropping, or processing — display as-is via `<img>`
- No recurring re-scanning on app launch or file watch — detection runs once per project (at add time or during the one-time backfill)
- No drag-and-drop icon setting — file picker only
- Auto-detection candidate list is intentionally narrower than the file picker's format filter: jpg/webp are accepted for manual override but excluded from auto-detection because they are rare as project logos

## Key Decisions

- **All entry points + one-time backfill**: Detection applies to every project creation path and runs once for existing projects. Ensures all users benefit immediately after the update.
- **Static candidate list over heuristic search**: Predictable, fast, no surprise matches. Covers the vast majority of real projects.
- **SVG preferred over raster**: SVG scales cleanly at any sidebar size; listed before PNG equivalents in the priority order.
- **Silent onerror fallback**: Broken icon paths degrade to letter badge without user-facing errors. Keeps the sidebar clean.
- **Empty string sentinel for user-cleared icons**: `icon_path = null` means "never detected", `""` means "user explicitly cleared". This prevents backfill from overriding intentional resets without requiring a new DB column.

## Dependencies / Assumptions

- `update_project_icon` Tauri command and `ProjectRepository::update_icon_path()` already exist and work
- `ProjectLetterBadge` renders `<img>` when `iconSrc` is provided, but currently has no `onerror` handler — R11 requires adding one (existing pattern in `image-artefact-preview.svelte`)
- Local filesystem paths stored in `icon_path` must be converted via `convertFileSrc()` before passing to `<img src>` — existing pattern in `image-block.ts` but not yet applied in the project icon pipeline
- **Prerequisite**: Tauri 2 asset protocol permission (`core:asset:default` or scoped variant) must be added to `capabilities/default.json` for `convertFileSrc()` to serve local files — without this, no local-path icons will render
- `AppSettingsRepository` (get/set key-value store) exists and can support the backfill "has_run" flag
- Assumes project logo files are reasonably sized — no guardrail against someone having a 50MB logo.png

## Outstanding Questions

### Deferred to Planning
- [Affects R1][Technical] Should detection run inside each Tauri command (Rust-side) or as a shared frontend call after project creation?
- [Affects R6][Technical] Should the file picker use the existing `rfd` crate pattern (used in `browse_project`) with `.add_filter("Images", &["png", "svg", "ico", "jpg", "webp"])`?
- [Affects R5][Technical] No project header context menu exists — create one using the existing `context-menu` component primitives. Note: `main-app-view.svelte` has a top-level `oncontextmenu` handler; the new handler should call `event.stopPropagation()`.
- [Affects R11][Technical] Should `convertFileSrc()` conversion happen at the mapping layer (`project-client.ts`) or at the component level (`ProjectLetterBadge`)?
- [Affects R9][Technical] Use `AppSettingsRepository::get/set` with a key like `"icon_backfill_v1"` for the one-time backfill gate.

## Next Steps

-> Create a structured implementation plan in docs/plans/