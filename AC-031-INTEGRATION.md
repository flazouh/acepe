# AC-031 root integration

Do not edit this in the same change as another lane's root file.

This lane does not add a package. Root `package.json` and `tsconfig.base.json` do not change. `packages/server` already has `typecheck` and `lint:effect`.

## `packages/server/src/bootstrap.ts`

Register the projector in `persistenceAt` and `pipelineLayer`. Other Wave 5 lanes also edit this file.

Add the imports:

```ts
import { ProjectionSessionActivitiesLive } from "./persistence/Layers/ProjectionSessionActivities.ts"
import {
	PROJECTION_SESSION_ACTIVITIES_NAME,
	ProjectionSessionActivities
} from "./persistence/Services/ProjectionSessionActivities.ts"
```

Add `ProjectionSessionActivitiesLive` to the `Layer.mergeAll` inside `persistenceAt`.

Add this projector to the `ProjectionPipelineLive([...])` array, after the session-messages entry:

```ts
const activities = yield* ProjectionSessionActivities
return ProjectionPipelineLive([
	{
		name: sessions.name,
		apply: sessions.apply,
		truncate: sessions.truncate
	},
	{
		name: messagesName,
		apply: messages.apply,
		truncate: messages.truncate
	},
	{
		name: activities.name,
		apply: (event, tx) => activities.apply(event, tx),
		truncate: activities.truncate
	}
])
```

`PROJECTION_SESSION_ACTIVITIES_NAME` is `"projection.session-activities"`. The live service already decodes that as `name`.

## OrchestrationEvent tagged members

Activity facts are defined in `packages/server/src/persistence/Services/ProjectionSessionActivities.ts` as `SessionActivityEvent`. The event store still decodes `OrchestrationEvent` from AC-004, so production catch-up cannot persist these members until they are added to `packages/contracts/src/events.ts`.

Add these tagged members. Do not change existing payloads.

- `ToolCallObserved`
- `FileOperationObserved`
- `ActivityStatusAdvanced`
- `ActivityOperationLinked`

Payload schemas are `ToolCallObservedPayload`, `FileOperationObservedPayload`, `ActivityStatusAdvancedPayload`, and `ActivityOperationLinkedPayload` in that service file. After the union includes them, every `Match.discriminatorsExhaustive("type")` on `OrchestrationEvent` needs an ignore or handle case: `projector.ts`, `ProjectionSessions.ts`, `ProjectionSessionMessages.ts`.

Until that merge, tests feed `SessionActivityEvent` through `ProjectionSessionActivities.apply` and through a test `OrchestrationEventStore` for `rebuild("projection.session-activities")`.

## Already done in this lane

- Migration `0008_projection_session_activities` is registered in `packages/server/src/persistence/Migrations.ts`.
- `packages/server/src/persistence/Migrations.test.ts` expects id `8` named `projection_session_activities`.
- `packages/server/package.json` exports the service and layer.
- `ProjectionSnapshotQuery.test.ts` uses `CREATE TABLE IF NOT EXISTS` for the optional Wave 5 tables so 0008 does not break the stub `CREATE TABLE`.
