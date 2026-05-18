---
title: "refactor: Remove legacy session update type facade"
type: refactor
status: active
date: 2026-05-18
origin: docs/brainstorms/2026-04-25-final-god-architecture-requirements.md
depends_on:
  - docs/plans/2026-05-18-014-refactor-remove-unused-event-subscriber-lanes-plan.md
---

# Refactor: Remove Legacy Session Update Type Facade

## Overview

`packages/desktop/src/lib/acp/types/session-update.ts` re-exports generated Rust/Specta session update types and defines deprecated local aliases:

```text
AvailableCommandsUpdate
CurrentModeUpdate
```

The generated types are already exported from `types/index.ts`. The only direct local consumer of the facade is `turn-error.ts`, which can import `SessionUpdate` from generated types directly.

Target rule:

```text
No local session-update type facade
No deprecated AvailableCommandsUpdate / CurrentModeUpdate aliases
SessionUpdate comes from generated converted-session-types
```

## Scope Boundaries

- Type-only cleanup.
- No behavior change.
- Do not touch generated files.

## Implementation Units

- [x] **Unit 1: Delete Session Update Facade**

**Files:**
- Delete: `packages/desktop/src/lib/acp/types/session-update.ts`
- Modify: `packages/desktop/src/lib/acp/types/turn-error.ts`
- Modify: `packages/desktop/src/lib/acp/types/index.ts`

**Approach:**
- Point `turn-error.ts` at generated `SessionUpdate`.
- Remove legacy exports from `types/index.ts`.
- Delete the facade file.

**Execution result:** `turn-error.ts` imports generated `SessionUpdate` directly, `types/index.ts` no longer exports deprecated update aliases, and the facade file is deleted.

## Verification Plan

- Failing guard before implementation:
  - `rg -n "AvailableCommandsUpdate|CurrentModeUpdate|types/session-update|from \\\"\\./session-update|from './session-update|Re-export legacy types" packages/desktop/src/lib/acp -g '*.ts' -g '*.svelte'`
- TypeScript check:
  - `cd packages/desktop && bun run check`
- Guard scan:
  - same `rg` command returns no matches.

Expected result: generated session update types are the only exported source for session update shapes.

## Current Verification

- Failing guard before implementation:
  - `rg -n "AvailableCommandsUpdate|CurrentModeUpdate|types/session-update|from \\\"\\./session-update|from './session-update|Re-export legacy types" packages/desktop/src/lib/acp -g '*.ts' -g '*.svelte'`
  - failed as expected with the legacy facade and deprecated aliases
- TypeScript check:
  - `cd packages/desktop && bun run check`
  - passed with the existing SvelteKit `baseUrl`/`paths` warning
- Guard scan:
  - no matches for the removed legacy session-update facade or aliases
- `git diff --check`
  - passed
