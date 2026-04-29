---
title: Raw tool-call guards must not treat blocked as terminal
date: 2026-04-25
category: logic-errors
module: operation-store
problem_type: logic_error
component: tooling
severity: high
symptoms:
  - Blocked operations could be overwritten by in-flight ToolCall events carrying in_progress
  - Treating blocked as terminal prevented canonical blocked -> running resume patches
  - Regression was invisible unless event ordering exercised both canonical and raw lanes
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

# Raw tool-call guards must not treat blocked as terminal

## Problem

This note originally recommended adding `"blocked"` to `isTerminalOperationState` because a lower-authority ToolCall `in_progress` event could overwrite a canonical blocked patch. That protected the UI symptom, but it encoded the wrong lifecycle: `blocked` is resumable, not terminal.

The corrected invariant is:

- terminal states are `completed | failed | cancelled | degraded`;
- `blocked` is a non-terminal pause caused by a linked interaction;
- raw ToolCall updates must not overwrite canonical blocked state;
- only canonical operation patches may move `blocked -> running`, `blocked -> cancelled`, or `blocked -> degraded`.

## Symptoms

- Lower-authority ToolCall events could still race after a canonical blocked patch.
- Marking `blocked` terminal stopped that race but also blocked legitimate canonical resume patches.
- `blocked -> running` graph deltas from Rust stayed stuck at `blocked` in `SessionStore` and `OperationStore`.

## What Didn't Work

Adding `"blocked"` to the terminal set was a temporary workaround. It confused lifecycle terminality with raw-lane overwrite protection.

## Solution

Keep `blocked` out of terminal-state guards, then add a separate raw-lane protection guard for ToolCall upserts.

**`packages/desktop/src/lib/acp/store/operation-store.svelte.ts`**

```ts
function isTerminalOperationState(state: OperationState | undefined): boolean {
  if (state === undefined) return false;

  switch (state) {
    case "completed":
    case "failed":
    case "cancelled":
    case "degraded":
      return true;
    case "pending":
    case "running":
    case "blocked":
      return false;
  }
}

function shouldPreserveOperationStateAgainstToolCall(state: OperationState | undefined): boolean {
  return state === "blocked" || isTerminalOperationState(state);
}
```

Regression tests must cover both authority paths:

```ts
it("applies canonical blocked resume patches because blocked is not terminal", () => {
  operationStore.applySessionOperationPatches("session-1", [blockedPatch, runningPatch]);
  expect(operationStore.getByToolCallId("session-1", "tool-1")?.operationState).toBe("running");
});

it("upsertFromToolCall does not overwrite canonical blocked state when ToolCall lane fires", () => {
  operationStore.applySessionOperationPatches("session-1", [blockedPatch]);
  entryStore.updateToolCallEntry("session-1", { toolCallId: "tool-1", status: "in_progress" });
  expect(operationStore.getByToolCallId("session-1", "tool-1")?.operationState).toBe("blocked");
});
```

## Why This Works

Canonical graph patches and raw ToolCall updates no longer share one lifecycle guard. Terminal guards protect truly settled states from stale non-terminal patches. The ToolCall guard protects canonical blocked state from lower-authority raw evidence without pretending blocked is terminal.

## Prevention

**Test pattern - always exercise both directions:**

- canonical patch path: `blocked -> running -> completed`;
- cancellation path: `blocked -> cancelled`;
- degraded path: `blocked -> degraded`;
- lower-authority raw path: blocked canonical patch, then ToolCall `in_progress`, and blocked remains preserved.

**Make terminal-state guards closed-set switches:**

```ts
function isTerminalOperationState(state: OperationState): boolean {
  switch (state) {
    case "completed":
    case "failed":
    case "cancelled":
    case "degraded":
      return true;
    case "pending":
    case "running":
    case "blocked":
      return false;
  }
}
```

With `noImplicitReturns`, adding a new `OperationState` variant forces an explicit terminal/non-terminal decision.

## Related Issues

- `docs/solutions/logic-errors/operation-interaction-association-2026-04-07.md` - introduces `OperationStore` as the canonical write owner; the current doc covers a regression in the guard that enforces that ownership.
- `docs/solutions/architectural/final-god-architecture-2026-04-25.md` - the GOD architecture mandates that no raw ACP lane can overwrite canonical operation truth; raw-lane protection is separate from lifecycle terminality.
