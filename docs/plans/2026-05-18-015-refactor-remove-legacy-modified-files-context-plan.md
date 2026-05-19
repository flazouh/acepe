---
title: "refactor: Remove legacy modified files context"
type: refactor
status: active
date: 2026-05-18
origin: docs/brainstorms/2026-04-25-final-god-architecture-requirements.md
depends_on:
  - docs/solutions/best-practices/canonical-ui-session-selector-boundary-2026-05-18.md
---

# Refactor: Remove Legacy Modified Files Context

## Overview

`scene-content-viewport.svelte` sets two Svelte contexts for modified file state:

```text
SESSION_CONTEXT_KEY_EXPORT   canonical consolidated session context
"modifiedFilesState"         legacy string context
```

Repository search found no consumer for the legacy string context. Keeping it creates a second access path for session-adjacent panel data and keeps a backwards-compatibility API alive without evidence.

Target rule:

```text
Only SESSION_CONTEXT_KEY_EXPORT provides session context
No "modifiedFilesState" string context remains
```

## GOD Check

This touches session-shaped UI context. The GOD rule is that UI data should flow through named, typed boundaries. String compatibility context is a hidden parallel boundary and should be deleted when unused.

## Scope Boundaries

- No behavior change for current consumers.
- Do not change modified-files aggregation or review-panel behavior.
- Do not touch unrelated UI/tool-duration files.

## Implementation Units

- [x] **Unit 1: Delete Legacy Context**

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/scene-content-viewport.svelte`

**Approach:**
- Remove `setContext("modifiedFilesState", ...)`.
- Keep the typed consolidated session context.
- Fix nearby formatting only if needed.

**Execution result:** Removed the unused string context and kept `SESSION_CONTEXT_KEY_EXPORT` as the only modified-files session context provider.

## Verification Plan

- Failing guard before implementation:
  - `rg -n "setContext\\(\"modifiedFilesState\"|getContext\\(\"modifiedFilesState\"|legacy modifiedFilesState context" packages/desktop/src/lib/acp -g '*.ts' -g '*.svelte'`
- Focused component test:
  - `cd packages/desktop && bunx vitest run ./src/lib/acp/components/agent-panel/components/__tests__/scene-content-viewport.svelte.vitest.ts`
- TypeScript check:
  - `cd packages/desktop && bun run check`
- Guard scan:
  - same `rg` command returns no matches.

Expected result: only typed consolidated session context remains for modified file state.

## Current Verification

- Failing guard before implementation:
  - `rg -n "setContext\\(\"modifiedFilesState\"|getContext\\(\"modifiedFilesState\"|legacy modifiedFilesState context" packages/desktop/src/lib/acp -g '*.ts' -g '*.svelte'`
  - failed as expected with the legacy context provider match
- Component test:
  - `cd packages/desktop && bunx vitest run ./src/lib/acp/components/agent-panel/components/__tests__/scene-content-viewport.svelte.vitest.ts`
  - passed: 38 tests
- TypeScript check:
  - `cd packages/desktop && bun run check`
  - passed with the existing SvelteKit `baseUrl`/`paths` warning
- Guard scan:
  - no matches for the legacy modified-files context provider or consumer
