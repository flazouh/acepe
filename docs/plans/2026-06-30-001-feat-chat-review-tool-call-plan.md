---
title: feat: Move Review Entry Point Into Chat
type: feat
status: active
date: 2026-06-30
---

# feat: Move Review Entry Point Into Chat

## Overview

Move the review entry point from the pre-composer modified-files header into the chat as a Codex-style synthetic tool call. The chat entry shows edited files in a capped scroll area and has a `Review` button in the top-right. It appears only when the current agent turn is not streaming.

## Problem Frame

Today review feels like panel chrome below the transcript. The requested behavior is closer to Codex: when the agent finishes, the transcript itself shows a tool-like "edited files" card, and the user can start review from there. The real review workspace should stay the existing workspace; this change only moves the entry point and summary into the conversation.

## Requirements Trace

- R1. Show a synthetic tool-call-like entry in the chat when there are edited files.
- R2. The synthetic entry lists edited files in a scrollable area with a max height.
- R3. The synthetic entry has a `Review` button in the top-right.
- R4. The synthetic entry is hidden while the agent is streaming.
- R5. Clicking `Review` opens the existing review workflow at the default/first useful file.
- R6. Do not create a real transcript/tool history event for this UI-only affordance.

## Scope Boundaries

- Do not replace the existing review workspace or per-file review logic.
- Do not change Rust canonical transcript order, operation graph truth, or provider history parsing.
- Do not change PR creation, merge, or PR link controls.
- Do not add a second source of truth for modified files.

## Context & Research

### Relevant Code and Patterns

- `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte` already receives `modifiedFilesState`, canonical `turnState`, and builds local-only rendered rows.
- `packages/desktop/src/lib/acp/components/agent-panel/logic/transcript-viewport-rendered-rows.ts` already injects local-only optimistic and planning rows after canonical Rust rows.
- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte` derives `modifiedFilesState` from `sessionStore.read.getSessionModifiedFilesState(sessionId)` and opens review through `onEnterReviewMode`.
- `packages/ui/src/components/agent-panel/agent-panel-tool-entry.svelte` dispatches tool entries by render kind.
- `packages/ui/src/components/agent-panel/agent-tool-card.svelte`, `agent-tool-row.svelte`, and `agent-tool-edit.svelte` provide the existing compact tool card visual language.
- `packages/desktop/src/lib/acp/components/agent-panel/components/review-workspace-model.ts` already resolves the best initial review file from saved review status.

### Institutional Learnings

- `docs/solutions/best-practices/canonical-session-projection-ui-derivation-2026-05-01.md`: UI-visible session state should derive from canonical projection, not hot-state fallbacks.
- `docs/solutions/transcript-viewport-dom-authority-baseline.md`: the current viewport should use rendered rows as DOM authority, with Rust owning canonical row order.
- `docs/solutions/architectural/live-transcript-display-identity-boundary-2026-05-18.md`: UI must not invent transcript order or display identity for real agent events.

### External References

- Not used. Local Acepe patterns are enough for this feature.

## Key Technical Decisions

- Use a local-only rendered row, not a Rust transcript event: the card is a UI affordance derived from canonical modified-file and turn-state facts. It is not something the agent did.
- Add a presentational `review` tool kind in `@acepe/ui`: shared UI renders the card, desktop owns the callback that enters review mode.
- Hide by canonical turn state: the row builder receives `showSyntheticReviewEntry` derived from `turnState !== "streaming"` and `modifiedFilesState.fileCount > 0`.
- Pass an explicit synthetic review entry into the row builder: do not ask the generic viewport row mapper to infer a tool entry from a row with no operation link.
- Add a small `AgentPanelReviewActionEvent`/callback contract: `@acepe/ui` emits the click event, while desktop decides how to open review.
- Keep PR controls outside this change: the existing modified-files header can keep PR-specific controls, but the duplicate `Review` action should be removed or suppressed once the chat entry is active.

## Open Questions

### Resolved During Planning

- Should Rust emit a synthetic review transcript row? No. That would make a UI affordance look like product transcript truth. The safer path is a local-only row derived in the display projection.
- Should the Review button open a new review system? No. It should open the existing review workspace.

### Deferred to Implementation

- Exact file-row component reuse: implementation should reuse `FilePathBadge` and `DiffPill` if clean, otherwise create a small review-tool row component in `@acepe/ui`.

## High-Level Technical Design

This illustrates the intended approach and is directional guidance for review, not implementation code.

```text
canonical operation graph
        |
        v
modifiedFilesState + canonical turnState
        |
        v
desktop local row builder
        |
        v
synthetic tool_call entry: kind = "review"
        |
        v
@acepe/ui review tool card
        |
        v
existing review workspace opens on Review
```

## Implementation Units

- [ ] **Unit 1: Add the synthetic review row model**

**Goal:** Make the transcript rendered-row builder append a local-only review row only when there are modified files and the agent is not streaming.

**Requirements:** R1, R4, R6

**Dependencies:** None

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/transcript-viewport-rendered-rows.ts`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/logic/__tests__/transcript-viewport-rendered-rows.test.ts`

**Approach:**
- Add an input for a ready-to-render synthetic review entry, such as `syntheticReviewEntry: AgentPanelSceneEntryModel | null`.
- Reuse the existing local-only row pattern used for optimistic and planning rows.
- Use a stable local row id such as `local:review`.
- Create a matching local viewport row only for scroll identity and anchoring. Keep `activeStreamingTail: null` and no operation links because this is not a real tool operation.
- Push the row and the explicit review entry together, rather than routing the local row through `resolveTranscriptViewportSceneEntry`.

**Execution note:** Start with failing tests for visible, hidden-while-streaming, and no-files cases.

**Patterns to follow:**
- `createLocalPlanningRow` and `createLocalOptimisticUserRow` in `transcript-viewport-rendered-rows.ts`.

**Test scenarios:**
- Happy path: non-streaming turn with two modified files -> one local-only `tool_call` entry is appended with file summary.
- Edge case: streaming turn with modified files -> no review row is appended.
- Edge case: non-streaming turn with zero files -> no review row is appended.
- Integration: canonical rows keep their order and the synthetic row appears after them without changing canonical row ids.

**Verification:**
- The row builder tests prove the card is local-only, stable, and gated by streaming state.

- [ ] **Unit 2: Add the presentational review tool card**

**Goal:** Render the synthetic entry as a tool-call-like card with edited files, capped scrolling, and a top-right `Review` button.

**Requirements:** R1, R2, R3

**Dependencies:** Unit 1 model shape

**Files:**
- Modify: `packages/ui/src/components/agent-panel/types.ts`
- Modify: `packages/ui/src/components/agent-panel/agent-panel-conversation-entry-model.ts`
- Modify: `packages/ui/src/components/agent-panel/agent-panel-tool-entry.svelte`
- Create: `packages/ui/src/components/agent-panel/agent-panel-tool-review.svelte`
- Test: `packages/ui/src/components/agent-panel/agent-panel-conversation-entry-model.test.ts`
- Test: `packages/ui/src/components/agent-panel/agent-panel-tool-review.svelte.vitest.ts`

**Approach:**
- Add `review` to `AgentToolKind`.
- Add a small `reviewFiles` presentation field to `AgentToolEntry`, with file path, optional file name, additions, deletions, and optional review status.
- Add a review click event/callback, separate from plan and file-select events.
- Render a new `tool-review` kind from `AgentPanelToolEntry`.
- Use `AgentToolCard`, `FilePathBadge`, `DiffPill`, and `Button`.
- Keep max height on the file list, for example `max-h-[220px] overflow-y-auto`.

**Execution note:** Start with failing UI/model tests before adding the component.

**Patterns to follow:**
- `agent-tool-edit.svelte` for compact header and multi-file rows.
- `agent-panel-standard-tool-entry.svelte` for render-kind dispatch.
- `review-workspace-file-list.svelte` and `agent-panel-modified-file-row.svelte` for file row density.

**Test scenarios:**
- Happy path: two files render with names, diff pills, and an enabled `Review` button.
- Edge case: many files render inside a scrollable capped region.
- Edge case: empty file list disables or hides action safely.
- Interaction: clicking `Review` calls the provided review callback once.

**Verification:**
- Component tests prove rendered content and button callback.

- [ ] **Unit 3: Wire desktop callbacks into the chat entry**

**Goal:** Let the synthetic chat card open the existing review workspace.

**Requirements:** R3, R5

**Dependencies:** Units 1 and 2

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/transcript-viewport-row-renderer.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-content.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/types/agent-panel-content-props.ts`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/components/__tests__/agent-panel-content.svelte.vitest.ts`

**Approach:**
- Build the synthetic review entry in the desktop viewport layer from `modifiedFilesState`.
- Pass an `onReview` callback from `agent-panel.svelte` down to the viewport and into `@acepe/ui`.
- In `agent-panel.svelte`, reuse `handleEnterReviewMode(modifiedFilesState)` or the existing initial-index resolver.
- Keep the callback desktop-owned. `@acepe/ui` only emits a presentational action.

**Execution note:** Add a failing component or contract test that proves the callback is wired before implementation.

**Patterns to follow:**
- Existing `onPlanBuild`, `onPlanCancel`, `onToolFileSelect` callback forwarding.

**Test scenarios:**
- Integration: rendered synthetic review entry click invokes the parent review callback.
- Edge case: no `modifiedFilesState` -> no synthetic review action.

**Verification:**
- Existing review workspace opens through the same path as before.

- [ ] **Unit 4: Remove duplicate review chrome**

**Goal:** Make the chat entry the main review entry point while keeping non-review modified-file and PR controls intact.

**Requirements:** R1, R3

**Dependencies:** Units 1-3

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/modified-files/modified-files-header.svelte`
- Modify: `packages/ui/src/components/agent-panel/agent-panel-modified-files-trailing-controls.svelte` if needed
- Test: existing modified-files header tests, if present

**Approach:**
- Suppress the old `Review` button in the modified-files header after the chat entry is active.
- Keep file expansion, PR generation, merge, and PR link actions unchanged.

**Test scenarios:**
- Happy path: modified-files header no longer shows the duplicate `Review` button when the chat card owns review.
- Regression: PR button and file list still render when modified files exist.

**Verification:**
- No duplicate visible review buttons in the normal non-streaming conversation state.

- [ ] **Unit 5: Verify in the real desktop app**

**Goal:** Prove the UI works in the Tauri WebView, not just unit tests.

**Requirements:** R1-R5

**Dependencies:** Units 1-4

**Files:**
- No production files expected.

**Approach:**
- Run TypeScript checks and targeted tests.
- Use the repo QA wrapper on a dev Tauri app.
- Inspect the synthetic review card selector.
- Capture a screenshot when the card is visible.

**Test scenarios:**
- DOM: review card visible with files and `Review` button when idle.
- DOM: review card absent while streaming.
- Interaction: clicking `Review` opens the review workspace.

**Verification:**
- `bun run check`
- Targeted unit/component tests
- `bun run qa doctor`
- `bun run qa observe`
- `bun run qa inspect --selector=<review-card-selector>`
- `bun run qa screenshot`

## System-Wide Impact

- **Interaction graph:** The new button enters the existing review workflow. It does not add a new review state machine.
- **Error propagation:** No new backend errors. Missing or empty modified-file state should simply hide the card.
- **State lifecycle risks:** The card must update when modified files change and disappear while streaming. It should not persist into transcript history.
- **API surface parity:** Existing review workspace and PR actions should keep working.
- **Integration coverage:** Component tests plus desktop QA are required because the visible change is in the transcript viewport.
- **Unchanged invariants:** Rust canonical transcript order, operation graph, tool-call ids, and provider parsing remain unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| The card is mistaken for a real agent tool call | Mark it local-only and keep no operation links; it is a display affordance only. |
| Duplicate review buttons confuse the user | Suppress the old review action once the chat card is wired. |
| The synthetic row affects scroll behavior | Reuse the existing local-only row path and verify in Tauri WebView. |
| `@acepe/ui` accidentally imports desktop state | Keep `@acepe/ui` presentational and pass callbacks/data from desktop. |

## Documentation / Operational Notes

- No user docs required.
- If implementation learns a reusable pattern for synthetic chat affordances, add a `docs/solutions/` note after review.

## Sources & References

- Related code: `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte`
- Related code: `packages/desktop/src/lib/acp/components/agent-panel/logic/transcript-viewport-rendered-rows.ts`
- Related code: `packages/ui/src/components/agent-panel/agent-panel-tool-entry.svelte`
- Related code: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-review-workspace.svelte`
- Related learning: `docs/solutions/best-practices/canonical-session-projection-ui-derivation-2026-05-01.md`
- Related learning: `docs/solutions/transcript-viewport-dom-authority-baseline.md`
- Related learning: `docs/solutions/architectural/live-transcript-display-identity-boundary-2026-05-18.md`
