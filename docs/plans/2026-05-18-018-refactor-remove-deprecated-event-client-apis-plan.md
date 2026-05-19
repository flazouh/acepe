---
title: "refactor: Remove deprecated event and client APIs"
type: refactor
status: active
date: 2026-05-18
origin: docs/brainstorms/2026-04-25-final-god-architecture-requirements.md
depends_on:
  - docs/plans/2026-05-18-014-refactor-remove-unused-event-subscriber-lanes-plan.md
---

# Refactor: Remove Deprecated Event And Client APIs

## Overview

Two active-code deprecated APIs remain:

- `AcpClient.resumeSessionSafe(...)`
  - Wrapper around `resumeSession(...)`.
  - No callers.
- `EventSubscriber.unsubscribe()`
  - Bulk cleanup method.
  - Production can use `unsubscribeById(...)` for the two owned subscriptions.

Target rule:

```text
No deprecated active-code session/client APIs remain
EventSubscriber cleanup uses explicit subscription IDs
AcpClient exposes only the real resume API
```

## Scope Boundaries

- No behavior change to subscription lifecycle.
- No Rust changes.
- Do not touch unrelated UI/tool-duration files.

## Implementation Units

- [x] **Unit 1: Delete AcpClient Wrapper**

**Files:**
- Modify: `packages/desktop/src/lib/acp/logic/acp-client.ts`
- Modify: `packages/desktop/src/lib/acp/logic/connection-manager.ts`

**Approach:**
- Remove `resumeSessionSafe(...)`.
- Remove stale comment references.

**Execution result:** Deleted `resumeSessionSafe(...)` and removed the stale comment reference.

- [x] **Unit 2: Delete Bulk Event Unsubscribe**

**Files:**
- Modify: `packages/desktop/src/lib/acp/logic/event-subscriber.ts`
- Modify: `packages/desktop/src/lib/acp/logic/__tests__/event-subscriber.test.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-event-service.svelte.ts`

**Approach:**
- Replace production `unsubscribe()` calls with explicit `unsubscribeById(...)`.
- Delete the deprecated method and its test.

**Execution result:** Session event cleanup now unregisters both owned subscriptions by ID, and the bulk unsubscribe API/test are deleted.

## Verification Plan

- Failing guard before implementation:
  - `rg -n "resumeSessionSafe|@deprecated Use resumeSession|@deprecated Use unsubscribeById|\\.unsubscribe\\(\\)" packages/desktop/src/lib/acp -g '*.ts' -g '*.svelte'`
- Focused tests:
  - `cd packages/desktop && bun test ./src/lib/acp/logic/__tests__/event-subscriber.test.ts ./src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts`
- TypeScript check:
  - `cd packages/desktop && bun run check`
- Guard scan:
  - same `rg` command returns no matches.

Expected result: active-code session/client deprecated APIs are gone.

## Current Verification

- Failing guard before implementation:
  - `rg -n "resumeSessionSafe|@deprecated Use resumeSession|@deprecated Use unsubscribeById|\\.unsubscribe\\(\\)" packages/desktop/src/lib/acp -g '*.ts' -g '*.svelte'`
  - failed as expected with deprecated wrapper/method matches
- Focused tests:
  - `cd packages/desktop && bun test ./src/lib/acp/logic/__tests__/event-subscriber.test.ts ./src/lib/acp/store/__tests__/session-event-service-streaming.vitest.ts`
  - passed: 69 tests
- TypeScript check:
  - `cd packages/desktop && bun run check`
  - passed with the existing SvelteKit `baseUrl`/`paths` warning
- Guard scan:
  - no matches for removed deprecated event/client APIs
