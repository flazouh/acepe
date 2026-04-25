---
title: feat: Add Excalidraw renderer to Acepe
type: feat
status: active
date: 2026-04-13
---

# feat: Add Excalidraw renderer to Acepe

## Overview

Add first-class `.excalidraw` rendering to Acepe so diagrams open as diagrams instead of raw JSON. The first slice should be a read-only renderer that can appear as a **first-class agent-panel tool-call artifact**, with file-preview surfaces reusing the same viewer boundary instead of owning a separate rendering path. The architecture should still leave room for future editing or MCP-app style diagram workflows without redoing the rendering foundation.

## Problem Frame

Acepe can already preview markdown, HTML, images, PDFs, diffs, and browser content, but `.excalidraw` files are still treated like generic structured text. That breaks the mental model for diagram artifacts inside an agentic developer environment: the app can generate Excalidraw documents, but users still need to leave Acepe and open the website or another tool to understand them visually.

This is not just a convenience gap. It weakens reviewability and slows the loop between agent output and human verification. If an agent generates or reads an Excalidraw document, the most natural place to inspect it is inside the agent panel itself, not by context-switching to a generic file preview. The renderer should therefore let users inspect diagrams inside Acepe’s conversational workflow while keeping the initial scope deliberately narrow: rendering first, editing later.

## Requirements Trace

- R1. Acepe must render `.excalidraw` files visually inside the product instead of showing raw JSON by default.
- R2. The first shipped slice must be read-only and must not silently introduce editing, cloud sync, or MCP-app requirements.
- R3. The renderer must fit Acepe’s existing agent-panel and file-preview architecture rather than becoming a one-off special window or external-browser dependency.
- R4. The design must preserve a clean upgrade path toward future editing or agent-driven Excalidraw workflows.
- R5. Rendering failures or malformed `.excalidraw` files must fail closed into explicit fallback UI rather than crashing preview surfaces.
- R6. Agent tool-call surfaces must be able to render Excalidraw output inline when the tool call or artifact points at a `.excalidraw` document.

## Scope Boundaries

- No Excalidraw editing UI in this plan.
- No Excalidraw MCP-app integration in this plan.
- No cloud sync, collaboration, share links, export pipeline, or asset upload workflow.
- No generic "render any arbitrary MCP app" platform work; this plan is specifically about Excalidraw rendering inside Acepe.

### Deferred to Separate Tasks

- Editing support using the same viewer host in writable mode.
- General-purpose MCP Apps / ext-apps runtime support.
- Agent-driven creation or mutation flows that go beyond rendering existing Excalidraw output.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src/lib/acp/components/file-panel/format/registry.ts` owns file-type detection and display-mode selection for file panels.
- `packages/desktop/src/lib/acp/components/file-panel/file-panel-rendered-view.svelte` already contains specialized renderers for markdown, images, PDFs, and HTML iframe content.
- `packages/desktop/src/lib/acp/components/file-explorer-modal/file-explorer-preview-pane.svelte` shows how Acepe renders richer file previews with safe fallback behavior.
- `packages/desktop/src/lib/acp/components/browser-panel/browser-panel.svelte` plus `packages/desktop/src/lib/utils/tauri-client/browser-webview.ts` show the existing isolated browser/webview seam available for hosted rendering when native Svelte rendering is not the right fit.
- `packages/desktop/src/lib/acp/components/tool-calls/tool-definition-registry.ts`, `resolve-tool-operation.ts`, and `tool-call-router.svelte` are the existing tool-call rendering authority and the right insertion seam for a diagram artifact/tool surface.
- `packages/desktop/src/lib/acp/components/artefact/artefact-preview.svelte` and related artifact components show the current artifact-style rendering seam that can host diagram content without inventing a parallel panel system.

### Institutional Learnings

- `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md` reinforces the repo’s boundary discipline: specialized meaning should travel through explicit contracts, not ad hoc UI inference.
- `docs/solutions/logic-errors/operation-interaction-association-2026-04-07.md` reinforces the same architectural instinct for shared surfaces: keep canonical logic below the presentation layer and make multiple projections consume one answer.

### External References

- Excalidraw’s official integration surface is the `@excalidraw/excalidraw` React component, which supports read-only/view mode and `.excalidraw` JSON initialization.
- Excalidraw’s hosted share/embed model exists, but it is a worse fit for Acepe’s local-file reviewability and offline/local-first expectations than an in-app viewer host.

## Key Technical Decisions

- **Ship read-only first.** This keeps scope aligned with the user problem — visual inspection of diagrams — without forcing editor-state, autosave, conflict, or collaboration decisions into the first slice.
- **Use an isolated renderer host instead of mixing React directly into core Svelte UI.** Acepe is a Svelte/Tauri app, while the official Excalidraw embed surface is React. The cleanest architecture is a narrow Excalidraw viewer host consumed by Acepe surfaces, not React scattered through Svelte components.
- **Treat Excalidraw as both a specialized file format and a first-class tool artifact.** The viewer boundary should serve agent-panel tool surfaces first and file-preview surfaces second, so diagram review lives where agent output is discussed.
- **Fail closed with fallback preview.** Invalid or unsupported `.excalidraw` content should degrade to explicit fallback or raw JSON preview rather than crashing transcript or preview surfaces.
- **Preserve an upgrade seam for editing.** The renderer contract should carry “render diagram data in read-only mode” today, with room to add writable mode later without changing where the host lives.

## Open Questions

### Resolved During Planning

- **What should Acepe support first?** Read-only `.excalidraw` rendering.
- **Should the first slice depend on MCP Apps or `excalidraw-mcp`?** No. The rendering feature should stand alone inside Acepe without requiring MCP Apps support.
- **Should Acepe rely on hosted Excalidraw URLs?** No. Local-file and local-artifact rendering are the correct first-class behaviors for Acepe.
- **What should be the primary UX surface?** The agent panel/tool-call artifact surface should be primary; file panel and explorer preview should reuse the same renderer as supporting surfaces.

### Deferred to Implementation

- **Exact host form:** a dedicated local HTML/route host, iframe `srcdoc`, or browser-webview-backed host should be finalized during implementation once bundling ergonomics are concrete.
- **How much of Excalidraw UI chrome to expose in read-only mode:** this depends on what the embedded component allows cleanly without creating a half-editor UX.
- **Whether agent-panel artifact rendering and file preview should share one wrapper directly or one lower-level host plus multiple wrappers:** this should be settled after the implementer inspects the real props and sizing constraints.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
tool call / artifact / file path
          |
          v
diagram resolver identifies Excalidraw payload
          |
          v
Acepe Excalidraw viewer wrapper loads + validates JSON
          |
          +------------------+-----------------------+
          |                  |                       |
          v                  v                       v
   agent panel tool     file panel            explorer preview
   artifact surface
          \                  |                       /
           \                 |                      /
            +----------------+---------------------+
                             v
                 isolated Excalidraw viewer host
                 - read-only
                 - theme-aware
                 - resize-aware
                 - explicit fallback on invalid data
```

## Implementation Units

- [ ] **Unit 1: Add `.excalidraw` as a first-class file format**

**Goal:** Teach Acepe’s file-format system that `.excalidraw` is a specialized previewable document rather than generic JSON.

**Requirements:** R1, R3, R5

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/file-panel/format/registry.ts`
- Modify: `packages/desktop/src/lib/acp/components/file-panel/format/types.ts`
- Modify: `packages/desktop/src/lib/acp/components/file-panel/file-panel-rendered-view.svelte`
- Test: `packages/desktop/src/lib/acp/components/file-panel/file-panel-format.test.ts`

**Approach:**
- Add a dedicated `excalidraw` format kind and route `.excalidraw` files to a specialized rendered mode.
- Keep the file-panel format contract explicit instead of detecting Excalidraw heuristically from JSON shape in multiple view components.
- Ensure unsupported or malformed content still has a raw-text fallback path.

**Patterns to follow:**
- Existing format registration and display-option patterns in `packages/desktop/src/lib/acp/components/file-panel/format/registry.ts`
- Specialized rendered-mode handling in `packages/desktop/src/lib/acp/components/file-panel/file-panel-rendered-view.svelte`

**Test scenarios:**
- Happy path: a `.excalidraw` file resolves to the `excalidraw` format kind and chooses rendered preview by default.
- Edge case: a non-`.excalidraw` JSON file continues to resolve as `json` and does not route through the Excalidraw renderer.
- Error path: malformed `.excalidraw` JSON falls back to explicit non-crashing preview behavior rather than breaking the panel.

**Verification:**
- Acepe’s format layer has one explicit Excalidraw path, and `.excalidraw` files no longer depend on generic JSON rendering decisions.

- [ ] **Unit 2: Build an isolated read-only Excalidraw viewer host**

**Goal:** Create the dedicated rendering surface that can display parsed `.excalidraw` data in read-only mode while staying architecturally isolated from core Svelte view code.

**Requirements:** R1, R2, R4, R5, R6

**Dependencies:** Unit 1

**Files:**
- Create: `packages/desktop/src/lib/acp/components/excalidraw-viewer/`
- Create: `packages/desktop/src/lib/acp/components/excalidraw-viewer/excalidraw-viewer-host.*`
- Create: `packages/desktop/src/lib/acp/components/excalidraw-viewer/excalidraw-viewer.svelte`
- Create: `packages/desktop/src/lib/acp/components/excalidraw-viewer/excalidraw-viewer-state.ts`
- Test: `packages/desktop/src/lib/acp/components/excalidraw-viewer/*.test.ts`

**Approach:**
- Encapsulate all Excalidraw-specific rendering logic in one narrow host boundary.
- Feed the host validated diagram JSON and render it in read-only/view mode.
- Keep theme, sizing, and fallback handling owned by the wrapper contract so future surfaces consume the same rendering seam.
- Avoid contaminating `@acepe/ui` with app-specific runtime or embedding logic; this remains a desktop-owned integration wrapper.

**Execution note:** Start with characterization coverage for invalid data and zero-size / late-size container behavior before refining the rendering host.

**Patterns to follow:**
- Browser/webview isolation pattern in `packages/desktop/src/lib/acp/components/browser-panel/browser-panel.svelte`
- Defensive preview rendering and fallback posture in `packages/desktop/src/lib/acp/components/file-explorer-modal/file-explorer-preview-pane.svelte`

**Test scenarios:**
- Happy path: valid `.excalidraw` JSON renders a visible diagram in read-only mode.
- Edge case: theme changes update the renderer without destroying the host contract.
- Edge case: the viewer mounts into a container that is initially hidden or zero-sized and later becomes visible without requiring a full app reload.
- Error path: invalid JSON or missing expected Excalidraw fields shows explicit fallback UI.
- Integration: the host boundary stays isolated so Svelte surfaces pass data/configuration in and do not need Excalidraw-specific logic beyond the wrapper contract.

**Verification:**
- Acepe has one reusable, isolated Excalidraw viewer boundary that can be consumed by artifact and preview surfaces without adding React-specific coupling throughout the desktop UI.

- [ ] **Unit 3: Integrate Excalidraw rendering into agent-panel tool surfaces**

**Goal:** Render Excalidraw output inline inside the agent panel when a tool call or artifact references a `.excalidraw` document, so diagram review happens in the conversational workflow.

**Requirements:** R1, R3, R5, R6

**Dependencies:** Units 1-2

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/tool-definition-registry.ts`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/resolve-tool-operation.ts`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/tool-call-router.svelte`
- Modify: `packages/desktop/src/lib/acp/components/artefact/artefact-preview.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/scene/desktop-agent-panel-scene.ts` (only if the scene model needs explicit diagram artifact wiring)
- Test: `packages/desktop/src/lib/acp/components/tool-calls/__tests__/tool-definition-registry.test.ts`
- Test: `packages/desktop/src/lib/acp/components/tool-calls/__tests__/resolve-tool-operation.test.ts`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/scene/desktop-agent-panel-scene.test.ts`

**Approach:**
- Add one explicit diagram/tool artifact path in the tool-call rendering authority so Excalidraw is routed intentionally, not inferred ad hoc by individual message components.
- Reuse the shared viewer boundary inside the agent panel/tool artifact surface.
- Keep scene/tool routing focused on selecting the correct artifact renderer; the viewer host should still own Excalidraw-specific runtime behavior.

**Patterns to follow:**
- Tool routing authority in `packages/desktop/src/lib/acp/components/tool-calls/tool-definition-registry.ts`
- Artifact rendering seam in `packages/desktop/src/lib/acp/components/artefact/artefact-preview.svelte`
- Canonical shared-surface discipline from `packages/desktop/src/lib/acp/components/agent-panel/scene/desktop-agent-panel-scene.ts`

**Test scenarios:**
- Happy path: a tool call that yields an Excalidraw artifact renders the diagram inline in the agent panel.
- Edge case: a tool call with malformed or incomplete Excalidraw payload degrades to explicit fallback artifact UI.
- Error path: unsupported artifact data stays local to the tool/artifact renderer and does not crash transcript rendering.
- Integration: transcript/tool routing and scene projection agree on the same Excalidraw artifact semantics.

**Verification:**
- Excalidraw becomes a first-class visual artifact in the agent panel without introducing a one-off tool-specific rendering path.

- [ ] **Unit 4: Reuse the same renderer in file preview surfaces**

**Goal:** Reuse the same Excalidraw viewer host in file panel and explorer preview so file-centric inspection stays consistent with the agent-panel artifact experience.

**Requirements:** R1, R3, R5

**Dependencies:** Units 1-3

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/file-panel/file-panel-rendered-view.svelte`
- Modify: `packages/desktop/src/lib/acp/components/file-explorer-modal/file-explorer-preview-pane.svelte`
- Modify: `packages/desktop/src/lib/services/converted-session-types.ts` (only if preview response typing needs an explicit Excalidraw preview kind)
- Test: `packages/desktop/src/lib/acp/components/file-panel/__tests__/file-panel.svelte.vitest.ts`
- Test: `packages/desktop/src/lib/acp/components/file-explorer-modal/__tests__/file-explorer-modal-state.test.ts`

**Approach:**
- Render Excalidraw diagrams inline in the main file panel and the explorer preview pane using the same shared viewer boundary already used in the agent panel.
- Keep surface-specific logic focused on data loading and layout; the viewer host should own Excalidraw-specific runtime behavior.
- If explorer preview typing needs a dedicated preview mode, add it explicitly rather than inferring from text preview fields.

**Patterns to follow:**
- Shared preview discipline from `packages/desktop/src/lib/acp/components/file-explorer-modal/file-explorer-preview-pane.svelte`
- File-panel rendered-mode composition in `packages/desktop/src/lib/acp/components/file-panel/file-panel-rendered-view.svelte`

**Test scenarios:**
- Happy path: opening a `.excalidraw` file in the file panel renders the diagram instead of raw JSON.
- Happy path: selecting a `.excalidraw` file in the explorer preview pane renders the same diagram surface.
- Edge case: large but valid `.excalidraw` files still degrade predictably if the host imposes practical render limits.
- Error path: preview surfaces show fallback UI when the renderer rejects malformed diagram content.
- Integration: the same `.excalidraw` file yields consistent read-only output across agent panel, file panel, and explorer preview.

**Verification:**
- Diagrams are visually inspectable anywhere Acepe already previews files, with one shared rendering contract behind all three surfaces.

- [ ] **Unit 5: Harden UX, dependencies, and extension seams**

**Goal:** Finalize the first-slice experience so it is stable, reviewable, and ready for future editing or workflow expansion.

**Requirements:** R2, R4, R5, R6

**Dependencies:** Units 1-4

**Files:**
- Modify: `packages/desktop/package.json`
- Modify: `packages/desktop/src/lib/acp/components/excalidraw-viewer/`
- Modify: `packages/desktop/src/lib/acp/components/tool-calls/`
- Modify: `packages/desktop/src/lib/acp/components/file-panel/`
- Test: `packages/desktop/src/lib/acp/components/excalidraw-viewer/*.test.ts`
- Test: `packages/desktop/src/lib/acp/components/tool-calls/__tests__/*.test.ts`
- Test: `packages/desktop/src/lib/acp/components/file-panel/file-panel-format.test.ts`

**Approach:**
- Add the dependency/bundling work required by the chosen host approach.
- Lock in explicit read-only behavior so the first ship does not accidentally expose editing affordances.
- Document the extension seam in code structure: one host today, future writable mode tomorrow.

**Patterns to follow:**
- Existing preview feature hardening in `packages/desktop/src/lib/acp/components/file-panel/`
- Tool-call routing hardening in `packages/desktop/src/lib/acp/components/tool-calls/`
- Repo boundary guidance from `AGENTS.md`

**Test scenarios:**
- Happy path: the renderer bundle/dependency path loads in desktop without breaking existing tool-call or preview types.
- Edge case: non-Excalidraw tool and preview surfaces continue to behave unchanged after the new format lands.
- Error path: if the Excalidraw host cannot initialize, surrounding transcript and preview UI remain usable and report a local fallback state.
- Integration: future-facing renderer props/config remain narrow enough that a later editing mode can reuse the same host instead of replacing it.

**Verification:**
- The read-only Excalidraw renderer is production-ready for Acepe’s artifact and preview surfaces and leaves behind a clean seam for follow-on editing work.

## System-Wide Impact

- **Interaction graph:** file format detection, tool-call/artifact routing, file panel rendering, explorer preview rendering, and potentially browser/webview hosting all participate in the final shape.
- **Error propagation:** invalid diagram data should stop at the renderer boundary and degrade to local fallback UI, not bubble up as panel-crashing errors.
- **State lifecycle risks:** host initialization timing, theme sync, resize handling, and view teardown are the main lifecycle seams.
- **API surface parity:** agent panel, file panel, and explorer preview must render the same diagram semantics from the same underlying Excalidraw data.
- **Integration coverage:** cross-surface parity, malformed-file fallback, tool-routing correctness, and host initialization behavior all need coverage because unit tests on one wrapper alone will not prove the shared experience.
- **Unchanged invariants:** Acepe remains a Svelte/Tauri app, `@acepe/ui` stays presentational, and Excalidraw-specific runtime logic stays outside shared UI packages.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| React-based Excalidraw embedding leaks into core Svelte view code | Keep one isolated viewer host boundary and make agent-panel and preview surfaces consume it as a black box |
| Renderer sizing or lifecycle bugs create blank previews | Add explicit host lifecycle coverage for hidden containers, resize, and teardown |
| Malformed `.excalidraw` files or artifacts crash transcript/preview surfaces | Validate/fail closed at the renderer boundary and preserve local fallback behavior |
| First slice quietly expands into an editor project | Keep read-only mode explicit in scope, props, and verification criteria |

## Documentation / Operational Notes

- If the chosen host path introduces a non-obvious renderer seam, add a short code comment or developer note near the host explaining why Excalidraw is isolated instead of rendered directly in core Svelte components.
- If implementation lands a reusable host pattern that could support future MCP-app style embeds, record that learning in `docs/solutions/`.

## Sources & References

- Related code: `packages/desktop/src/lib/acp/components/file-panel/format/registry.ts`
- Related code: `packages/desktop/src/lib/acp/components/file-panel/file-panel-rendered-view.svelte`
- Related code: `packages/desktop/src/lib/acp/components/file-explorer-modal/file-explorer-preview-pane.svelte`
- Related code: `packages/desktop/src/lib/acp/components/browser-panel/browser-panel.svelte`
- Related code: `packages/desktop/src/lib/acp/components/tool-calls/tool-definition-registry.ts`
- Related code: `packages/desktop/src/lib/acp/components/tool-calls/resolve-tool-operation.ts`
- Related code: `packages/desktop/src/lib/acp/components/tool-calls/tool-call-router.svelte`
- Related code: `packages/desktop/src/lib/acp/components/artefact/artefact-preview.svelte`
- Institutional learning: `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md`
- Institutional learning: `docs/solutions/logic-errors/operation-interaction-association-2026-04-07.md`
- External docs: https://docs.excalidraw.com/docs/@excalidraw/excalidraw/integration
- External docs: https://www.npmjs.com/package/@excalidraw/excalidraw
