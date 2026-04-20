---
title: Revisioned session graph contract
date: 2026-04-20
category: architectural
---

# Revisioned session graph contract

## Intent

The session graph is the only canonical owner of session runtime truth.

- **Transcript** stores conversation items.
- **Operations** store runtime work: tool execution, blocking lifecycle, evidence, parent/child links, and completion state.
- **Interactions** store pending permission/question/plan-approval routing plus replies.

Desktop consumers may render transcript-shaped tool rows, but they must not repair or invent operation semantics from those rows.

## Core rule

Every provider signal that describes the same runtime action is treated as a **patch on one canonical operation node**.

Examples:

1. Sparse `tool_call`
2. richer `session/request_permission`
3. later `tool_call_update`
4. replay/open snapshot

All of those ingress paths converge onto the same operation record. The UI reads selectors from that record instead of merging transport payloads itself.

## Behavioral guarantees

| Concern | Contract |
|---|---|
| Operation identity | One logical action stays one operation across live updates, replay, reopen, and reconnect |
| Blocking state | `blocked` lifecycle is canonical and carries a typed blocked reason |
| Evidence | Title, command, locations, and other evidence merge monotonically; thinner later payloads do not erase richer earlier truth |
| Interactions | Permission/question/plan-approval state references operations instead of becoming parallel product-state owners |
| Reconnect | The desktop keeps the last-known canonical operation state visible until a fresh snapshot or post-frontier delta replaces it |

## Desktop implications

- `OperationStore` is updated by graph snapshots and canonical domain events.
- Transcript mutation paths are transcript-only; they do not write canonical operations.
- Component fallbacks are narrow and explicit: direct tool-call lookup is allowed only while waiting for the canonical operation/interactions record to arrive.

## Related

- Plan: `docs/plans/2026-04-19-001-refactor-canonical-session-state-engine-plan.md`
- Plan: `docs/plans/2026-04-20-001-refactor-canonical-operation-state-model-plan.md`
- Solution: `docs/solutions/architectural/provider-owned-semantic-tool-pipeline-2026-04-18.md`
