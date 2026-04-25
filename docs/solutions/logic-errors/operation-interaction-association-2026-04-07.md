---
title: Keep operation and interaction association below the UI boundary
date: 2026-04-07
category: logic-errors
module: desktop ACP operation association
problem_type: logic_error
component: assistant
symptoms:
  - One logical execute action could render twice when the tool call and permission used different transport IDs
  - Transcript, session permission bar, queue, kanban, and tab surfaces could disagree about which interaction belonged to which tool execution
  - Provider quirks leaked into Svelte/store helpers instead of staying in adapter-owned association logic
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - operation-store
  - interaction-store
  - permission-store
  - question-store
  - transcript
  - queue
  - kanban
  - tab-bar
tags:
  - operation-store
  - interaction-store
  - provider-agnostic
  - queue
  - transcript
  - svelte
---

# Keep operation and interaction association below the UI boundary

## Problem
Acepe had already unified interaction lifecycle, but tool executions still lacked a canonical domain owner. That left permissions and questions attaching themselves to transcript rows through transport-shaped heuristics such as direct tool-call ID equality or execute-command matching inside UI-adjacent helpers.

When Copilot emitted a real execute tool call plus a permission anchored to `shell-permission`, the same logical action could appear twice because the frontend treated those transport artifacts as separate owners.

## Symptoms
- Transcript rendered the real execute tool call while the session permission bar still showed a second command-shaped surface.
- Queue, kanban, tabs, and live-session surfacing each recomputed pending interaction state from raw maps instead of sharing one answer.
- Fixes wanted to accumulate in component helpers (`permission-visibility`, `tool-call-router`, question selectors) instead of the domain layer.

## What Didn't Work
- Sharing the execute-command matcher as a UI helper. That reduced duplication but still left the architectural smell in the presentation layer.
- Treating `ToolCallManager` and transcript entries as both the write path and the read-side semantic owner. That preserved the lack of canonical operation identity.
- Letting every surface pick "the pending interaction for this session" by scanning its own maps. That guaranteed future drift.

## Solution
Introduce a canonical `OperationStore` and make operation/interaction association a shared store-layer concern.

- `packages/desktop/src/lib/acp/store/operation-store.svelte.ts` now owns canonical operation records keyed by session + tool call, including command extraction, parent/child relationships, transcript entry reference, and indexed lookups.
- `packages/desktop/src/lib/acp/store/services/tool-call-manager.svelte.ts` remains the mutation/reconciliation adapter, but every create/update upserts the canonical operation record as part of the same lifecycle.
- `packages/desktop/src/lib/acp/store/operation-association.ts` now resolves:
  - permission -> operation
  - question -> operation
  - plan approval -> operation
  - session -> shared pending interaction snapshot
- `PermissionStore` and `QuestionStore` expose operation-aware lookups so consumers ask for "the interaction for this operation" instead of reimplementing matching.
- Transcript/tool surfaces read canonical association through the store layer, and queue/kanban/tab/urgency/live-session projections all share the same session interaction snapshot.

## Why This Works
The core fix is ownership, not matching cleverness.

`ToolCallManager` still reacts to transport updates, but it is no longer the only place tool semantics exist. `OperationStore` is the canonical read model, and `operation-association.ts` is the only place that knows how explicit references and compatibility fallback interact. Once that exists, transcript, permission bar, queue, kanban, and tab surfaces can all project the same resolved state instead of performing their own reconciliation.

## Prevention
- Treat provider transport IDs as adapter metadata, not frontend domain identity.
- Keep one canonical owner for tool execution lifecycle (`OperationStore`) and one canonical owner for interaction lifecycle (`InteractionStore`).
- If a UI surface needs to know whether an interaction belongs to an operation, it should ask the association layer rather than inspect raw transport fields itself.
- Prefer explicit references first, then narrow semantic fallback, and fail closed when fallback would be ambiguous.
- Regression coverage that guards this boundary:
  - `packages/desktop/src/lib/acp/store/__tests__/operation-store.vitest.ts`
  - `packages/desktop/src/lib/acp/store/__tests__/operation-association.test.ts`
  - `packages/desktop/src/lib/acp/components/tool-calls/__tests__/operation-interaction-parity.contract.test.ts`
  - `packages/desktop/src/lib/acp/components/tool-calls/__tests__/permission-visibility.test.ts`

## Related Issues
- `docs/solutions/logic-errors/kanban-live-session-panel-sync-2026-04-02.md` covers the earlier form of the same smell: one runtime owner, many projections.
- `docs/plans/2026-04-07-003-refactor-canonical-operation-association-plan.md` contains the implementation plan for this phase.
- `docs/solutions/logic-errors/terminal-state-guard-missing-blocked-2026-04-25.md` — regression in `isTerminalOperationState` where `"blocked"` was absent from the terminal-state set, allowing ToolCall events to overwrite a canonical blocked patch. Same file (`operation-store.svelte.ts`), same class of write-path bypass.
