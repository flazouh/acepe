---
title: "refactor: Delete obsolete assistant streaming hooks"
type: refactor
status: active
date: 2026-05-18
origin: docs/brainstorms/2026-04-25-final-god-architecture-requirements.md
depends_on:
  - docs/plans/2026-05-18-005-refactor-delete-compatibility-chunk-aggregation-plan.md
  - docs/solutions/architectural/live-transcript-display-identity-boundary-2026-05-18.md
---

# Refactor: Delete Obsolete Assistant Streaming Hooks

## Overview

The TypeScript assistant chunk aggregation stack is deleted. Two lifecycle hooks remain:

```text
startNewAssistantTurn(sessionId)
clearStreamingAssistantEntry(sessionId)
```

Both now do nothing except log that assistant chunks are canonical-only. Keeping them in public interfaces and service call sites preserves an obsolete mental model: TypeScript can still reset or split assistant transcript rows.

Target rule:

```text
SessionMessagingService
  -> sends prompts and state-machine events
  -> does not control assistant transcript row boundaries

SessionEntryStore
  -> stores canonical transcript snapshots/deltas
  -> buffers canonical tool rows only
  -> has no assistant chunk lifecycle API
```

## Planning Inventory

Inventory was collected after commit `35b65e6af`.

### Real GOD Violation Candidates

- `packages/desktop/src/lib/acp/store/services/interfaces/entry-manager.ts`
  - `clearStreamingAssistantEntry(...)` and `startNewAssistantTurn(...)` remain on `IEntryManager`.
  - GOD issue: lifecycle-facing services still see assistant row boundary controls.

- `packages/desktop/src/lib/acp/store/services/session-messaging-service.ts`
  - Calls `startNewAssistantTurn(...)` before sending a prompt.
  - Calls `clearStreamingAssistantEntry(...)` on canonical turn failure.
  - GOD issue: these call sites imply TypeScript can repair provider assistant row grouping.

- `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts`
  - Implements both methods as no-op debug logs.
  - GOD issue: obsolete APIs survive after the underlying authority was deleted.

- `packages/desktop/src/lib/acp/store/session-store.svelte.ts`
  - Publicly forwards `clearStreamingAssistantEntry(...)`.
  - GOD issue: public store API exposes an obsolete assistant transcript mutation.

- Tests under `packages/desktop/src/lib/acp/store/services/__tests__/`
  - Mocks still provide the hooks.
  - One test asserts `clearStreamingAssistantEntry(...)` is not called.
  - GOD issue: tests preserve the obsolete contract.

### Legal Or Lower-Risk Findings

- `TranscriptToolCallBuffer` remains in scope for tool rows only.
  - Tool rows are keyed by canonical tool-call ids, not assistant provider message ids.

## Problem Frame

The old hooks were useful when TypeScript grouped raw assistant chunks. Now assistant transcript identity and ordering belong upstream in Rust canonical transcript events. The clean fix is deletion, not keeping no-op compatibility methods.

## Requirements Trace

- R1. Provider facts flow through Rust-owned canonical data before TypeScript display projection.
- R3. Transcript order and transcript identity are product truth.
- R12. UI and store projections consume canonical state; they do not repair provider quirks.
- R23. Desktop stores consume and project canonical state, not repair it.
- R27. Old authorities must be deleted or quarantined with proof.

## Scope Boundaries

- This plan does not remove `TranscriptToolCallBuffer`.
- This plan does not change canonical transcript snapshot/delta application.
- This plan does not change messaging send behavior or state-machine transitions.
- This plan does not touch unrelated agent-panel/tool-duration work currently unstaged.

## Implementation Units

- [x] **Unit 1: Delete Assistant Hook Calls From Messaging Service**

**Goal:** Remove service calls that imply TypeScript controls assistant row boundaries.

**Requirements:** R3, R12, R23

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/services/session-messaging-service.ts`

**Approach:**
- Delete `startNewAssistantTurn(...)` call before prompt send.
- Delete `clearStreamingAssistantEntry(...)` call on canonical turn failure.
- Keep state-machine events and pending-send behavior unchanged.

**Verification:**
- Focused messaging service tests pass.

**Execution result:** Removed both obsolete calls from `SessionMessagingService`; prompt sending and canonical turn failure now leave assistant row boundaries entirely to canonical transcript events.

- [x] **Unit 2: Delete Hooks From Entry Manager Interfaces And Stores**

**Goal:** Remove obsolete assistant lifecycle API from TypeScript stores.

**Requirements:** R12, R23, R27

**Files:**
- Modify: `packages/desktop/src/lib/acp/store/services/interfaces/entry-manager.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-entry-store.svelte.ts`
- Modify: `packages/desktop/src/lib/acp/store/session-store.svelte.ts`

**Approach:**
- Remove `clearStreamingAssistantEntry(...)` and `startNewAssistantTurn(...)` from `IEntryManager`.
- Remove no-op implementations from `SessionEntryStore`.
- Remove public forwarding method from `SessionStore`.

**Verification:**
- No production matches for the removed method names.

**Execution result:** Removed both hooks from `IEntryManager`, `SessionEntryStore`, and the public `SessionStore` facade.

- [x] **Unit 3: Update Tests And Documentation**

**Goal:** Remove obsolete mocks/assertions and record the architecture cleanup.

**Requirements:** R27

**Files:**
- Modify focused tests under `packages/desktop/src/lib/acp/store/services/__tests__/`
- Modify: `docs/solutions/architectural/live-transcript-display-identity-boundary-2026-05-18.md`

**Approach:**
- Remove no-op mock properties from test dependencies.
- Delete assertions that the obsolete hooks are not called.
- Add guard scan to the solution doc.

**Verification:**
- Guard scan has no production matches:
  - `startNewAssistantTurn`
  - `clearStreamingAssistantEntry`

**Execution result:** Removed obsolete mocks/assertions from focused tests and updated the architecture note.

## Verification Plan

- Failing characterization before implementation:
  - `rg -n "startNewAssistantTurn|clearStreamingAssistantEntry" packages/desktop/src/lib/acp/store -g '*.ts' -g '*.svelte'`
- Focused tests:
  - `cd packages/desktop && bun test ./src/lib/acp/store/services/__tests__/session-messaging-service-send-message.test.ts ./src/lib/acp/store/services/__tests__/session-messaging-service-stream-lifecycle.test.ts ./src/lib/acp/store/services/__tests__/session-connection-manager.test.ts`
- TypeScript check:
  - `cd packages/desktop && bun run check`
- Guard scan:
  - `rg -n "startNewAssistantTurn|clearStreamingAssistantEntry" packages/desktop/src/lib/acp/store -g '*.ts' -g '*.svelte'`

Expected result: no obsolete assistant row lifecycle API remains in production code.

## Current Verification

- Failing characterization before implementation:
  - `rg -n "startNewAssistantTurn|clearStreamingAssistantEntry" packages/desktop/src/lib/acp/store -g '*.ts' -g '*.svelte'`
  - failed as expected with production and test matches
- `cd packages/desktop && bun test ./src/lib/acp/store/services/__tests__/session-messaging-service-send-message.test.ts ./src/lib/acp/store/services/__tests__/session-messaging-service-stream-lifecycle.test.ts ./src/lib/acp/store/services/session-connection-manager.test.ts`
  - passed: 72 tests
- `cd packages/desktop && bun test ./src/lib/acp/store/services/__tests__/session-repository-refresh-source-path.test.ts ./src/lib/acp/store/services/__tests__/session-repository-startup-sessions.test.ts ./src/lib/acp/store/services/__tests__/session-repository-placeholder-title.test.ts`
  - passed: 12 tests
- `cd packages/desktop && bun run check`
  - passed with the existing SvelteKit `baseUrl`/`paths` warning
- Guard scan:
  - no matches for `startNewAssistantTurn` or `clearStreamingAssistantEntry` under `packages/desktop/src/lib/acp/store`
