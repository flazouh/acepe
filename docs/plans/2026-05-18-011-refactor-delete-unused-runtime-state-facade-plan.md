---
title: "refactor: Delete unused runtime state facade"
type: refactor
status: active
date: 2026-05-18
origin: docs/brainstorms/2026-04-25-final-god-architecture-requirements.md
depends_on:
  - docs/plans/2026-05-18-002-refactor-canonical-ui-session-projections-plan.md
  - docs/solutions/best-practices/canonical-ui-session-selector-boundary-2026-05-18.md
---

# Refactor: Delete Unused Runtime State Facade

## Overview

`SessionStore.getSessionRuntimeState(...)` remains public, but production search shows no production caller. It reads hot state as a reactive anchor and derives an old runtime view from the XState machine.

Current production selectors already use canonical lifecycle/presentation APIs:

```text
getSessionLifecyclePresentation(...)
getStoreComposerState(...)
getCanonicalSessionProjection(...)
```

Target rule:

```text
No public getSessionRuntimeState(...)
No stale comments telling UI consumers to use it
Tests assert canonical lifecycle/presentation selectors instead
```

## Planning Inventory

Inventory was collected after commit `d588c7303`.

### Real GOD Violation Candidates

- `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
  - Public `getSessionRuntimeState(...)` remains even though production code does not use it.
  - It mixes machine-derived state with `pendingSendIntent`, which is local transient state.

- `packages/desktop/src/lib/acp/store/session-connection-service.svelte.ts`
  - Stale comment says components should use `$derived(store.getSessionRuntimeState(id))`.

- Tests under `packages/desktop/src/lib/acp/store/__tests__/` and component test mocks
  - Still mock or assert the old public method.

### Legal Or Lower-Risk Findings

- `deriveSessionRuntimeState(...)` can remain in `session-ui-state` if other modules or future tests need it.
  - This slice removes the public `SessionStore` facade only.

## Scope Boundaries

- No behavior change to canonical lifecycle state.
- No change to composer state machines.
- No changes to unrelated agent-panel/tool-duration files.

## Implementation Units

- [x] **Unit 1: Delete Public Runtime Facade**

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-connection-service.svelte.ts`

**Approach:**
- Remove `getSessionRuntimeState(...)`.
- Remove unused imports.
- Update stale comment to mention `getState()`/canonical selectors instead.

**Execution result:** Deleted `SessionStore.getSessionRuntimeState(...)`, removed unused imports, and updated the stale connection-service comment.

- [x] **Unit 2: Update Tests And Mocks**

**Files:**
- Modify focused tests that mention `getSessionRuntimeState(...)`.

**Approach:**
- Remove no-longer-needed mocks.
- Rewrite store assertions to use `getSessionLifecyclePresentation(...)`, `getSessionCanSend(...)`, or canonical projection selectors.

**Execution result:** Removed stale mocks and rewrote store assertions to use canonical lifecycle/UI selectors.

- [x] **Unit 3: Update Architecture Note And Guard Scan**

**Files:**
- Modify: `docs/solutions/best-practices/canonical-ui-session-selector-boundary-2026-05-18.md`

**Approach:**
- Add guard scan for the removed public facade.

**Execution result:** Updated the canonical selector boundary doc and confirmed the old facade is gone.

## Verification Plan

- Failing guard before implementation:
  - `rg -n "getSessionRuntimeState\\(" packages/desktop/src/lib/acp -g '*.ts' -g '*.svelte'`
- Focused tests:
  - `cd packages/desktop && bun test ./src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts ./src/lib/acp/store/__tests__/tab-bar-store-non-agent.vitest.ts ./src/lib/acp/store/__tests__/urgency-tabs-store.test.ts ./src/lib/acp/components/agent-panel/components/__tests__/agent-panel-content.svelte.vitest.ts`
- TypeScript check:
  - `cd packages/desktop && bun run check`
- Guard scan:
  - `rg -n "getSessionRuntimeState\\(" packages/desktop/src/lib/acp -g '*.ts' -g '*.svelte'`

Expected result: no public runtime-state facade remains.

## Current Verification

- Failing guard before implementation:
  - `rg -n "getSessionRuntimeState\\(" packages/desktop/src/lib/acp -g '*.ts' -g '*.svelte'`
  - failed as expected with production/test/comment matches
- `cd packages/desktop && bun test ./src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts ./src/lib/acp/store/__tests__/tab-bar-store-non-agent.vitest.ts ./src/lib/acp/store/__tests__/urgency-tabs-store.test.ts`
  - passed: 65 tests
- `cd packages/desktop && bunx vitest run ./src/lib/acp/components/agent-panel/components/__tests__/agent-panel-content.svelte.vitest.ts`
  - passed: 7 tests
- `cd packages/desktop && bun run check`
  - passed with the existing SvelteKit `baseUrl`/`paths` warning
- Guard scan:
  - no matches for `getSessionRuntimeState(...)` under `packages/desktop/src/lib/acp`
