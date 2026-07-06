---
title: "refactor: Replace path trees with Pierre Trees"
type: refactor
status: active
date: 2026-07-04
---

# refactor: Replace path trees with Pierre Trees

## Overview

Acepe should use `@pierre/trees` for the tree widgets that are actually path-first trees. The package exposes a vanilla API, so Acepe can use it from Svelte the same way it uses `@pierre/diffs`: Svelte owns the page, Pierre owns one mounted DOM container.

The work should start with a small shared Svelte adapter in `@acepe/ui`, then replace path-first file trees through that adapter. Non-file hierarchies, such as SQL schema and plugin skills, are migrated only when the package can preserve the current labels, metadata, and interaction clarity.

```text
Svelte view
  -> shared @acepe/ui Pierre tree adapter
  -> new FileTree({ paths, gitStatus, icons, callbacks })
  -> shadow DOM tree
```

## Problem Frame

Acepe currently has several local tree implementations:

- `GitFileTree` builds and flattens its own file tree.
- The project file system dialog builds and flattens its own file tree.
- SQL Studio renders a schema/table/column tree by hand.
- The active skills page renders a plugin/plugin-skill hierarchy by hand through `PluginSkillsSection`.
- `skills-tree.svelte` and `skills-tree-item.svelte` are exported but appear unused by the active skills page.
- The sidebar session/project area looks tree-shaped, but it is a rich session surface with custom rows and canonical session data.

The goal is to remove duplicated tree UI where `@pierre/trees` is a good fit, without breaking Svelte boundaries, row actions, file selection, or session-sidebar behavior.

## Requirements Trace

- R1. Add `@pierre/trees@1.0.0-beta.5` and use the root vanilla API, not the React entry point.
- R2. Create one shared presentational adapter in `packages/ui` so desktop and website consumers do not each wrap the imperative API differently.
- R3. Replace the hand-built Git file tree with Pierre Trees while preserving file selection, diff status, icons, and Git panel row actions.
- R4. Replace the project file system dialog tree with Pierre Trees while preserving file preview selection, initial selection, git-status coloring, and open-file behavior.
- R5. Replace the SQL Studio schema tree if the schema/table/column mapping preserves table selection, column metadata, primary-key indication, and current density.
- R6. Replace the active plugin-skills hierarchy if the synthetic path mapping preserves plugin labels, skill labels, descriptions, read-only indication, and selection clarity.
- R7. Do not force the session sidebar into Pierre Trees in this pass. It is not a path-first file tree and crosses the canonical session display boundary.
- R8. Remove old tree-building helpers and unused tree components only after their consumers are gone.
- R9. Verify visible changes through unit tests, type checks, website checks, and the Acepe QA wrapper.

## Scope Boundaries

- In scope: path-first tree widgets and simple hierarchy widgets that can map cleanly to stable paths.
- In scope: SQL Studio schema/table/column tree if Pierre row decorations can preserve column data type and primary-key clarity.
- In scope: active plugin-skills hierarchy if Pierre can preserve the current plugin and plugin-skill presentation.
- Out of scope: changing canonical session data, transcript data, session ordering, or provider parsing.
- Out of scope: replacing the rich session sidebar rows with Pierre shadow-DOM rows in this pass.
- Out of scope: redesigning Git, file explorer, or skills behavior beyond the tree renderer swap.
- Out of scope: making Acepe a React app. React peers may exist in the lockfile, but Acepe should use the vanilla `@pierre/trees` API.

### Deferred to Separate Tasks

- Session sidebar replacement: only revisit if there is a product decision to redesign session rows around a path-tree model. That task needs its own GOD check and plan.
- Deep theme polish: after the first migration lands, tune broader visuals separately. This pass may add only the minimal `unsafeCSS` needed to preserve current readability, density, and interaction states.

## Context & Research

### Relevant Code and Patterns

- `packages/ui/src/components/git-viewer/git-file-tree.svelte` is the main shared file tree today.
- `packages/ui/src/components/git-panel/git-status-list.svelte` depends on `GitFileTree` and passes row action snippets for stage, unstage, and discard.
- `packages/desktop/src/lib/acp/components/file-explorer-modal/project-file-system-dialog.svelte` builds a file tree from indexed files and selects files for preview.
- `packages/ui/src/components/sql-studio/sql-studio-sidebar.svelte` renders the SQL schema tree and is used by SQL Studio layout, website demos, and desktop fixtures.
- `packages/desktop/src/lib/skills/components/plugin-skills-section.svelte` renders the active plugin-skills hierarchy inside `skills-page.svelte`.
- `packages/desktop/src/lib/skills/components/skills-tree.svelte` and `skills-tree-item.svelte` appear unused by the active page; final cleanup should classify them before migration or deletion.
- `packages/desktop/src/lib/acp/components/session-list/virtualized-session-list.svelte` renders session rows from canonical session projections and should stay out of this pass.
- `packages/ui/src/components/agent-panel/agent-tool-edit-diff.svelte` shows the local pattern for wrapping an imperative Pierre renderer from Svelte.

### Institutional Learnings

- `docs/solutions/workflow-issues/ui-package-hmr-duplicate-module-identity-2026-07-04.md`: new `@acepe/ui` exports should rely on the package export map and existing Vite aliasing, not ad hoc desktop imports.
- `docs/solutions/best-practices/svelte5-unconditional-snippet-props-2026-04-12.md`: keep snippets unconditional when used.
- `docs/solutions/best-practices/reactive-state-async-callbacks-svelte-2026-04-15.md`: snapshot reactive inputs before async or imperative callbacks.
- `docs/brainstorms/2026-06-28-solid-sidebar-rebuild-requirements.md`: the sidebar is a display projection of canonical session/project data, so do not patch session truth in UI.

### External References

- `@pierre/trees` package metadata: latest checked version is `1.0.0-beta.5`.
- `@pierre/trees` README from the npm tarball: root package exports `FileTree`, `prepareFileTreeInput`, git status types, icon config, row decorations, context menu hooks, and a vanilla `render({ containerWrapper })` API.

### Verified Pierre API Surface

- Lifecycle: `new FileTree(options)`, `render({ containerWrapper })`, `unmount()`, and `cleanUp()`.
- Path updates: `resetPaths(paths)` and prepared-input reset overloads.
- Decorations/status/icons: `setGitStatus(...)`, `setIcons(...)`, and `setComposition(...)`; `renderRowDecoration` is constructor-time option surface, so the adapter must use stable live closures or recreate the tree when decoration behavior changes.
- Selection: `initialSelectedPaths`, `onSelectionChange`, `getSelectedPaths()`, and item handles from `getItem(path)` with `select()` / `deselect()`. There is no direct `setSelectedPaths` API, so the adapter must implement controlled selection itself.
- Scrolling/focus: `scrollToPath(path, options)` and `focusPath(path)`.
- Context/action lane: `composition.contextMenu` supports right-click and button trigger modes. It can render an `HTMLElement` menu surface, but row decorations are limited to text or icon.

## GOD Architecture Check

- **Authority surface:** presentational UI for Git/file/skills trees.
- **Canonical-owned fields:** session sidebar data, session hierarchy, session ids, and project/session display facts. These are not changed.
- **Truly-local fields:** tree expansion, file selection in local panels, focused tree path, search text, and row hover/action UI.
- **Provider-metadata:** none.
- **To be widened:** none.
- **Must be deleted:** old local file-tree builder helpers after migration, if unused.

Violations avoided:

- No `canonical ?? hotState` fallback.
- No provider-specific UI branch.
- No UI-side session order repair.
- No direct Tauri/store import into `packages/ui`.
- No session-sidebar rewrite inside a file-tree migration.

## Key Technical Decisions

- Use the root `@pierre/trees` vanilla API, not `@pierre/trees/react`, because Acepe is Svelte.
- Put the adapter in `packages/ui` as a leaf presentational component. Desktop supplies props and callbacks.
- Use a small Svelte attachment factory for mount/update/cleanup instead of adding a new `$effect`-heavy wrapper.
- Make adapter selection controlled: external `selectedPath`/`selectedPaths` props are synced after mount, after `resetPaths`, and when selection props change.
- Prefer Pierre's built-in `gitStatus`, `icons`, `renderRowDecoration`, and `composition.contextMenu` hooks over custom Svelte row markup inside the shadow DOM.
- Keep row action support descriptor-based. Existing Svelte snippets cannot be mounted directly inside Pierre's shadow DOM rows.
- For Git status row actions, use Pierre's context-menu action lane with `triggerMode: "button"` or `"both"` and keyboard-accessible menu items. If that cannot preserve stage/unstage/discard usability, keep the old renderer for that surface until a better public Pierre API exists.
- Do not migrate the session sidebar in this plan. It is a custom session view, not a file tree.

## Open Questions

### Resolved During Planning

- **Is `@pierre/trees` a React-only package?** No. The root export has a vanilla `FileTree` API.
- **Should this use React in Acepe?** No. Use `@pierre/trees`, not `@pierre/trees/react`.
- **Should the session sidebar be in the first pass?** No. It risks session display regressions and does not fit the package's path-first model.
- **Should SQL Studio be included?** Yes. It has a visible schema tree and must be migrated or explicitly no-go documented in this pass.
- **Should legacy `skills-tree.svelte` be migrated?** Not first. The active skills UI uses `PluginSkillsSection`; legacy exports are cleanup candidates unless another active consumer appears.

### Deferred to Implementation

- **Exact adapter prop names:** decide while implementing the small `@acepe/ui` component.
- **Exact shadow-DOM CSS:** start with CSS variables and add only minimal `unsafeCSS` when QA shows a parity gap.
- **Plugin-skills tree fit:** migrate only if synthetic paths preserve labels, descriptions, read-only indication, empty/loading states, and selection.
- **SQL Studio tree fit:** migrate only if column metadata and primary-key indicators remain clear.

## Implementation Units

- [ ] **Unit 1: Add shared Pierre tree adapter**

**Goal:** Add `@pierre/trees` and create one Svelte adapter in `@acepe/ui`.

**Requirements:** R1, R2

**Dependencies:** None

**Files:**
- Modify: `packages/ui/package.json`
- Modify: `packages/ui/src/index.ts`
- Modify: `bun.lock`
- Modify as produced by the chosen install command: `packages/ui/bun.lock`, `packages/desktop/bun.lock`, and `packages/website/bun.lock`
- Create: `packages/ui/src/components/pierre-tree/index.ts`
- Create: `packages/ui/src/components/pierre-tree/pierre-file-tree.svelte`
- Create: `packages/ui/src/components/pierre-tree/pierre-file-tree-attachment.ts`
- Create: `packages/ui/src/components/pierre-tree/pierre-file-tree-types.ts`
- Test: `packages/ui/src/components/pierre-tree/pierre-file-tree.svelte.vitest.ts`

**Approach:**
- Wrap `new FileTree(options)` and `tree.render({ containerWrapper })`.
- Use this update matrix:
  - path changes: `resetPaths(...)`, then re-apply controlled selection and reveal if requested;
  - git status changes: `setGitStatus(...)`;
  - icon changes: `setIcons(...)`;
  - context-menu changes: `setComposition(...)`;
  - decoration/CSS/action-callback changes: stable live closures when safe, otherwise recreate the `FileTree` instance.
- Implement controlled selection by comparing adapter `selectedPath`/`selectedPaths` to `tree.getSelectedPaths()`, deselecting stale handles, selecting current handles through `getItem(path)?.select()`, and clearing removed selections.
- Preserve expansion, focus, and scroll where paths still exist. Recreate the tree only when an in-place update cannot keep state correct.
- Clean up the instance on unmount.
- Keep the View presentational: no Tauri, no stores, no desktop services.
- Expose callbacks such as selection change and optional row action descriptors.
- Mock `@pierre/trees` in tests, similar to the existing `@pierre/diffs` tests.
- Follow Acepe TypeScript rules: no `any`, no `unknown`, no `try/catch`, and no spread except the allowed same-shape clone case.

**Execution note:** Add the adapter test first so stale render/update/cleanup behavior is covered before wiring real screens.

**Patterns to follow:**
- `packages/ui/src/components/agent-panel/agent-tool-edit-diff.svelte`
- `packages/ui/src/components/checkpoint/checkpoint-card.svelte`
- `packages/ui/src/components/git-viewer/git-file-tree.svelte`

**Test scenarios:**
- Happy path: given paths and an initial selected path, the adapter constructs `FileTree` and renders into the container.
- Integration: when paths change, the adapter updates or recreates the Pierre instance without leaking the old instance.
- Integration: external selected path changes after mount update Pierre selection.
- Integration: path-list reload clears selection when the selected path no longer exists and preserves it when the path still exists.
- Integration: changed diff decorations or action descriptors update visible row output.
- Edge case: empty paths render an empty tree container without throwing.
- Edge case: unmount calls `cleanUp`.
- Integration: selection callback receives the selected file path from Pierre.

**Verification:**
- `@acepe/ui` exports the adapter.
- UI package tests pass.

- [ ] **Unit 2: Migrate Git file tree**

**Goal:** Replace `GitFileTree` internals with the shared Pierre adapter while preserving current Git viewer and Git panel behavior.

**Requirements:** R3, R7

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/ui/src/components/git-viewer/git-file-tree.svelte`
- Modify: `packages/ui/src/components/git-viewer/index.ts`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/src/components/git-panel/git-status-list.svelte`
- Stop using old helper imports in this unit: `packages/ui/src/components/git-viewer/file-tree-logic.ts`
- Test: `packages/ui/src/components/git-viewer/git-file-tree.svelte.vitest.ts`
- Test: `packages/ui/src/components/git-panel/git-status-list.svelte.vitest.ts`

**Approach:**
- Convert `GitViewerFile[]` into Pierre `paths` and `gitStatus` props.
- Preserve selected file behavior through controlled adapter selection, not only `initialSelectedPaths`.
- Map Acepe file statuses to Pierre git statuses.
- Preserve diff stats with `renderRowDecoration`, using a compact `+N -M` text decoration with a title for screen-reader/hover clarity. If Pierre's decoration lane cannot match Acepe's current `DiffPill` clarity, document the gap before changing the public look.
- Replace snippet-based inline row actions with descriptor-driven action-menu items using Pierre's context-menu action lane. The action button must be visible on hover/focus, keyboard reachable, and must not select the file when an action is invoked.
- Preserve existing Git panel callbacks: stage, unstage, discard, and file select.
- Match current expansion policy with `flattenEmptyDirectories: true` and open-by-default behavior unless QA proves a better match.
- Remove local helper consumers in this unit. Unit 6 owns final deletion/export cleanup after the full tree audit.
- Avoid importing `@pierre/trees` directly from desktop for this unit; desktop should keep consuming `@acepe/ui`.

**Execution note:** Characterize current `GitFileTree` behavior before replacing it because it is a shared UI component used by the website demos and desktop Git panel.

**Patterns to follow:**
- `packages/ui/src/components/git-panel/git-status-list.svelte`
- `packages/website/src/lib/blog/demos/git-pr-demo.svelte`
- `packages/website/src/lib/blog/demos/git-commit-demo.svelte`

**Test scenarios:**
- Happy path: selecting a file in the Pierre tree calls `onSelect` with that file.
- Happy path: added, deleted, renamed, and modified files map to expected Pierre git statuses.
- Happy path: files with insertions/deletions show compact diff stats in the row decoration lane.
- Integration: GitStatusList staged actions still call `onUnstage`.
- Integration: GitStatusList unstaged actions still call `onStage` and `onDiscard`.
- Integration: stage/unstage/discard action menu items do not also select the file.
- Edge case: selecting a directory does not call file-select.
- Edge case: empty staged and unstaged lists still show the existing empty state.

**Verification:**
- Git viewer and Git panel render file trees through the adapter.
- Old UI file-tree helper exports are gone if unused.

- [ ] **Unit 3: Migrate project file system dialog**

**Goal:** Replace the project file system dialog's local tree/flatten logic with the shared Pierre adapter.

**Requirements:** R4, R7

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/file-explorer-modal/project-file-system-dialog.svelte`
- Create: `packages/desktop/src/lib/acp/components/file-explorer-modal/project-file-system-tree-model.ts`
- Test: `packages/desktop/src/lib/acp/components/file-explorer-modal/__tests__/project-file-system-tree-model.test.ts`
- Stop using old helper imports in this unit: `packages/desktop/src/lib/acp/components/file-list/file-list-logic.ts`
- Stop using old helper imports in this unit: `packages/desktop/src/lib/acp/components/file-list/file-list-types.ts`

**Approach:**
- Keep loading, preview fetching, project switching, and open-file callbacks in the desktop controller.
- Move only pure mapping into the new model file: indexed files -> paths, git status entries, first selectable file, and initial selected path.
- Map file-index git statuses explicitly: `M -> modified`, `A -> added`, `? -> untracked`, `D -> deleted`, `R -> renamed`, and omit null status entries.
- Preserve insertions/deletions display using the same adapter row-decoration path as `GitFileTree`.
- Preserve directory aggregate status and insertions/deletions in a decoration model keyed by path. Pierre `GitStatusEntry` only carries status, so aggregate counts must not be hidden inside git status.
- Use Pierre selection changes to call the existing `selectFile`.
- Use `scrollToPath` or initial selection to reveal the selected file when the dialog opens.
- Preserve the current fallback preview behavior.

**Execution note:** Start with model tests for path extraction, first-file selection, and git status mapping.

**Patterns to follow:**
- `packages/desktop/src/lib/acp/components/file-explorer-modal/file-explorer-preview-pane-state.ts`
- `packages/desktop/src/lib/components/main-app-view/tests/file-explorer-context.test.ts`

**Test scenarios:**
- Happy path: indexed files become path strings in stable order.
- Happy path: modified files become git status entries that Pierre can display.
- Happy path: directory rows with modified descendants show aggregate diff text.
- Happy path: `M`, `A`, `?`, `D`, and `R` map to the expected Pierre status values.
- Happy path: `initialFilePath` is selected and previewed after load.
- Edge case: no files keeps the existing "No files found" state.
- Error path: preview load failure still creates fallback preview.
- Integration: selecting a file in the tree calls `getFileExplorerPreview` for the selected path.

**Verification:**
- File system dialog no longer imports local tree flatten helpers.
- File preview selection still works.

- [ ] **Unit 4: Migrate SQL Studio schema tree if metadata stays clear**

**Goal:** Replace the SQL Studio schema/table/column tree with Pierre Trees if table selection and column metadata remain clear.

**Requirements:** R5

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/ui/src/components/sql-studio/sql-studio-sidebar.svelte`
- Create: `packages/ui/src/components/sql-studio/sql-studio-tree-model.ts`
- Test: `packages/ui/src/components/sql-studio/sql-studio-tree-model.test.ts`
- Test: `packages/ui/src/components/sql-studio/sql-studio-sidebar.svelte.vitest.ts`

**Approach:**
- Map schema/table/column rows to stable paths.
- Use controlled selection for the selected table. Column rows may be focusable for navigation but must not replace table selection unless a product decision says columns should become selectable.
- Preserve table expand/collapse behavior through Pierre directory expansion.
- Preserve column `dataType` and primary-key indication with row decorations. If this is less clear than the current inline metadata, mark SQL Studio as no-go and keep the existing renderer.
- Keep the connections list unchanged; only replace the schema tree section.

**Execution note:** Add model coverage before changing the Svelte tree. This unit may legitimately end with a documented no-go if the package cannot preserve SQL metadata clarity.

**Patterns to follow:**
- `packages/ui/src/components/sql-studio/sql-studio-sidebar.svelte`
- `packages/website/src/routes/blog/sql-studio/+page.svelte`

**Test scenarios:**
- Happy path: schema/table/column data maps to stable paths.
- Happy path: selecting a table path calls `onTableSelect(schemaName, tableName)`.
- Happy path: column rows show data type and primary-key indication.
- Edge case: empty schema keeps the existing no-tree state.
- Integration: website SQL Studio demo still builds after the shared UI change.

**Verification:**
- SQL Studio uses Pierre Trees for the schema tree or has a clear documented reason not to.
- Connections list behavior is unchanged.

- [ ] **Unit 5: Evaluate active plugin-skills hierarchy and legacy skills tree exports**

**Goal:** Handle the active plugin-skills hierarchy honestly and avoid migrating unused legacy components.

**Requirements:** R6, R8

**Dependencies:** Unit 1

**Files:**
- Modify if fit-check passes: `packages/desktop/src/lib/skills/components/plugin-skills-section.svelte`
- Create if fit-check passes: `packages/desktop/src/lib/skills/components/plugin-skills-tree-model.ts`
- Test if fit-check passes: `packages/desktop/src/lib/skills/components/plugin-skills-tree-model.test.ts`
- Test if fit-check passes: `packages/desktop/src/lib/skills/components/plugin-skills-section.svelte.vitest.ts`
- Cleanup candidate: `packages/desktop/src/lib/skills/components/skills-tree.svelte`
- Cleanup candidate: `packages/desktop/src/lib/skills/components/skills-tree-item.svelte`
- Modify if cleanup happens: `packages/desktop/src/lib/skills/components/index.ts`
- Documentation if no-go: `docs/solutions/`

**Approach:**
- First verify whether `skills-tree.svelte` / `skills-tree-item.svelte` have active consumers beyond exports.
- Treat `PluginSkillsSection` as the active hierarchy in use.
- Run a model-only fit check before Svelte edits. Must-keep behaviors:
  - plugin headers and skill counts remain clear;
  - plugin skill names and descriptions remain visible enough;
  - read-only/plugin indication remains visible;
  - selection opens the same details pane;
  - loading/empty plugin skill states remain readable;
  - expansion has one owner: either Pierre owns it locally, or desktop store owns it with tested sync. Do not split ownership.
- If the fit check fails, keep the current renderer and record a no-go note. Unit 6 then cleans unused legacy tree exports if safe.

**Execution note:** Do not modify the Svelte component until the model-only fit check passes.

**Patterns to follow:**
- `packages/desktop/src/lib/skills/components/plugin-skills-section.svelte`
- `packages/desktop/src/lib/skills/components/plugin-skill-list-item.svelte`
- `packages/desktop/src/lib/skills/components/skills-page.svelte`

**Test scenarios:**
- Happy path: plugin -> plugin skill hierarchy maps to stable paths.
- Happy path: selecting a plugin skill path calls `selectPluginSkill`.
- Happy path: plugin skill description remains available or the fit check fails explicitly.
- Edge case: plugin with no loaded skills keeps "Loading skills..." or equivalent readable state.
- Cleanup: unused legacy skills tree exports are removed only when no active imports remain.

**Verification:**
- Active plugin-skills hierarchy uses Pierre Trees or has a documented no-go.
- Legacy skills tree files are either deleted as unused or explicitly classified.

- [ ] **Unit 6: Audit non-file tree surfaces and remove old code**

**Goal:** Make sure "all tree we are using" has been handled honestly, without leaving dead local tree code behind.

**Requirements:** R7, R8

**Dependencies:** Units 2-5

**Files:**
- Modify: `packages/ui/src/components/git-viewer/index.ts`
- Modify: `packages/ui/src/index.ts`
- Modify or delete if unused: `packages/ui/src/components/git-viewer/file-tree-logic.ts`
- Modify or delete if unused: `packages/desktop/src/lib/acp/components/file-list/file-list-logic.ts`
- Modify or delete if unused: `packages/desktop/src/lib/acp/components/file-list/file-list-types.ts`
- Modify or delete if unused: `packages/desktop/src/lib/skills/components/skills-tree.svelte`
- Modify or delete if unused: `packages/desktop/src/lib/skills/components/skills-tree-item.svelte`
- Modify: `packages/desktop/src/lib/skills/components/index.ts`
- Test: existing affected tests under `packages/ui/src/**` and `packages/desktop/src/**`

**Approach:**
- Search for remaining local `Tree`, `FileTree`, `flattenFileTree`, and recursive tree components.
- Classify each remaining hit:
  - migrated to Pierre,
  - not actually a tree,
  - intentionally excluded because it is a rich session/canonical surface.
- Do not delete helpers still used by non-migrated code.
- Keep the sidebar decision explicit in the final implementation notes.

**Test scenarios:**
- Test expectation: none for pure dead-code deletion, but affected component tests must still pass.

**Verification:**
- Repo search shows no leftover local file-tree renderer for migrated surfaces.
- Any remaining "tree" code has a written reason.

- [ ] **Unit 7: Verification and UI QA**

**Goal:** Prove the replacement works in tests and in the running Acepe dev app.

**Requirements:** R8

**Dependencies:** Units 1-6

**Files:**
- Modify if needed: `packages/desktop/scripts/acepe-qa/*`
- Evidence output: `.codex/state/ui-qa-evidence.json`

**Approach:**
- Run `packages/ui` tests.
- Run `packages/desktop` TypeScript check.
- Run scoped desktop tests for file explorer and skills tree.
- Run website verification for Git and SQL Studio demos after shared `@acepe/ui` changes.
- Run Acepe QA wrapper for visible surfaces:
- `bun run qa doctor`
- observe the running app
- add or use a QA selector primitive that can inspect/click inside the Pierre shadow root before calling the migration complete
- inspect a Git file tree row inside the shadow root, including row text, selected state, git status, diff decoration, action trigger, and focus-visible state
- click a Git file row and verify the diff/selection changed
- trigger stage/unstage/discard through the new action surface when actions exist
- inspect the project file system dialog tree row inside the shadow root, including row text, selected state, status, and aggregate diff decoration
- click a project file row and verify the preview path changed
- inspect SQL Studio schema rows if migrated, including table row, column row, primary-key indication, and data type
- inspect the skills manager tree area if migrated, including plugin row, plugin skill row, and selected state
- screenshot visual surfaces after the change

**Test scenarios:**
- Integration: Git panel tree is visible and selecting a file updates the diff/selection.
- Integration: File system dialog tree is visible and selecting a file updates the preview path.
- Integration: Skills tree is visible and selecting a skill updates the editor/details pane, if migrated.
- Integration: SQL Studio tree is visible and selecting a table updates the selected table.
- Edge case: empty tree states remain readable and do not throw.
- Accessibility: tree/treeitem semantics or Pierre equivalent are present, folder rows expose expansion state, keyboard selection/expansion works, row actions are keyboard reachable, and diff/metadata decorations have accessible labels beyond `title` alone.

**Verification:**
- `bun run check` passes in `packages/desktop`.
- `bun test` passes in `packages/ui`.
- Scoped desktop tests for file explorer and plugin skills pass when those surfaces are touched.
- Website check/build passes for demos that import changed shared UI.
- QA evidence includes DOM inspect output and screenshots for changed visible surfaces.

## System-Wide Impact

- **Interaction graph:** Git row actions and file selection callbacks change from Svelte row snippets to Pierre tree callbacks/action descriptors.
- **Error propagation:** Pierre mount failures should render a small fallback error in the tree area, not crash the whole panel.
- **State lifecycle risks:** The adapter must clean up old Pierre instances so shadow DOM and listeners do not leak.
- **State ownership risks:** Tree expansion stays local to the presentational tree unless a controller already owns it. Do not split expansion truth between Pierre and a desktop store.
- **API surface parity:** `GitFileTree` public behavior should stay compatible for current consumers, except row actions become typed descriptors where Svelte snippets cannot work inside shadow DOM.
- **Integration coverage:** Git panel and file explorer need DOM/QA checks because shadow DOM can pass unit tests while still looking wrong.
- **Unchanged invariants:** Session canonical data, transcript order, provider data, project sorting, and session row internals are not changed.

## Rollback / Go-No-Go Strategy

- Keep old renderers and helper code until each migrated surface passes unit tests and running-app QA.
- Gate deletion in Unit 6, after Git, file explorer, SQL Studio, and plugin-skills decisions are complete.
- If a surface fails visual, accessibility, or action parity, keep its old renderer and record a no-go note instead of normalizing a worse tree.
- Because `@pierre/trees` is beta, do one real running-app mount smoke test before deleting any old renderer.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `@pierre/trees` is beta | Keep wrapper small, version pinned, and avoid depending on private internals. |
| Shadow DOM blocks existing Svelte snippets | Use typed action descriptors and Pierre context-menu/action hooks instead of mounting Svelte snippets inside rows. |
| Visual styling differs from Acepe rows | Start with CSS variables, then add narrow `unsafeCSS` after screenshots. |
| Sidebar gets worse if forced into path tree | Exclude it from this pass and record the decision. |
| Package peer dependencies add React to lockfile | Use only root vanilla import; do not import `@pierre/trees/react`. |
| Dirty worktree overlaps touched files | Read diffs for touched files before editing and do not revert unrelated user changes. |
| Pierre cannot preserve SQL or plugin-skill metadata clarity | Keep the existing renderer for that surface and record a no-go note. |

## Documentation / Operational Notes

- Mention in the final implementation summary that Acepe uses `@pierre/trees` through the vanilla API, not React.
- If SQL Studio or plugin skills are not migrated, record the reason in `docs/solutions/` or the implementation notes so "all tree" remains auditable.
- If QA friction appears for shadow DOM inspection, improve the QA wrapper before repeating the same manual steps.

## Alternative Approaches Considered

- **Use React wrapper in Acepe:** rejected because Acepe is Svelte and the root package has a vanilla API.
- **Wrap every tree-like surface, including the session sidebar:** rejected for this pass because the sidebar is a rich canonical session projection, not a path-first file tree.
- **Migrate unused legacy `skills-tree.svelte` first:** rejected because the active skills UI uses `PluginSkillsSection`; unused exports are cleanup candidates.
- **Keep local tree code and only style it like Pierre:** rejected because the user asked to use the Pierre package and duplicate tree logic would remain.
- **Use web components entry point directly:** deferred. The vanilla class gives clearer lifecycle control inside Svelte.

## Success Metrics

- `GitFileTree` no longer owns local build/flatten tree logic.
- Project file system dialog no longer owns local build/flatten tree rendering.
- SQL Studio schema tree is migrated or documented as not fitting the path-tree package.
- Active plugin-skills hierarchy is migrated or documented as not fitting the path-tree package.
- Unused legacy skills tree exports are removed or classified.
- No `@pierre/trees/react` import exists.
- UI tests and QA evidence prove the migrated trees render and select correctly.

## Sources & References

- Related requirement context: `docs/brainstorms/2026-06-28-solid-sidebar-rebuild-requirements.md`
- Related Svelte guidance: `svelte-core-bestpractices`
- Related UI extraction guidance: `extract-to-ui-package`
- Related architecture gate: `god-architecture-check`
- Package inspected: `@pierre/trees@1.0.0-beta.5`
