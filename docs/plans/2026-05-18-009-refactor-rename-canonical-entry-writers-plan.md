---
title: "refactor: Rename canonical transcript entry writers"
type: refactor
status: active
date: 2026-05-18
origin: docs/brainstorms/2026-04-25-final-god-architecture-requirements.md
depends_on:
  - docs/plans/2026-05-18-008-refactor-delete-obsolete-assistant-streaming-hooks-plan.md
  - docs/solutions/architectural/live-transcript-display-identity-boundary-2026-05-18.md
---

# Refactor: Rename Canonical Transcript Entry Writers

## Overview

`SessionEntryStore.applyTranscriptDelta(...)` and `TranscriptToolCallBuffer` still write entries through methods named:

```text
appendCompatibilityEntry(...)
replaceCompatibilityEntry(...)
```

Those methods now write canonical transcript-derived entries. The old names imply a fallback/compatibility transcript path still exists.

Target rule:

```text
appendTranscriptEntry(...)
replaceTranscriptEntry(...)
```

These names describe the current boundary: canonical transcript storage, not raw compatibility repair.

## Planning Inventory

Inventory was collected after commit `3ca4d4870`.

### Real GOD Violation Candidates

- `packages/desktop/src/lib/acp/store/services/interfaces/entry-store-internal.ts`
  - Exposes compatibility-named write methods to `TranscriptToolCallBuffer`.

- `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts`
  - Uses compatibility-named methods from canonical transcript delta application.

- `packages/desktop/src/lib/acp/store/services/transcript-tool-call-buffer.svelte.ts`
  - Writes tool transcript rows through compatibility-named methods.

### Legal Or Deferred Findings

- `preloadCompatibilityEntriesAndBuildIndex(...)`
  - Still describes legacy preloaded `SessionEntry` test/support input.
  - Defer unless it becomes a production authority surface.

- `recordCompatibilityToolCallTranscriptEntry(...)`
  - Test-access helper for constructing tool rows in old tests.
  - Defer unless broader tool-buffer cleanup removes it.

## Scope Boundaries

- Naming-only refactor for entry writer API.
- No behavior change to transcript snapshot/delta application.
- No deletion of `TranscriptToolCallBuffer`.
- No changes to unrelated agent-panel/tool-duration files.

## Implementation Units

- [x] **Unit 1: Rename Entry Writer Interface And Store Methods**

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/services/interfaces/entry-store-internal.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts`

**Approach:**
- Rename `appendCompatibilityEntry(...)` to `appendTranscriptEntry(...)`.
- Rename `replaceCompatibilityEntry(...)` to `replaceTranscriptEntry(...)`.
- Update comments and debug labels.

**Execution result:** Renamed the interface and `SessionEntryStore` methods/debug labels to `appendTranscriptEntry(...)` and `replaceTranscriptEntry(...)`.

- [x] **Unit 2: Update Tool Buffer And Tests**

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/services/transcript-tool-call-buffer.svelte.ts`
- Modify focused tests under `packages/desktop/src/lib/acp/store/`

**Approach:**
- Update callers and mocks mechanically.
- Keep test intent unchanged.

**Execution result:** Updated `TranscriptToolCallBuffer` and focused tests to use the canonical transcript writer names.

- [x] **Unit 3: Update Architecture Note And Guard Scan**

**Files:**
- Modify: `docs/solutions/architectural/live-transcript-display-identity-boundary-2026-05-18.md`

**Approach:**
- Record that canonical entry writer names no longer use compatibility language.
- Add a production guard scan for old writer names.

**Execution result:** Updated the architecture note and confirmed the old production writer names are gone.

## Verification Plan

- Failing guard before implementation:
  - `rg -n "appendCompatibilityEntry|replaceCompatibilityEntry" packages/desktop/src/lib/acp/store -g '*.ts' -g '*.svelte'`
- Focused tests:
  - `cd packages/desktop && bun test ./src/lib/acp/store/services/__tests__/transcript-tool-call-buffer.test.ts ./src/lib/acp/store/__tests__/session-entry-store-streaming.vitest.ts ./src/lib/acp/store/__tests__/tool-call-event-flow.test.ts`
- TypeScript check:
  - `cd packages/desktop && bun run check`
- Production guard after implementation:
  - `rg -n "appendCompatibilityEntry|replaceCompatibilityEntry" packages/desktop/src/lib/acp/store -g '*.ts' -g '*.svelte' -g '!**/__tests__/**' -g '!**/*.test.ts' -g '!**/*.vitest.ts'`

Expected result: no production compatibility-named canonical entry writers remain.

## Current Verification

- Failing guard before implementation:
  - `rg -n "appendCompatibilityEntry|replaceCompatibilityEntry" packages/desktop/src/lib/acp/store -g '*.ts' -g '*.svelte'`
  - failed as expected with production and test matches
- `cd packages/desktop && bun test ./src/lib/acp/store/services/__tests__/transcript-tool-call-buffer.test.ts ./src/lib/acp/store/__tests__/session-entry-store-streaming.vitest.ts ./src/lib/acp/store/__tests__/tool-call-event-flow.test.ts`
  - passed: 100 tests
- `cd packages/desktop && bun run check`
  - passed with the existing SvelteKit `baseUrl`/`paths` warning
- Guard scan:
  - no matches for `appendCompatibilityEntry` or `replaceCompatibilityEntry` under `packages/desktop/src/lib/acp/store`
