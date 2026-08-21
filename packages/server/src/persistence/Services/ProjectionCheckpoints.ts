import {
	CheckpointCreatedPayload,
	CheckpointFileCount,
	CheckpointId,
	CheckpointNumber,
	CheckpointReadinessChangedPayload,
	CheckpointRevertedPayload,
	CheckpointStatus,
	IsoDateTime,
	type OrchestrationEvent,
	Sequence,
	SessionId,
	ToolCallId,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as SqlClient from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"

export const PROJECTION_CHECKPOINTS_NAME = "projection.checkpoints"
export const PROJECTION_CHECKPOINTS_TABLE = "projection_checkpoints"
export const MAX_PROJECTED_CHECKPOINTS_PER_SESSION = 500

const SqliteFlag = Schema.Literals([0, 1])

export const ProjectedCheckpoint = Schema.Struct({
	checkpointId: CheckpointId,
	sessionId: SessionId,
	sequence: Sequence,
	checkpointNumber: CheckpointNumber,
	name: Schema.NullOr(TrimmedNonEmptyString),
	isAuto: Schema.Boolean,
	toolCallId: Schema.NullOr(ToolCallId),
	fileCount: CheckpointFileCount,
	status: CheckpointStatus,
	createdAt: IsoDateTime,
	lastRevertedAt: Schema.NullOr(IsoDateTime)
})
export type ProjectedCheckpoint = typeof ProjectedCheckpoint.Type

export const ProjectionCheckpointRow = Schema.Struct({
	checkpoint_id: CheckpointId,
	session_id: SessionId,
	sequence: Sequence,
	checkpoint_number: CheckpointNumber,
	name: Schema.NullOr(TrimmedNonEmptyString),
	is_auto: SqliteFlag,
	tool_call_id: Schema.NullOr(ToolCallId),
	file_count: CheckpointFileCount,
	status: CheckpointStatus,
	created_at: IsoDateTime,
	last_reverted_at: Schema.NullOr(IsoDateTime)
})
export type ProjectionCheckpointRow = typeof ProjectionCheckpointRow.Type

export interface ProjectionCheckpointsShape {
	readonly name: TrimmedNonEmptyString
	readonly apply: (
		event: OrchestrationEvent,
		tx: SqlClient.SqlClient
	) => Effect.Effect<void, SqlError | Schema.SchemaError>
	readonly truncate: (
		tx: SqlClient.SqlClient
	) => Effect.Effect<void, SqlError | Schema.SchemaError>
	readonly listBySession: (
		sessionId: SessionId
	) => Effect.Effect<ReadonlyArray<ProjectedCheckpoint>, SqlError | Schema.SchemaError>
	readonly get: (
		checkpointId: CheckpointId
	) => Effect.Effect<Option.Option<ProjectedCheckpoint>, SqlError | Schema.SchemaError>
}

export class ProjectionCheckpoints extends Context.Service<
	ProjectionCheckpoints,
	ProjectionCheckpointsShape
>()("@acepe/server/persistence/Services/ProjectionCheckpoints") {}

const projectedCheckpointFromRow = (row: ProjectionCheckpointRow): ProjectedCheckpoint => ({
	checkpointId: row.checkpoint_id,
	sessionId: row.session_id,
	sequence: row.sequence,
	checkpointNumber: row.checkpoint_number,
	name: row.name,
	isAuto: row.is_auto === 1,
	toolCallId: row.tool_call_id,
	fileCount: row.file_count,
	status: row.status,
	createdAt: row.created_at,
	lastRevertedAt: row.last_reverted_at
})

const decodeRow = Schema.decodeUnknownEffect(ProjectionCheckpointRow)
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(ProjectionCheckpointRow))

export const decodeStoredProjectedCheckpoint = Effect.fn("decodeStoredProjectedCheckpoint")(
	function*(input: unknown) {
		const row = yield* decodeRow(input)
		return projectedCheckpointFromRow(row)
	}
)

export const decodeStoredProjectedCheckpoints = Effect.fn("decodeStoredProjectedCheckpoints")(
	function*(input: unknown) {
		const rows = yield* decodeRows(input)
		return Arr.map(rows, projectedCheckpointFromRow)
	}
)

const decodePayload = <S extends Schema.Top>(schema: S, value: unknown) =>
	Schema.decodeUnknownEffect(schema)(value)

const ignoreEvent = (
	current: Option.Option<ProjectedCheckpoint>
): Effect.Effect<Option.Option<ProjectedCheckpoint>> => Effect.succeed(current)

const projectCheckpointCreated = (
	event: Extract<OrchestrationEvent, { readonly type: "CheckpointCreated" }>
): Effect.Effect<Option.Option<ProjectedCheckpoint>, Schema.SchemaError> =>
	decodePayload(CheckpointCreatedPayload, event.payload).pipe(
		Effect.map((payload) =>
			Option.some({
				checkpointId: payload.checkpointId,
				sessionId: payload.sessionId,
				sequence: event.sequence,
				checkpointNumber: payload.checkpointNumber,
				name: payload.name,
				isAuto: payload.isAuto,
				toolCallId: payload.toolCallId,
				fileCount: payload.fileCount,
				status: "missing" as const,
				createdAt: event.occurredAt,
				lastRevertedAt: null
			})
		)
	)

const projectCheckpointReadinessChanged = (
	current: Option.Option<ProjectedCheckpoint>,
	event: Extract<OrchestrationEvent, { readonly type: "CheckpointReadinessChanged" }>
): Effect.Effect<Option.Option<ProjectedCheckpoint>, Schema.SchemaError> =>
	decodePayload(CheckpointReadinessChangedPayload, event.payload).pipe(
		Effect.map((payload) =>
			Option.map(current, (checkpoint) => ({
				checkpointId: checkpoint.checkpointId,
				sessionId: checkpoint.sessionId,
				sequence: event.sequence,
				checkpointNumber: checkpoint.checkpointNumber,
				name: checkpoint.name,
				isAuto: checkpoint.isAuto,
				toolCallId: checkpoint.toolCallId,
				fileCount: checkpoint.fileCount,
				status: payload.status,
				createdAt: checkpoint.createdAt,
				lastRevertedAt: checkpoint.lastRevertedAt
			}))
		)
	)

const projectCheckpointReverted = (
	current: Option.Option<ProjectedCheckpoint>,
	event: Extract<OrchestrationEvent, { readonly type: "CheckpointReverted" }>
): Effect.Effect<Option.Option<ProjectedCheckpoint>, Schema.SchemaError> =>
	decodePayload(CheckpointRevertedPayload, event.payload).pipe(
		Effect.map(() =>
			Option.map(current, (checkpoint) => ({
				checkpointId: checkpoint.checkpointId,
				sessionId: checkpoint.sessionId,
				sequence: event.sequence,
				checkpointNumber: checkpoint.checkpointNumber,
				name: checkpoint.name,
				isAuto: checkpoint.isAuto,
				toolCallId: checkpoint.toolCallId,
				fileCount: checkpoint.fileCount,
				status: checkpoint.status,
				createdAt: checkpoint.createdAt,
				lastRevertedAt: event.occurredAt
			}))
		)
	)

export const evolveProjectedCheckpoint = (
	current: Option.Option<ProjectedCheckpoint>,
	event: OrchestrationEvent
): Effect.Effect<Option.Option<ProjectedCheckpoint>, Schema.SchemaError> =>
	Match.type<OrchestrationEvent>().pipe(
		Match.discriminatorsExhaustive("type")({
			ProjectCreated: () => ignoreEvent(current),
			ProjectMetaUpdated: () => ignoreEvent(current),
			ProjectDeleted: () => ignoreEvent(current),
			SessionCreated: () => ignoreEvent(current),
			SessionMetaUpdated: () => ignoreEvent(current),
			SessionArchived: () => ignoreEvent(current),
			SessionUnarchived: () => ignoreEvent(current),
			SessionDeleted: () => ignoreEvent(current),
			MessageSent: () => ignoreEvent(current),
			TokenAppended: () => ignoreEvent(current),
			TurnCancelled: () => ignoreEvent(current),
			CheckpointCreated: (created) => projectCheckpointCreated(created),
			CheckpointReadinessChanged: (changed) =>
				projectCheckpointReadinessChanged(current, changed),
			CheckpointReverted: (reverted) => projectCheckpointReverted(current, reverted)
		})
	)(event)

export const checkpointIdFromEvent = (event: OrchestrationEvent): Option.Option<CheckpointId> =>
	Match.type<OrchestrationEvent>().pipe(
		Match.discriminatorsExhaustive("type")({
			ProjectCreated: () => Option.none(),
			ProjectMetaUpdated: () => Option.none(),
			ProjectDeleted: () => Option.none(),
			SessionCreated: () => Option.none(),
			SessionMetaUpdated: () => Option.none(),
			SessionArchived: () => Option.none(),
			SessionUnarchived: () => Option.none(),
			SessionDeleted: () => Option.none(),
			MessageSent: () => Option.none(),
			TokenAppended: () => Option.none(),
			TurnCancelled: () => Option.none(),
			CheckpointCreated: (created) => Option.some(created.payload.checkpointId),
			CheckpointReadinessChanged: (changed) => Option.some(changed.payload.checkpointId),
			CheckpointReverted: (reverted) => Option.some(reverted.payload.checkpointId)
		})
	)(event)
