---
title: Terminal state guard must include all protected operation states
date: 2026-04-25
category: logic-errors
module: operation-store
problem_type: logic_error
component: tooling
severity: high
symptoms:
  - Sessions stuck in blocked state visually appear as running — no error, no warning
  - Blocked status silently overwritten by in-flight ToolCall events carrying in_progress
  - Regression invisible in logs; the overwrite happens inside upsertToolCall without a trace
root_cause: logic_error
resolution_type: code_fix
related_components:
  - session-store
  - session-transient-projection-store
tags:
  - operation-store
  - terminal-state
  - blocked
  - state-guard
  - svelte-store
  - god-architecture
---

# Terminal state guard must include all protected operation states

## Problem

`isTerminalOperationState` in `operation-store.svelte.ts` listed `completed | failed | cancelled | degraded` but not `"blocked"`. When a ToolCall `in_progress` event arrived after the canonical session graph had already patched `operationState` to `"blocked"`, `upsertToolCall` computed `"running"` and silently overwrote the canonical patch. Sessions that should have been blocked appeared as running.

## Symptoms

- Sessions stuck in blocked state visually appeared as **running** in the UI — no crash, no log entry.
- The overwrite only triggered in the interleaved sequence: canonical graph patch first, ToolCall `in_progress` event second. Running the ToolCall event alone was fine.
- Reversing the event order (ToolCall first, then canonical patch) worked correctly because the patch always wins.

## What Didn't Work

Not applicable — the bug was identified directly from event-ordering analysis. No false fixes attempted.

## Solution

Add `"blocked"` to `isTerminalOperationState` so the function treats it as a protected, non-overwritable state.

**`packages/desktop/src/lib/acp/store/operation-store.svelte.ts`**

```ts
// Before — "blocked" was missing
function isTerminalOperationState(state: OperationState | undefined): boolean {
  return (
    state === "completed" ||
    state === "failed"    ||
    state === "cancelled" ||
    state === "degraded"
  );
}

// After
function isTerminalOperationState(state: OperationState | undefined): boolean {
  return (
    state === "completed" ||
    state === "failed"    ||
    state === "cancelled" ||
    state === "degraded"  ||
    state === "blocked"
  );
}
```

The regression test that pins this (in `operation-store.vitest.ts`):

```ts
it("upsertFromToolCall does not overwrite canonical blocked state", () => {
  const operationStore = new OperationStore();
  // 1. Canonical patch sets operationState = "blocked"
  operationStore.applySessionOperationPatches("session-1", [
    { id: "op-1", tool_call_id: "tool-1", operation_state: "blocked", ... }
  ]);
  expect(operationStore.getByToolCallId("session-1", "tool-1")?.operationState).toBe("blocked");

  // 2. ToolCall in_progress event fires — must NOT overwrite
  entryStore.updateToolCallEntry("session-1", { toolCallId: "tool-1", status: "in_progress", ... });

  expect(operationStore.getByToolCallId("session-1", "tool-1")?.operationState).toBe("blocked");
});
```

## Why This Works

`upsertToolCall` calls `isTerminalOperationState(existingOperation.operationState)` to decide whether to skip updating `operationState`. When `"blocked"` was absent, the function fell through, recomputed state from the ToolCall's `in_progress` status (yielding `"running"`), and stomped the canonical value.

`"blocked"` is semantically terminal from the store's perspective: it is set by the authoritative session-graph patch lane (high authority), not by the streaming ToolCall event lane (lower authority). Once set, no lower-authority event should regress it. The guard is what enforces this boundary.

## Prevention

**Test pattern — always exercise the interleaved event sequence:**

Whenever a new `OperationState` value is added, write a test that applies the canonical patch **first**, then fires a ToolCall `in_progress` upsert **second**, and asserts the canonical state is preserved. Use `applySessionOperationPatches` → `updateToolCallEntry` ordering to mirror the real race condition.

**Make the guard a closed set with a compile-time check:**

```ts
// Single source of truth — adding a new OperationState variant forces an explicit decision
const TERMINAL_OPERATION_STATES = new Set<OperationState>([
  "completed", "failed", "cancelled", "degraded", "blocked",
]);

function isTerminalOperationState(state: OperationState | undefined): boolean {
  return state !== undefined && TERMINAL_OPERATION_STATES.has(state);
}
```

Using a `Set` with a typed union makes an omission visible: TypeScript won't warn you that a new variant is missing, but code reviewers can compare the union type against the set in one glance rather than scanning a chain of `===` comparisons.

## Related Issues

- `docs/solutions/logic-errors/operation-interaction-association-2026-04-07.md` — introduces `OperationStore` as the canonical write owner; the current doc covers a regression in the guard that enforces that ownership.
- `docs/solutions/architectural/final-god-architecture-2026-04-25.md` — the GOD architecture mandates that no raw ACP lane can overwrite settled canonical state; `isTerminalOperationState` is the enforcement mechanism for that rule in the operation lane.
