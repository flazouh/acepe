---
title: "refactor: Retire session runtime state logic contract"
type: refactor
status: active
date: 2026-05-18
origin: docs/brainstorms/2026-04-25-final-god-architecture-requirements.md
depends_on:
  - docs/plans/2026-05-18-011-refactor-delete-unused-runtime-state-facade-plan.md
  - docs/solutions/best-practices/canonical-ui-session-selector-boundary-2026-05-18.md
---

# Refactor: Retire Session Runtime State Logic Contract

## Overview

After deleting `SessionStore.getSessionRuntimeState(...)`, the old `SessionRuntimeState` type and `deriveSessionRuntimeState(...)` helper still remain in pure logic and tests.

This is not just naming cleanup. Production now passes canonical lifecycle presentation into composer and panel logic, but the logic contract still calls that input "runtime state." That keeps the old broad lifecycle surface alive and makes it easy to recreate the deleted facade later.

Target rule:

```text
No SessionRuntimeState type
No deriveSessionRuntimeState(...)
Composer and panel logic receive narrow, purpose-named lifecycle inputs
```

## GOD Check

This touches session-shaped UI projection data, so the architecture rule is:

```text
Canonical graph projection -> narrow app selectors -> pure UI logic -> Svelte props
```

The fix must not add UI repair logic or provider-specific behavior. It only tightens the TypeScript boundary around already-canonical lifecycle presentation.

## Planning Inventory

Inventory was collected after commit `736fc05b`.

### Real GOD Violation Candidates

- `packages/desktop/src/lib/acp/logic/session-ui-state.ts`
  - Keeps `SessionRuntimeState` and `deriveSessionRuntimeState(...)` even though the public store facade is gone.

- `packages/desktop/src/lib/acp/logic/composer-ui-state.ts`
  - `deriveStoreComposerState(...)` only needs `canSubmit`, but accepts `SessionRuntimeState | null`.

- `packages/desktop/src/lib/acp/logic/panel-visibility.ts`
  - Panel view derivation only needs a small lifecycle presentation subset, but accepts `SessionRuntimeState | null`.

- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte`
  - Local variable name `runtimeState` now receives canonical lifecycle presentation, which is misleading.

- Tests still build fake `SessionRuntimeState` objects.

### Legal Or Lower-Risk Findings

- `ConnectionPhase`, `ContentPhase`, and `ActivityPhase` are still useful shared unions for canonical lifecycle presentation. Keep them.
- `deriveSessionUIState(...)` still serves the older machine UI derivation path. This slice does not remove it.

## Scope Boundaries

- No behavior change to panel view selection.
- No behavior change to composer sendability.
- No Rust/canonical graph changes.
- No changes to unrelated agent-panel/tool-duration files.

## Implementation Units

- [x] **Unit 1: Narrow Composer Logic Input**

**Files:**
- Modify: `packages/desktop/src/lib/acp/logic/composer-ui-state.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/logic/__tests__/composer-machine.test.ts`

**Approach:**
- Replace `runtime: SessionRuntimeState | null` with a small submit policy type.
- Pass only `canSubmit` from `getSessionLifecyclePresentation(...)`.
- Update tests to build submit policy fixtures, not runtime fixtures.

**Execution result:** `deriveStoreComposerState(...)` now accepts `sessionSubmitPolicy: { canSubmit } | null`, and `SessionStore` passes only canonical lifecycle sendability.

- [x] **Unit 2: Narrow Panel Logic Input**

**Files:**
- Modify: `packages/desktop/src/lib/acp/logic/panel-visibility.ts`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte`
- Modify: `packages/desktop/src/lib/acp/logic/__tests__/panel-visibility.test.ts`

**Approach:**
- Replace `runtimeState` with a purpose-named lifecycle presentation subset.
- Rename the Svelte local derived value to match the canonical source.
- Update tests to build lifecycle presentation fixtures.

**Execution result:** Panel visibility now accepts `lifecyclePresentation`, the Svelte caller uses the same name, and tests no longer build broad runtime objects.

- [x] **Unit 3: Delete Runtime Type And Helper**

**Files:**
- Modify: `packages/desktop/src/lib/acp/logic/session-ui-state.ts`
- Modify: `packages/desktop/src/lib/acp/logic/__tests__/session-machine.test.ts`
- Modify: `packages/desktop/src/lib/acp/store/services/session-connection-manager.ts`
- Modify: `docs/solutions/best-practices/canonical-ui-session-selector-boundary-2026-05-18.md`

**Approach:**
- Delete `SessionRuntimeState` and `deriveSessionRuntimeState(...)`.
- Remove tests that only prove the deleted broad helper.
- Update stale comments/docs.

**Execution result:** Deleted the obsolete type/helper, removed helper-only tests, and updated stale comments.

## Verification Plan

- Failing guard before implementation:
  - `rg -n "SessionRuntimeState|deriveSessionRuntimeState|getSessionRuntimeState\\(" packages/desktop/src/lib/acp -g '*.ts' -g '*.svelte'`
- Focused tests:
  - `cd packages/desktop && bun test ./src/lib/acp/logic/__tests__/composer-machine.test.ts ./src/lib/acp/logic/__tests__/panel-visibility.test.ts ./src/lib/acp/logic/__tests__/session-machine.test.ts ./src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts`
- TypeScript check:
  - `cd packages/desktop && bun run check`
- Guard scan:
  - `rg -n "SessionRuntimeState|deriveSessionRuntimeState|getSessionRuntimeState\\(" packages/desktop/src/lib/acp -g '*.ts' -g '*.svelte'`

Expected result: no runtime-state contract remains in ACP TypeScript/Svelte code.

## Current Verification

- Failing guard before implementation:
  - `rg -n "SessionRuntimeState|deriveSessionRuntimeState|getSessionRuntimeState\\(" packages/desktop/src/lib/acp -g '*.ts' -g '*.svelte'`
  - failed as expected with old type/helper/test/comment matches
- Focused tests:
  - `cd packages/desktop && bun test ./src/lib/acp/logic/__tests__/composer-machine.test.ts ./src/lib/acp/logic/__tests__/panel-visibility.test.ts ./src/lib/acp/logic/__tests__/session-machine.test.ts ./src/lib/acp/store/__tests__/session-store-projection-state.vitest.ts`
  - passed: 122 tests
- TypeScript check:
  - `cd packages/desktop && bun run check`
  - passed with the existing SvelteKit `baseUrl`/`paths` warning
- Guard scan:
  - no matches for `SessionRuntimeState`, `deriveSessionRuntimeState(...)`, or `getSessionRuntimeState(...)` under `packages/desktop/src/lib/acp`
