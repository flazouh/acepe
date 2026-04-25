---
title: feat: Build embedded Cmd+I file explorer modal
type: feat
status: active
date: 2026-03-24
---

# feat: Build embedded Cmd+I file explorer modal

## Enhancement Summary

**Deepened on:** 2026-03-24
**Sections enhanced:** architecture, data contracts, implementation phases, accessibility, performance, risks, sources
**Research inputs used:** local Acepe patterns, WAI-ARIA APG modal dialog guidance, WAI-ARIA APG listbox guidance, Tauri 2 command docs, Virtua documentation, parallel subagent review passes (performance, security, user-flow, framework docs, repo-fit, architecture synthesis)

### Key Improvements

1. Tightened the backend contract so explorer ranking can reuse cached index data without rescanning, while still carrying the extra metadata the modal needs.
2. Added explicit accessibility and virtualization guidance so the modal stays keyboard-correct and screen-reader-correct even when only a windowed slice of rows is mounted.
3. Added Rust-side safety and preview-threshold guidance so explorer commands stay path-safe, async-friendly, and resistant to large/binary/stale-preview failures.
4. Tightened ownership and overlay-state decisions so the modal binds to a single panel/project snapshot, degrades safely when that owner disappears, and fits the existing `MainAppViewState` overlay architecture.

### New Considerations Discovered

- The current `scan_project` path only records `path`, `extension`, and `line_count`, so Phase 1 should explicitly expand cached file metadata or add a derived explorer cache layer before the proposed row contract can exist.
- The current `EmbeddedModalShell` already provides `role="dialog"`, `aria-modal`, backdrop click, and `Escape` handling, but the explorer still needs explicit initial focus placement, focus restoration, and tab containment logic at the feature layer.
- Virtualized list accessibility needs deliberate `aria-activedescendant` or equivalent `aria-posinset` / `aria-setsize` support because many options will not exist in the DOM at once.
- Offset-based paging alone is not enough for ranked search on large repos; Phase 1 should either use a bounded top-K search path for the visible window or add cursor/anchor semantics so deep paging does not rescore the entire corpus on every request.

## Overview

Build an extremely performant embedded-style file explorer modal for Acepe desktop that opens with `Cmd+I`, feels native to the app's existing header/footer chrome, behaves like a real explorer instead of the current lightweight `@` picker, and can still insert the selected file into the currently active composer.

The implementation should reuse the repo's existing strengths where they fit - file indexing, attached file panels, Pierre-based file rendering, embedded modal chrome, and panel-scoped agent input - while explicitly moving ranking, filtering, preview classification, and expensive file calculations to Rust. The current inline picker stays for `@` mentions, but the new modal becomes the high-performance explorer surface.

## Problem Statement

Acepe already has several related primitives, but they are split across surfaces and optimized for narrower jobs:

- The inline picker in `packages/desktop/src/lib/acp/components/file-picker/file-picker-dropdown.svelte:1` is a small dropdown that still performs fuzzy ranking in TypeScript via `packages/desktop/src/lib/acp/utils/fuzzy-match.ts:1`, which violates the new Rust-side ranking requirement.
- The current preview in `packages/desktop/src/lib/acp/components/file-picker/file-preview.svelte:1` can render file contents and diffs, but it is tied to the dropdown, uses frontend-side orchestration, and has no strong preview classification contract for large/binary/unrenderable files.
- The file index backend in `packages/desktop/src-tauri/src/file_index/service.rs:1`, `packages/desktop/src-tauri/src/file_index/scanner.rs:1`, `packages/desktop/src-tauri/src/file_index/git.rs:1`, and `packages/desktop/src-tauri/src/file_index/commands.rs:1` already gives fast project file inventory plus git metadata, but it only exposes coarse commands such as `get_project_files` and `get_file_diff`.
- Attached file panes already exist in `packages/desktop/src/lib/components/main-app-view/components/content/agent-attached-file-pane.svelte:1` and `packages/desktop/src/lib/acp/store/panel-store.svelte.ts:881`, so the new explorer should integrate with that ownership model instead of inventing a parallel file-opening path.
- Global and app-level keyboard handling already lives in `packages/desktop/src/lib/components/main-app-view.svelte:363` and `packages/desktop/src/lib/components/main-app-view/logic/managers/keybinding-manager.ts:1`, so `Cmd+I` should be registered through the shared keybinding system, not as another ad hoc `window` listener.

## Proposed Solution

Add a new embedded modal file explorer that is panel-aware, project-aware, and split into a Rust-backed search pipeline plus a Svelte rendering shell:

- A new Rust command pair will provide explorer search results and preview payloads tuned for the modal.
- A new Svelte modal will use `EmbeddedModalShell` plus embedded header/footer patterns so it visually matches the app chrome used by agent panels and other embedded surfaces.
- The modal left pane will be a virtualized results list with extension icons, git diff metadata, and keyboard-first navigation.
- The right pane will render selected-file previews, using Pierre diff for changed text files when safe, and dedicated fallback cards for binary, deleted, too-large, and unsupported content.
- The modal will support two main actions: insert selected file into the active composer, and open the file in the existing attached file pane workflow.
- The existing inline `@` picker remains for lightweight inline mention flows, but can later reuse some shared preview/result primitives after this modal lands.

## Architecture

### UI ownership

- Keep modal ownership at the main app level so `Cmd+I` works globally, but drive target behavior from the currently focused panel.
- The focused agent panel supplies the effective `projectPath`, `panelId`, and active composer target.
- If there is no focused agent panel with a project, the shortcut should no-op with a toast or disabled empty state instead of opening a broken explorer.
- Snapshot the owner panel/project on open instead of live-switching as focus changes; if that owner becomes invalid while the modal is open, show an inline disabled-state banner and disable insert/open actions.

Research insights:

- Capture the element that had focus before opening and restore focus there on close unless that element has been removed; this matches WAI-ARIA modal dialog guidance and avoids dumping focus at document start.
- Keep modal-open state at the same layer that already controls app overlays so the existing `modalOpen` keybinding context can suppress conflicting shortcuts while the explorer is active.
- Resolve the focused panel lazily at open time and again before destructive actions (`Enter`, `Cmd+Enter`) so closing or switching panels while the modal is open cannot leave stale owner references behind.
- Repo-fit note: the current app centralizes overlay state in `packages/desktop/src/lib/components/main-app-view/logic/main-app-view-state.svelte.ts:1`, so the modal should be modeled there first and rendered through the existing `panels-container` / overlay composition instead of adding standalone state directly in `main-app-view.svelte`.

### Rust / frontend boundary

Rust owns:

- query normalization
- ranking and filtering
- result slicing / limiting
- git metadata joining
- preview eligibility classification
- diff/content loading decisions
- safe fallbacks for binary/large/unrenderable/deleted states

Frontend owns:

- modal state and layout
- keyboard focus management
- virtualized rendering of already-ranked results
- invoking Rust commands and ignoring stale responses
- displaying Pierre components when backend says preview is safe
- inserting the chosen file token into the active composer
- opening the chosen file via the existing attached-file panel flow

Research insights:

- Keep the new explorer commands in `packages/desktop/src-tauri/src/file_index/commands.rs` as separate module commands, not inline `lib.rs` commands, because Tauri command names are global and the existing repo already organizes file-index commands there.
- Keep command inputs owned (`String`, structs with owned strings) and async, which matches Tauri 2 guidance for commands doing file-system and git work.
- Reuse the existing command-side project/path validation helpers for both search and preview so the explorer inherits the same path-safety guarantees as `read_file_content`, `rename_path`, and related commands.
- Build explorer ranking over cached `ProjectIndex` data instead of mutating the base index ordering in place; the current cache is also used by the inline picker and other surfaces, so explorer-specific sorting should stay surface-local on the Rust side.
- Do not reuse the existing smart-path fallback behavior for preview/open actions. Explorer actions should accept only validated project-relative paths emitted by explorer search, or a future opaque row token/session token derived from those rows.
- Clamp `query`, `limit`, and `offset` in Rust and fail closed on oversized requests so a bad frontend call cannot force expensive full-corpus ranking or giant payload serialization.

### Reuse vs replacement

Keep and reuse:

- `packages/desktop/src/lib/components/ui/embedded-modal-shell.svelte:1`
- `packages/desktop/src/lib/acp/store/panel-store.svelte.ts:881`
- `packages/desktop/src/lib/components/main-app-view/components/content/agent-attached-file-pane.svelte:1`
- `packages/desktop/src/lib/acp/components/file-panel/file-panel-read-view.svelte:1`
- `packages/desktop/src/lib/acp/components/diff-viewer/pierre-diff-view.svelte:1`
- `packages/desktop/src-tauri/src/file_index/service.rs:1`

Do not reuse directly as the core explorer engine:

- `packages/desktop/src/lib/acp/components/file-picker/file-picker-dropdown.svelte:1`
- `packages/desktop/src/lib/acp/utils/fuzzy-match.ts:1`

Reason: the dropdown is intentionally small and frontend-ranked; the modal needs a dedicated architecture.

Research insights:

- Reuse existing Pierre renderer setup and highlighter pooling patterns from `packages/desktop/src/lib/acp/components/file-panel/file-panel-read-view.svelte:1` instead of creating a second preview engine with different caching or theming behavior.
- Reuse existing file icon treatment from `packages/desktop/src/lib/acp/components/file-picker/file-picker-item.svelte:1`, but keep explorer rows non-interactive beyond row selection so the listbox remains accessible.

## Data Contracts

Add Rust types in `packages/desktop/src-tauri/src/file_index/types.rs` and export them to `packages/desktop/src/lib/services/converted-session-types.ts` via the existing specta export in `packages/desktop/src-tauri/src/session_jsonl/export_types.rs:1`.

### Search request

```ts
type FileExplorerSearchRequest = {
  projectPath: string;
  query: string;
  limit: number;
  offset: number;
  ownerPanelId: string | null;
};
```

Notes:

- `limit` and `offset` allow virtualization-friendly incremental loading.
- `ownerPanelId` is optional metadata for analytics/logging/future recents, not for ranking.

### Search result row

```ts
type FileExplorerRow = {
  path: string;
  fileName: string;
  extension: string;
  pathSegments: string[];
  gitStatus: FileGitStatus | null;
  isTracked: boolean;
  isBinary: boolean;
  lastModifiedMs: number | null;
  sizeBytes: number | null;
  previewKind: "text" | "diff" | "binary" | "large" | "deleted" | "unsupported";
};
```

Research insights:

- `fileName`, `pathSegments`, `sizeBytes`, and `lastModifiedMs` are not present in the current `IndexedFile` cache shape, so Phase 1 should explicitly add them to cached index metadata or define an explorer-specific cached projection in Rust.
- Add an implicit stable identity rule: the frontend should key rows by `path`, and Rust should keep tie-breaking deterministic (`path` ascending after score and git-priority) so virtualization does not thrash measured row state.
- Keep `previewKind` on the row even if preview data is loaded later; this allows the list to show binary/large/deleted affordances immediately and avoids frontend guesswork.

### Search response

```ts
type FileExplorerSearchResponse = {
  projectPath: string;
  query: string;
  total: number;
  rows: FileExplorerRow[];
};
```

### Preview request

```ts
type FileExplorerPreviewRequest = {
  projectPath: string;
  filePath: string;
};
```

### Preview response

```ts
type FileExplorerPreviewResponse =
  | {
      kind: "diff";
      filePath: string;
      fileName: string;
      oldContent: string | null;
      newContent: string;
      gitStatus: FileGitStatus;
    }
  | {
      kind: "text";
      filePath: string;
      fileName: string;
      content: string;
      languageHint: string | null;
    }
  | {
      kind: "binary" | "large" | "unsupported" | "deleted" | "unrenderable";
      filePath: string;
      fileName: string;
      reason: string;
      sizeBytes: number | null;
      gitStatus: FileGitStatus | null;
    };
```

Decision: preview classification is explicit and one-way. The frontend should never guess whether to call Pierre or whether a file is safe to read.

Research insights:

- Add central Rust thresholds/constants for preview classification (`max_preview_bytes`, binary sniff budget, max diff size) so tests and UI stay aligned when thresholds evolve.
- Treat renamed or deleted git states as explicit fallback outcomes unless both the old and current working-tree paths are provably readable inside the validated project root.
- Keep preview errors serializable and user-readable at the contract boundary so the modal can degrade inline instead of turning rapid selection changes into toast spam.

## Exact Files To Inspect / Modify / Create

### Existing files to inspect closely

- `packages/desktop/src/lib/acp/components/file-picker/file-picker-dropdown.svelte:1`
- `packages/desktop/src/lib/acp/components/file-picker/file-preview.svelte:1`
- `packages/desktop/src/lib/acp/components/file-picker/file-picker-item.svelte:1`
- `packages/desktop/src/lib/acp/components/agent-input/state/agent-input-state.svelte.ts:360`
- `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte:389`
- `packages/desktop/src/lib/acp/store/panel-store.svelte.ts:881`
- `packages/desktop/src/lib/components/main-app-view.svelte:363`
- `packages/desktop/src/lib/components/main-app-view/logic/main-app-view-state.svelte.ts:1`
- `packages/desktop/src/lib/components/main-app-view/logic/managers/keybinding-manager.ts:52`
- `packages/desktop/src/lib/components/main-app-view/components/content/panels-container.svelte:1`
- `packages/desktop/src/lib/components/ui/embedded-modal-shell.svelte:1`
- `packages/desktop/src/lib/components/changelog-modal/changelog-modal.svelte:220`
- `packages/desktop/src/lib/acp/components/diff-viewer/diff-viewer-modal.svelte:147`
- `packages/desktop/src/lib/components/main-app-view/components/content/agent-attached-file-pane.svelte:1`
- `packages/desktop/src/lib/acp/components/file-panel/file-panel.svelte:120`
- `packages/desktop/src/lib/acp/components/file-panel/file-panel-read-view.svelte:1`
- `packages/desktop/src-tauri/src/file_index/types.rs:1`
- `packages/desktop/src-tauri/src/file_index/service.rs:47`
- `packages/desktop/src-tauri/src/file_index/commands.rs:91`
- `packages/desktop/src-tauri/src/file_index/scanner.rs:11`
- `packages/desktop/src-tauri/src/file_index/git.rs:12`
- `packages/desktop/src-tauri/src/lib.rs:66`
- `packages/desktop/src-tauri/src/session_jsonl/export_types.rs:20`

### Files likely to modify

- `packages/desktop/src/lib/keybindings/constants.ts`
- `packages/desktop/src/lib/keybindings/bindings/defaults.ts`
- `packages/desktop/src/lib/components/main-app-view/logic/managers/keybinding-manager.ts`
- `packages/desktop/src/lib/components/main-app-view/logic/main-app-view-state.svelte.ts`
- `packages/desktop/src/lib/components/main-app-view.svelte`
- `packages/desktop/src/lib/components/main-app-view/components/content/panels-container.svelte`
- `packages/desktop/src/lib/utils/tauri-client/commands.ts`
- `packages/desktop/src/lib/utils/tauri-client/file-index.ts`
- `packages/desktop/src/lib/services/converted-session-types.ts` (generated)
- `packages/desktop/src/lib/acp/components/agent-input/state/agent-input-state.svelte.ts`
- `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte`
- `packages/desktop/src/lib/acp/components/file-panel/file-panel-read-view.svelte`
- `packages/desktop/src-tauri/src/file_index/types.rs`
- `packages/desktop/src-tauri/src/file_index/service.rs`
- `packages/desktop/src-tauri/src/file_index/commands.rs`
- `packages/desktop/src-tauri/src/file_index/mod.rs`
- `packages/desktop/src-tauri/src/lib.rs`
- `packages/desktop/src-tauri/src/session_jsonl/export_types.rs`

### Files likely to create

- `packages/desktop/src/lib/acp/components/file-explorer-modal/file-explorer-modal.svelte`
- `packages/desktop/src/lib/acp/components/file-explorer-modal/file-explorer-modal-state.svelte.ts`
- `packages/desktop/src/lib/acp/components/file-explorer-modal/file-explorer-results-list.svelte`
- `packages/desktop/src/lib/acp/components/file-explorer-modal/file-explorer-result-row.svelte`
- `packages/desktop/src/lib/acp/components/file-explorer-modal/file-explorer-preview-pane.svelte`
- `packages/desktop/src/lib/acp/components/file-explorer-modal/file-explorer-preview-fallback.svelte`
- `packages/desktop/src/lib/acp/components/file-explorer-modal/index.ts`
- `packages/desktop/src/lib/acp/components/file-explorer-modal/__tests__/file-explorer-modal.svelte.vitest.ts`
- `packages/desktop/src/lib/acp/components/file-explorer-modal/__tests__/file-explorer-modal-state.test.ts`
- `packages/desktop/src-tauri/src/file_index/explorer.rs`
- `packages/desktop/src-tauri/src/file_index/explorer_tests.rs` or inline `#[cfg(test)]` blocks in `explorer.rs`

If preview rendering logic becomes duplicated, create a shared component instead:

- `packages/desktop/src/lib/acp/components/file-preview/pierre-file-preview.svelte`

## Implementation Phases

### Phase 1: Contract and backend foundation

Goal: get Rust-side search and preview contracts in place before any modal UI logic.

Tasks:

- Add new explorer request/response structs to `packages/desktop/src-tauri/src/file_index/types.rs`.
- Create `packages/desktop/src-tauri/src/file_index/explorer.rs` with:
  - query normalization
  - scoring/ranking
  - result limiting/windowing
  - preview classification
  - preview payload loading
- Extend `FileIndexService` in `packages/desktop/src-tauri/src/file_index/service.rs` to expose cached explorer search primitives instead of rescanning every keystroke.
- Add an explorer-specific cached projection or token table in Rust so query-time ranking does not repeatedly normalize/split every path on every keystroke.
- Add new Tauri commands in `packages/desktop/src-tauri/src/file_index/commands.rs`:
  - `search_project_files_for_explorer`
  - `get_file_explorer_preview`
- Register commands in `packages/desktop/src-tauri/src/lib.rs`.
- Export new specta types through `packages/desktop/src-tauri/src/session_jsonl/export_types.rs`.

Test-first tasks:

- Add Rust tests for search ordering:
  - exact filename beats path substring
  - modified files stay strongly ranked for empty query
  - stable ordering for same-score results
- Add Rust tests for preview classification:
  - modified text file -> `diff`
  - unchanged text file -> `text`
  - binary file -> `binary`
  - very large text file -> `large`
  - deleted/renamed edge cases return safe fallback

Research insights:

- Expand `scan_project` or an adjacent explorer cache builder to persist `file_name`, `path_segments`, `size_bytes`, `last_modified_ms`, and a cheap binary hint; the current scanner only records extension and path, so the proposed row contract cannot be derived without more metadata.
- Use a cheap empty-query ranking path over cached files: modified tracked files first, then shorter / shallower paths, then alphabetical tie-breaks. This keeps the first open cheap and matches the repo's existing modified-first intuition in `FileIndexService`.
- Reuse `validate_project_path_for_indexing` and `validate_path_within_project` before any preview read so the new preview command does not become a looser side door than existing file-index commands.
- Keep preview loading split into two phases in Rust: classify first using metadata and git status, then read content only when the final kind requires it.
- Add hard guardrails in Rust for explorer requests: bounded query length, bounded page size, bounded preview bytes, bounded diff bytes/changed lines, and explicit no-smart-fallback path resolution.
- Add request-cancellation or supersession semantics for preview/search work so rapid keyboard navigation does not queue many wasted file-system and git reads.

### Phase 2: Tauri client and app wiring

Goal: expose backend commands cleanly to Svelte and hook the modal into app state.

Tasks:

- Add command constants to `packages/desktop/src/lib/utils/tauri-client/commands.ts`.
- Add typed wrappers to `packages/desktop/src/lib/utils/tauri-client/file-index.ts`.
- Regenerate `packages/desktop/src/lib/services/converted-session-types.ts` and `packages/desktop/src/lib/services/command-names.ts` using the existing Rust test exporters.
- Add a new keybinding action to `packages/desktop/src/lib/keybindings/constants.ts`, e.g. `FILE_EXPLORER_TOGGLE`.
- Add the default shortcut to `packages/desktop/src/lib/keybindings/bindings/defaults.ts` as `$mod+i`.
- Register the action in `packages/desktop/src/lib/components/main-app-view/logic/managers/keybinding-manager.ts`.
- Host modal open state in `packages/desktop/src/lib/components/main-app-view/logic/main-app-view-state.svelte.ts` and render it through the existing main-app / panels-container overlay composition.
- Explicitly wire the `modalOpen` keybinding context while the explorer is visible; the repo has a generic `modalOpen` binding condition, but this feature must set that context itself.
- Resolve the target context from the focused panel:
  - focused agent panel id
  - focused project path
  - whether composer insertion is available

Decision: keep modal state in `MainAppViewState` instead of burying it inside `AgentInputState`, because `Cmd+I` is global and must resolve against whichever panel is currently focused.

Research insights:

- Add the default shortcut in `packages/desktop/src/lib/keybindings/bindings/defaults.ts:1` as `$mod+i`, which preserves the project's existing cross-platform pattern used for `$mod+p`, `$mod+b`, and other shared actions.
- Register a dedicated keybinding action ID instead of piggybacking on command-palette actions so user overrides, labels, and telemetry stay distinct.
- Keep the modal state machine sequence-aware: opening should snapshot the focused panel and previous focus target, but action handlers should still re-check that insertion/opening is still legal before mutating panel or composer state.
- Repo-fit note: do not assume generated `command-names.ts` support for explorer commands. Today the file-index Tauri command names are maintained manually in `packages/desktop/src/lib/utils/tauri-client/commands.ts`, so update that file unless the Rust command-name export system is explicitly expanded.

### Phase 3: Modal shell and results UX

Goal: build the explorer UI using embedded chrome and fast list rendering.

Tasks:

- Create `packages/desktop/src/lib/acp/components/file-explorer-modal/file-explorer-modal.svelte` using `EmbeddedModalShell`.
- Use header/footer chrome inspired by:
  - `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-header.svelte:63`
  - `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-footer.svelte:62`
  - `packages/desktop/src/lib/acp/components/add-repository/open-project-dialog.svelte:292`
- Create a split layout:
  - left = search bar + virtualized result list
  - right = preview pane + fallback states
  - bottom footer = primary actions and shortcut hints
- Use extension icons per row, reusing the same icon strategy as `packages/desktop/src/lib/acp/components/file-picker/file-picker-item.svelte:34` or `@acepe/ui` file icon helpers.
- Show git status letter and diff pill per row.
- Preserve the app's embedded feel: dense controls, 7px-ish header/footer bars, muted borders, no generic floating-command-palette styling.

Performance tasks:

- Use a virtualized list so the frontend only renders visible rows.
- Request only the visible result window from Rust; do not ship the entire file index into modal-local JS state for filtering.
- Ignore stale search responses by request token / sequence id.
- Use fixed or tightly bounded row heights so virtualization cost stays dominated by visible rows instead of repeated measurement churn.
- Do not rely on naive deep `offset` paging for ranked search without a bounded top-K or cursor strategy.

Research insights:

- `virtua` is already in the workspace and supports dynamic measurement in Svelte 5, so prefer the same `VList` family already used elsewhere in the repo over introducing another virtualizer.
- Reuse the repo's strongest existing Virtua pattern in `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte:1` for mounting, key stability, and fallback behavior.
- Key virtual rows by file path, never by list index; the Virtua docs call out key stability as required for correct item measurement and resize handling.
- Start with a conservative buffer size because each row carries icons and git metadata while the right pane is doing expensive preview work; raise it only if scroll testing shows visible pop-in.
- Keep list items presentational and let the listbox container own keyboard focus via `aria-activedescendant`, which works better with virtualization than moving DOM focus into rows that may unmount.
- Keep the active option mounted or otherwise guaranteed addressable while using `aria-activedescendant`; do not let virtualization unmount the active row reference.

### Phase 4: Preview pane and safe fallbacks

Goal: make preview behavior production-safe without breaking Pierre on difficult files.

Tasks:

- Create `file-explorer-preview-pane.svelte` to render by `FileExplorerPreviewResponse.kind`.
- For `diff`, render Pierre unified diff using the same configuration principles as `packages/desktop/src/lib/acp/components/file-panel/file-panel-read-view.svelte:53`.
- For `text`, render Pierre file view or a shared read-only text preview component.
- For fallback kinds, render a dedicated fallback card with:
  - reason
  - file path
  - size if known
  - git metadata if present
  - action buttons for `Open attached pane` and `Insert reference anyway`
- Reuse existing large-patch thinking from `packages/desktop/src/lib/acp/components/git-panel/pr-diff-preview-mode.ts:1`, but move the actual thresholding decision to Rust.
- Clamp preview payload sizes before serialization back to the frontend; large/binary/unrenderable outcomes should return compact fallback payloads, not giant strings that the UI later declines to render.

Decision: the explorer preview should not directly call `read_file_content` / `get_file_diff` from component code. It should consume the single preview contract from Rust.

Research insights:

- Carry a monotonically increasing preview request sequence in modal state and discard any response older than the latest selected row; this prevents stale diff flashes during rapid arrow navigation.
- Reuse the existing Pierre theme registration and highlighter pool patterns from file-panel views so preview rendering cost remains worker-backed and visually consistent.
- Treat fallback cards as first-class previews rather than error placeholders; they should still expose useful file metadata and actions so binary / large files do not become dead ends.
- Preview content must remain inert code/text. Do not introduce HTML / markdown / SVG rendering paths in this modal.

### Phase 5: Composer insertion and attached-pane integration

Goal: make the explorer useful both as a dedicated explorer and as an input helper.

Tasks:

- Add a modal callback from `main-app-view` into the focused agent panel's input/composer.
- Reuse the existing insertion semantics from `packages/desktop/src/lib/acp/components/agent-input/state/agent-input-state.svelte.ts:898`, which currently inserts `@[file:path]`.
- Expose an explicit method on the agent input state or UI to insert a file token from outside the inline dropdown flow; avoid faking textarea key events.
- Reuse `panelStore.openFilePanel(filePath, projectPath, { ownerPanelId })` from `packages/desktop/src/lib/acp/store/panel-store.svelte.ts:881` when the user chooses to open the file in the attached pane.

Decision: implement a small explicit composer API such as `insertFileReference(path: string)` rather than coupling the modal to `fileStartIndex` / `showFileDropdown` state.

Research insights:

- Mirror the existing `handleFileSelect` token shape exactly (`@[file:path]`) so the modal and inline picker remain serialization-compatible.
- Put the new external insertion API on the input state or a thin panel-facing facade, not on the textarea DOM element, so the feature works for future composer implementations that are not raw textarea-backed.
- Keep `Cmd+Enter` wired directly to `panelStore.openFilePanel(filePath, projectPath, { ownerPanelId })` so attached-pane ownership semantics stay centralized.
- Open-in-pane should reuse/focus an existing attached file pane for that owner/file when possible instead of creating duplicates.

### Phase 6: Polish, accessibility, and regression coverage

Goal: ship a modal that is fast, keyboard-solid, and non-regressive.

Tasks:

- Add ARIA dialog semantics, labelled search input, listbox/option roles, and live selected-row announcement if needed.
- Restore focus to the previously focused composer or panel when closing.
- Ensure `Escape` closes the modal, unless a nested control needs it first.
- Ensure the search field autofocuses on open.
- Ensure arrow keys move rows; `PageUp/PageDown` jump; `Home/End` go to bounds.
- Ensure `Enter` inserts into composer.
- Ensure `Cmd+Enter` opens attached pane for the selected file.
- Ensure `Tab` cycles interactive controls without losing list selection state.
- Ensure empty state, loading state, no-project state, and no-results state are visually distinct.

Research insights:

- Use an explicit dialog title and wire it with `aria-labelledby`; only add `aria-describedby` if the final modal intro text stays short and unstructured.
- Provide a visible close control inside the modal in addition to `Escape`; this is a strong recommendation in the WAI-ARIA modal dialog pattern.
- Because the result list is virtualized, either keep DOM focus on the search/listbox container with `aria-activedescendant` or add `aria-setsize` and `aria-posinset` for mounted options so screen readers get stable position feedback.
- Treat selection as "focus follows selection" inside the results list so preview updates with arrow navigation, but keep activation on `Enter` and attached-pane opening on `Cmd+Enter`.
- Add explicit user-flow decisions: `Cmd+I` toggles the modal closed when already open; opening with a project but no active composer is allowed in browse-only mode with Insert disabled; `Enter` inserts then closes and restores focus to the composer; `Cmd+Enter` opens/focuses the attached pane then closes and shifts focus to that pane.
- If the owner panel/project/composer disappears while the modal is open, keep the modal visible long enough to explain the state, but disable actions until the user closes it.

## Keyboard and Accessibility Expectations

- `Cmd+I` / `Ctrl+I`: toggle modal from the shared keybinding system.
- On open, focus lands in the search input.
- Up/Down: move active row.
- `PageUp` / `PageDown`: large list movement.
- `Home` / `End`: first/last row.
- `Enter`: insert selected file into active composer.
- `Cmd+Enter` / `Ctrl+Enter`: open selected file in the currently focused agent panel's attached file pane.
- `Escape`: close modal and restore focus to the prior control.
- Search field should expose `aria-controls` for the result list.
- Results list should use `role="listbox"`; rows should use `role="option"` with `aria-selected`.
- Preview fallback cards should be screen-reader readable and not rely on color alone.
- The dialog container should expose a visible title via `aria-labelledby` and keep focus trapped within the modal while open.
- If virtualization means only a slice of rows is mounted, the active option should still expose stable position information via `aria-activedescendant` and `aria-setsize` / `aria-posinset`.
- Clearing the query resets the empty-query ranking window and reselects the first result.
- If the result list is empty, navigation keys become no-ops and the empty state remains focus-stable.

## Performance Strategy

### Search

- Reuse cached project index from `FileIndexService` instead of rescanning on each keystroke.
- Perform scoring and sorting in Rust only.
- Return only the visible result window from Rust, using a bounded top-K / cursor-friendly ranking strategy so deep navigation does not degenerate into full-corpus rescoring.
- Add a cheap fast path for empty query: modified files first, then recently meaningful/shorter paths, then alphabetical stability.
- Debounce only the network boundary if needed; do not debounce keyboard selection movement inside already-loaded rows because that makes explorer navigation feel laggy.
- Add measurable search guardrails: empty-query first page p95 under 50ms on a warm cache, typed-query first page p95 under 75ms, and worst-case warm large-repo search under 150ms.

### Preview

- Fetch preview only for the currently selected row.
- Ignore stale preview responses when selection changes quickly.
- Do preview classification in Rust before reading heavy content.
- Avoid loading binary blobs or giant text files into Pierre.
- Preserve worker-backed syntax highlighting by reusing Pierre/highlighter infrastructure already used in the repo.
- Treat preview reads as async Tauri commands returning serialized fallbacks instead of letting the frontend chain multiple lower-level calls.
- Add explicit preview cancellation/coalescing so only the latest selected row owns an active preview request.
- Add measurable preview guardrails: warm text preview p95 under 100ms, cold text preview under 200ms, and hard caps for file bytes, diff bytes, and changed-line counts before Pierre rendering is attempted.

### UI rendering

- Virtualize the result list.
- Keep row components stateless and keyed by file path.
- Keep modal mounted only while open; do not keep a large hidden result tree alive.
- Expect first-measure virtualization edge cases: Virtua documents that viewport size can be `0` until ResizeObserver runs, so keep the initial empty/loading state tolerant of one-frame measurement lag.
- If dev-only `ResizeObserver loop completed with undelivered notifications` warnings appear during resizing, treat them as known virtualization noise unless user-visible layout regressions accompany them.
- Keep row height fixed or tightly bounded so list performance stays predictable during icon/git badge updates.

## System-Wide Impact

### Interaction graph

- `Cmd+I` keybinding -> keybinding service action -> main app modal state opens -> focused panel context resolves -> Rust search request starts.
- Search selection -> preview request -> Pierre or fallback render in right pane.
- `Enter` -> modal calls focused composer insertion API -> composer inserts `@[file:path]` token -> user message later serializes through existing send flow.
- `Cmd+Enter` -> modal calls `panelStore.openFilePanel(..., { ownerPanelId })` -> attached file pane updates -> existing file panel preview stack renders.

### Error and failure propagation

- Search errors should surface as inline modal error state, not toast spam on every keystroke.
- Preview errors should degrade to fallback cards with reason text.
- Missing project / no focused agent panel should prevent opening or show a disabled state with a single explanatory message.
- No active composer but valid project should open the modal in browse-only mode with Insert disabled and Open-in-pane still available.

### State lifecycle risks

- Do not store the whole file corpus in multiple frontend caches; rely on Rust-side cache plus one visible result page.
- Do not couple modal lifecycle to inline picker state; they must remain independent.
- Ensure closing an agent panel while the modal is open clears owner context safely.

### API surface parity

- Inline `@` picker can keep its current API initially.
- New modal should use separate explorer commands so we do not regress the lightweight picker while refactoring.
- After rollout, consider sharing a common preview component, not a common ranking layer.

### Integration test scenarios

- Open modal on a panel with a project, insert file, then send message and verify the token reaches the composer state.
- Open modal on a changed file, verify Pierre diff renders; switch quickly to a binary file and verify stale diff does not flash.
- Open modal and use `Cmd+Enter`, verify an attached file pane opens on the owner panel.
- Close the owner panel while modal is open, verify modal closes or disables actions cleanly.

## Alternative Approaches Considered

### 1. Expand the existing inline `@` dropdown into a modal

Rejected because:

- it is structurally tied to trigger text and caret positioning
- it currently relies on frontend fuzzy matching
- it assumes a tiny result set and lightweight preview cycle

### 2. Reuse the advanced command palette files mode

Rejected because:

- it is palette-shaped, not explorer-shaped
- it currently fuzzy-matches in TypeScript via `files-provider.ts`
- it lacks the rich right-hand preview surface and attached-pane integration this feature needs

### 3. Open a full file panel instead of a modal

Rejected because:

- the requirement is for an embedded-style modal opened by `Cmd+I`
- panel churn is slower than an overlay for quick browse/insert loops
- the user still needs fast return to the active composer

## Acceptance Criteria

### Functional requirements

- [ ] `Cmd+I` opens and closes a dedicated file explorer modal from the shared keybinding system.
- [ ] The modal uses Acepe's embedded visual language, not generic dialog/palette styling.
- [ ] The modal works as a dedicated file explorer with searchable result list and preview pane.
- [ ] Selecting a file can insert it into the currently active composer.
- [ ] The explorer can also open the selected file in the focused agent panel's attached file pane.
- [ ] Result rows show extension icon plus git diff metadata.
- [ ] Changed text files preview with Pierre diff when safe.
- [ ] Large, binary, deleted, and unrenderable files show safe fallback states.
- [ ] Opening with a valid project but no active composer still shows the explorer in browse-only mode with Insert disabled.
- [ ] Opening while the modal is already open toggles it closed and restores focus to the prior control.
- [ ] Clearing the query restores the empty-query ranking and resets selection to the first result.
- [ ] `Enter` inserts the selected file and closes the modal.
- [ ] `Cmd+Enter` opens or focuses the selected file in the attached file pane and closes the modal.
- [ ] If the owner panel/project/composer becomes invalid while the modal is open, actions disable safely and the modal explains why.

### Non-functional requirements

- [ ] Ranking/filtering/calculation happen in Rust, not TypeScript.
- [ ] Search stays responsive on large repos because results are served from cached index data and rendered virtually.
- [ ] Preview switching does not flash stale content when the user arrows through rows quickly.
- [ ] Modal is fully keyboard operable.
- [ ] Modal is screen-reader understandable at the dialog, search, results, and preview levels.
- [ ] Explorer commands clamp page/query sizes and reject invalid or non-project-relative paths.
- [ ] Search and preview work can be superseded/cancelled so rapid navigation does not build unbounded backend work.

### Quality gates

- [ ] Rust tests cover ranking and preview classification.
- [ ] Vitest covers modal state and key interactions.
- [ ] `bun run check` passes.
- [ ] Scoped tests for touched TS/Svelte files pass.
- [ ] Scoped Rust tests for file index explorer logic pass.
- [ ] `cargo clippy` passes.

## Verification Commands

Run from repo root unless noted.

```bash
cd packages/desktop && bun test src/lib/acp/components/file-explorer-modal/__tests__/file-explorer-modal-state.test.ts
cd packages/desktop && bun test src/lib/acp/components/file-explorer-modal/__tests__/file-explorer-modal.svelte.vitest.ts
cd packages/desktop && bun test src/lib/acp/components/agent-input/state/__tests__
cd packages/desktop && bun run check
cd packages/desktop/src-tauri && cargo test --lib file_index::explorer
cd packages/desktop/src-tauri && cargo test --lib file_index::commands::tests
cd packages/desktop/src-tauri && cargo clippy
```

If shared preview code is extracted into an existing file-panel component, add or update the relevant component-specific Vitest command as part of the implementation.

## Risks and Mitigations

- Rust search command returns too much data -> mitigate with strict `limit`/`offset` paging and compact row payloads.
- Preview classification diverges from actual rendering support -> centralize thresholds and preview-kind mapping in Rust tests.
- Modal insertion path becomes tightly coupled to textarea-specific APIs -> add a small composer-facing method instead of reaching into dropdown internals.
- Generated TypeScript bindings get forgotten -> treat specta exports as part of the implementation checklist and verification steps.
- Preview command accidentally bypasses existing project path-safety checks -> route all explorer preview reads through the same validation helpers already used by file-index file operations.
- Virtualized list becomes screen-reader ambiguous -> prefer `aria-activedescendant` listbox focus management and include set-size / position metadata for mounted options.
- Added metadata bloats cache refresh time on very large repos -> compute only cheap file-system metadata during indexing and defer expensive content reads until preview time.
- Naive ranked paging still scans the full corpus at deep offsets -> use bounded top-K or cursor-friendly ranking semantics for the visible window.
- Explorer actions accidentally accept loose filename lookup or absolute paths -> accept only validated project-relative rows returned from search.

## Sources & References

### Internal references

- Existing inline picker: `packages/desktop/src/lib/acp/components/file-picker/file-picker-dropdown.svelte:1`
- Existing preview: `packages/desktop/src/lib/acp/components/file-picker/file-preview.svelte:1`
- Existing file token insertion: `packages/desktop/src/lib/acp/components/agent-input/state/agent-input-state.svelte.ts:898`
- Existing attached file opening path: `packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte:389`
- Existing attached pane shell: `packages/desktop/src/lib/components/main-app-view/components/content/agent-attached-file-pane.svelte:1`
- Existing file panel preview stack: `packages/desktop/src/lib/acp/components/file-panel/file-panel.svelte:120`
- Existing read-only Pierre file view: `packages/desktop/src/lib/acp/components/file-panel/file-panel-read-view.svelte:1`
- Existing diff modal shell: `packages/desktop/src/lib/acp/components/diff-viewer/diff-viewer-modal.svelte:147`
- Existing embedded modal shell: `packages/desktop/src/lib/components/ui/embedded-modal-shell.svelte:1`
- Existing embedded chrome examples: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-header.svelte:63`, `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-footer.svelte:62`, `packages/desktop/src/lib/acp/components/add-repository/open-project-dialog.svelte:292`
- Existing file index service: `packages/desktop/src-tauri/src/file_index/service.rs:47`
- Existing file index commands: `packages/desktop/src-tauri/src/file_index/commands.rs:91`
- Existing git metadata extraction: `packages/desktop/src-tauri/src/file_index/git.rs:12`
- Existing specta exports: `packages/desktop/src-tauri/src/session_jsonl/export_types.rs:60`, `packages/desktop/src-tauri/src/commands/names.rs:251`
- Existing default keybindings: `packages/desktop/src/lib/keybindings/bindings/defaults.ts:1`
- Existing overlay/app state home: `packages/desktop/src/lib/components/main-app-view/logic/main-app-view-state.svelte.ts:1`
- Existing Virtua pattern: `packages/desktop/src/lib/acp/components/agent-panel/components/virtualized-entry-list.svelte:1`

### Research notes

- No relevant brainstorm document found in `docs/brainstorms/`.
- No applicable `docs/solutions/` entries were present.
- External guidance used and verified:
  - WAI-ARIA APG modal dialog pattern: `https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/`
  - WAI-ARIA APG listbox pattern: `https://www.w3.org/WAI/ARIA/apg/patterns/listbox/`
  - Tauri 2 "Calling Rust from the Frontend": `https://v2.tauri.app/develop/calling-rust/`
  - Virtua README / Svelte usage notes: `https://raw.githubusercontent.com/inokawa/virtua/main/README.md`
- Context7 lookups were unavailable in this session because the local quota was exhausted, so external framework guidance came from the verified primary docs above instead.
