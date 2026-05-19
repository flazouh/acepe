---
title: "refactor: Rename private transcript test helpers"
type: refactor
status: active
date: 2026-05-18
origin: docs/brainstorms/2026-04-25-final-god-architecture-requirements.md
depends_on:
  - docs/plans/2026-05-18-009-refactor-rename-canonical-entry-writers-plan.md
  - docs/solutions/architectural/live-transcript-display-identity-boundary-2026-05-18.md
---

# Refactor: Rename Private Transcript Test Helpers

## Overview

After canonical entry writer renaming, remaining production `Compatibility...TranscriptEntry` names are private helper methods on `SessionEntryStore`:

```text
preloadCompatibilityEntriesAndBuildIndex(...)
recordCompatibilityToolCallTranscriptEntry(...)
updateCompatibilityToolCallTranscriptEntry(...)
```

They are private, but test-access wrappers call into them. The tool helpers write canonical tool transcript rows, so the compatibility label is stale and weakens the architecture language.

Target names:

```text
preloadLegacyEntriesAndBuildIndex(...)
recordTranscriptToolCallEntry(...)
updateTranscriptToolCallEntry(...)
readStoredEntries(...)
```

## Planning Inventory

Inventory was collected after commit `440890a86`.

### Real GOD Violation Candidates

- `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts`
  - Private tool transcript helpers use compatibility names.

- `packages/desktop/src/lib/acp/store/__tests__/entry-store-test-access.ts`
  - Test-access wrapper names mirror the stale production helper names.

### Legal Or Lower-Risk Findings

- Some test names still describe "compatibility entry reads".
  - Lower risk because they are explicit test descriptions for legacy preload/read behavior.
  - This slice renames helper API surfaces; it does not rewrite every prose test title.

## Scope Boundaries

- Naming-only refactor.
- No behavior change to transcript storage, tool buffering, or operation projection.
- No deletion of legacy preload tests.
- No changes to unrelated agent-panel/tool-duration files.

## Implementation Units

- [x] **Unit 1: Rename Private Store Helpers**

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts`

**Approach:**
- Rename `preloadCompatibilityEntriesAndBuildIndex(...)` to `preloadLegacyEntriesAndBuildIndex(...)`.
- Rename `recordCompatibilityToolCallTranscriptEntry(...)` to `recordTranscriptToolCallEntry(...)`.
- Rename `updateCompatibilityToolCallTranscriptEntry(...)` to `updateTranscriptToolCallEntry(...)`.
- Update comments to distinguish legacy preload from canonical tool transcript writes.

**Execution result:** Renamed the private store helpers and comments. Tool transcript helpers now use canonical names; legacy preload is explicitly labeled as legacy preload.

- [x] **Unit 2: Rename Test Access Wrappers And Callers**

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/__tests__/entry-store-test-access.ts`
- Modify focused tests under `packages/desktop/src/lib/acp/store/__tests__/`

**Approach:**
- Rename wrapper types and exported functions.
- Update imports and calls mechanically.

**Execution result:** Renamed test-access wrappers and callers, including `readStoredEntries(...)`.

- [x] **Unit 3: Update Architecture Note And Guard Scan**

**Files:**
- Modify: `docs/solutions/architectural/live-transcript-display-identity-boundary-2026-05-18.md`

**Approach:**
- Add guard scan for stale private helper names.

**Execution result:** Updated architecture note and guard scan language.

## Verification Plan

- Failing guard before implementation:
  - `rg -n "preloadCompatibilityEntriesAndBuildIndex|recordCompatibilityToolCallTranscriptEntry|updateCompatibilityToolCallTranscriptEntry" packages/desktop/src/lib/acp/store -g '*.ts' -g '*.svelte'`
- Focused tests:
  - `cd packages/desktop && bun test ./src/lib/acp/store/__tests__/session-entry-store-streaming.vitest.ts ./src/lib/acp/store/__tests__/tool-call-event-flow.test.ts ./src/lib/acp/store/__tests__/operation-store.vitest.ts ./src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts`
- TypeScript check:
  - `cd packages/desktop && bun run check`
- Production guard after implementation:
  - `rg -n "preloadCompatibilityEntriesAndBuildIndex|recordCompatibilityToolCallTranscriptEntry|updateCompatibilityToolCallTranscriptEntry" packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts packages/desktop/src/lib/acp/store/__tests__/entry-store-test-access.ts`

Expected result: private production helper names no longer use compatibility language for canonical tool transcript writes.

## Current Verification

- Failing guard before implementation:
  - `rg -n "preloadCompatibilityEntriesAndBuildIndex|recordCompatibilityToolCallTranscriptEntry|updateCompatibilityToolCallTranscriptEntry" packages/desktop/src/lib/acp/store -g '*.ts' -g '*.svelte'`
  - failed as expected with production and test matches
- `cd packages/desktop && bun test ./src/lib/acp/store/__tests__/session-entry-store-streaming.vitest.ts ./src/lib/acp/store/__tests__/tool-call-event-flow.test.ts ./src/lib/acp/store/__tests__/operation-store.vitest.ts ./src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts`
  - passed: 127 tests
- `cd packages/desktop && bun run check`
  - passed with the existing SvelteKit `baseUrl`/`paths` warning
- Guard scan:
  - no matches for the old helper names under `packages/desktop/src/lib/acp/store`
