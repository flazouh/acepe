---
title: "refactor: Remove deprecated submit intent fields"
type: refactor
status: active
date: 2026-05-18
origin: docs/brainstorms/2026-04-25-final-god-architecture-requirements.md
depends_on:
  - docs/plans/2026-05-18-012-refactor-retire-session-runtime-state-plan.md
---

# Refactor: Remove Deprecated Submit Intent Fields

## Overview

`submit-intent.ts` still accepts deprecated compatibility field names:

```text
hasBlockingPendingSessionConfigOperation
isSending
```

Production callers already use the canonical composer policy names:

```text
hasBlockingComposerConfig
isComposerDispatching
```

Keeping fallback field names makes the input contract wider than the actual product model and allows future callers to bypass the canonical composer naming.

## Scope Boundaries

- No behavior change.
- Do not change agent-input UI.
- Only narrow the pure submit-intent input contract and tests.

## Implementation Units

- [x] **Unit 1: Remove Deprecated Input Fields**

**Files:**
- Modify: `packages/desktop/src/lib/acp/logic/submit-intent.ts`
- Modify: `packages/desktop/src/lib/acp/logic/__tests__/submit-intent.test.ts`

**Approach:**
- Remove deprecated fields from input interfaces.
- Remove fallback helper logic.
- Update tests to use canonical field names.

**Execution result:** Removed the deprecated field aliases, deleted fallback resolver helpers, and updated tests to use canonical composer policy names.

## Verification Plan

- Failing guard before implementation:
  - `rg -n "hasBlockingPendingSessionConfigOperation|isSending\\?|@deprecated Use" packages/desktop/src/lib/acp/logic packages/desktop/src/lib/acp/components/agent-input -g '*.ts' -g '*.svelte'`
- Focused tests:
  - `cd packages/desktop && bun test ./src/lib/acp/logic/__tests__/submit-intent.test.ts ./src/lib/acp/logic/__tests__/composer-ui-state.test.ts ./src/lib/acp/components/agent-input/logic/__tests__/historical-session-send.test.ts`
- TypeScript check:
  - `cd packages/desktop && bun run check`
- Guard scan:
  - same `rg` command returns no matches.

Expected result: submit intent logic accepts only canonical composer policy field names.

## Current Verification

- Failing guard before implementation:
  - `rg -n "hasBlockingPendingSessionConfigOperation|isSending\\?|@deprecated Use (hasBlockingComposerConfig|isComposerDispatching)" packages/desktop/src/lib/acp/logic packages/desktop/src/lib/acp/components/agent-input -g '*.ts' -g '*.svelte'`
  - failed as expected with deprecated submit-intent fields
- Focused tests:
  - `cd packages/desktop && bun test ./src/lib/acp/logic/__tests__/submit-intent.test.ts ./src/lib/acp/logic/__tests__/composer-ui-state.test.ts ./src/lib/acp/components/agent-input/logic/__tests__/historical-session-send.test.ts`
  - passed: 21 tests
- TypeScript check:
  - `cd packages/desktop && bun run check`
  - passed with the existing SvelteKit `baseUrl`/`paths` warning
- Guard scan:
  - no matches for the removed deprecated submit-intent aliases
