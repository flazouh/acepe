# AC-033 integration

Do not edit repo-root `package.json` or `tsconfig.base.json` in this lane.

This lane adds `projection.pending-approvals` inside `@acepe/server`. It does not add a workspace package. Apply the snippets below at merge time. Other Wave 5 lanes also touch these files.

## SQL migration `0010`

Number `0010` is assigned to this lane. The migrator skips any id below the highest already applied, so do not apply `0010` to a database that still needs `0008` or `0009`.

File already in tree:

```text
packages/server/src/persistence/Migrations/0010_projection_pending_approvals.ts
```

In `packages/server/src/persistence/Migrations.ts`, add the import and loader entry:

```ts
import projectionPendingApprovals from "./Migrations/0010_projection_pending_approvals.ts"
```

```ts
	"0010_projection_pending_approvals": projectionPendingApprovals
```

In `packages/server/src/persistence/Migrations.test.ts`, append `[10, "projection_pending_approvals"]` to the `runMigrations` result and `{ migration_id: 10, name: "projection_pending_approvals" }` to the `_migrations` rows. Keep `0008` and `0009` from the other Wave 5 lanes in numeric order.

Layer tests in this lane apply `0010` themselves when the table is absent, so they pass before the loader entry lands.

## `packages/server/package.json` exports

Add:

```json
		"./persistence/Layers/ProjectionPendingApprovals": "./src/persistence/Layers/ProjectionPendingApprovals.ts",
		"./persistence/Services/ProjectionPendingApprovals": "./src/persistence/Services/ProjectionPendingApprovals.ts",
```

## Register the projector in `packages/server/src/bootstrap.ts`

Import `ProjectionPendingApprovalsLive` and `ProjectionPendingApprovals`. Merge the live layer into `persistenceAt`. Add `{ name, apply, truncate }` to `ProjectionPipelineLive([...])` next to sessions, messages, and turns.

## Contract events (later)

v1 `OrchestrationEvent` has no approval members. This projection reads a schema-decoded fact at `PENDING_APPROVAL_METADATA_KEY` (`pendingApproval`) on `event.metadata` so Wave 5 can stay off `packages/contracts`. Use `pendingApprovalMetadata(fact)` to write that field.

When a later lane adds tagged members, copy these payloads into `packages/contracts/src/events.ts` and switch the fold to `event.type`:

```ts
ApprovalRequested { sessionId, approvalRequestId }
ApprovalAnswered { sessionId, approvalRequestId, decision: "allow" | "deny" }
```

Add matching commands (`approval.request`, `approval.answer`) so answering goes through `OrchestrationEngine.dispatch`. The engine already makes a second dispatch of the same `commandId` replay the command receipt. After those members exist, add ignore cases to every `Match.discriminatorsExhaustive("type")` on `OrchestrationEvent`.

Answering twice is already proven against `OrchestrationCommandReceipts.replay` in `ProjectionPendingApprovals.test.ts`.
