import {
	ActivityId,
	CommandId,
	EventId,
	IsoDateTime,
	JsonObject,
	type OrchestrationEvent,
	Sequence,
	SessionId,
	ToolCallId,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as HashSet from "effect/HashSet"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as SqlClient from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"

export const PROJECTION_SESSION_ACTIVITIES_NAME = "projection.session-activities"

export const SessionActivityKind = Schema.Literals(["tool", "file"])
export type SessionActivityKind = typeof SessionActivityKind.Type

export const SessionActivityStatus = Schema.Literals([
	"pending",
	"in_progress",
	"completed",
	"failed"
])
export type SessionActivityStatus = typeof SessionActivityStatus.Type

export const OperationId = TrimmedNonEmptyString.pipe(Schema.brand("OperationId"))
export type OperationId = typeof OperationId.Type

export const FILE_OPERATION_KINDS = HashSet.fromIterable([
	"read",
	"edit",
	"write",
	"delete",
	"move"
])

export const STUB_ACTIVITY_TITLE: TrimmedNonEmptyString = "activity"

export const ProjectedSessionActivityRow = Schema.Struct({
	activityId: ActivityId,
	sessionId: SessionId,
	sequence: Sequence,
	statusSequence: Sequence,
	kind: SessionActivityKind,
	toolCallId: Schema.NullOr(ToolCallId),
	operationId: Schema.NullOr(OperationId),
	status: SessionActivityStatus,
	title: TrimmedNonEmptyString,
	path: Schema.NullOr(TrimmedNonEmptyString)
})
export type ProjectedSessionActivityRow = typeof ProjectedSessionActivityRow.Type

export const ProjectionSessionActivityStoredRow = Schema.Struct({
	activity_id: ActivityId,
	session_id: SessionId,
	sequence: Sequence,
	status_sequence: Sequence,
	kind: SessionActivityKind,
	tool_call_id: Schema.NullOr(ToolCallId),
	operation_id: Schema.NullOr(OperationId),
	status: SessionActivityStatus,
	title: TrimmedNonEmptyString,
	path: Schema.NullOr(TrimmedNonEmptyString)
})
export type ProjectionSessionActivityStoredRow = typeof ProjectionSessionActivityStoredRow.Type

export const decodeProjectionSessionActivityStoredRows = Schema.decodeUnknownEffect(
	Schema.Array(ProjectionSessionActivityStoredRow)
)

export const ToolCallObservedPayload = Schema.Struct({
	sessionId: SessionId,
	activityId: ActivityId,
	toolCallId: ToolCallId,
	operationId: Schema.NullOr(OperationId),
	status: SessionActivityStatus,
	title: TrimmedNonEmptyString,
	path: Schema.NullOr(TrimmedNonEmptyString)
})
export type ToolCallObservedPayload = typeof ToolCallObservedPayload.Type

export const FileOperationObservedPayload = Schema.Struct({
	sessionId: SessionId,
	activityId: ActivityId,
	toolCallId: Schema.NullOr(ToolCallId),
	operationId: Schema.NullOr(OperationId),
	status: SessionActivityStatus,
	title: TrimmedNonEmptyString,
	path: TrimmedNonEmptyString
})
export type FileOperationObservedPayload = typeof FileOperationObservedPayload.Type

export const ActivityStatusAdvancedPayload = Schema.Struct({
	sessionId: SessionId,
	activityId: ActivityId,
	status: SessionActivityStatus
})
export type ActivityStatusAdvancedPayload = typeof ActivityStatusAdvancedPayload.Type

export const ActivityOperationLinkedPayload = Schema.Struct({
	sessionId: SessionId,
	activityId: ActivityId,
	operationId: OperationId
})
export type ActivityOperationLinkedPayload = typeof ActivityOperationLinkedPayload.Type

const defineSessionActivityEvent = <
	const EventType extends string,
	Payload extends Schema.Top
>(fields: {
	readonly type: EventType
	readonly payload: Payload
}) =>
	Schema.Struct({
		sequence: Sequence,
		eventId: EventId,
		aggregateKind: Schema.Literal("session"),
		aggregateId: SessionId,
		occurredAt: IsoDateTime,
		commandId: CommandId,
		causationEventId: Schema.NullOr(EventId),
		correlationId: CommandId,
		metadata: JsonObject,
		type: Schema.Literal(fields.type),
		payload: fields.payload
	})

export const ToolCallObservedEvent = defineSessionActivityEvent({
	type: "ToolCallObserved",
	payload: ToolCallObservedPayload
})
export type ToolCallObservedEvent = typeof ToolCallObservedEvent.Type

export const FileOperationObservedEvent = defineSessionActivityEvent({
	type: "FileOperationObserved",
	payload: FileOperationObservedPayload
})
export type FileOperationObservedEvent = typeof FileOperationObservedEvent.Type

export const ActivityStatusAdvancedEvent = defineSessionActivityEvent({
	type: "ActivityStatusAdvanced",
	payload: ActivityStatusAdvancedPayload
})
export type ActivityStatusAdvancedEvent = typeof ActivityStatusAdvancedEvent.Type

export const ActivityOperationLinkedEvent = defineSessionActivityEvent({
	type: "ActivityOperationLinked",
	payload: ActivityOperationLinkedPayload
})
export type ActivityOperationLinkedEvent = typeof ActivityOperationLinkedEvent.Type

export const SessionActivityEvent = Schema.Union([
	ToolCallObservedEvent,
	FileOperationObservedEvent,
	ActivityStatusAdvancedEvent,
	ActivityOperationLinkedEvent
])
export type SessionActivityEvent = typeof SessionActivityEvent.Type

export type ActivityProjectionEvent = OrchestrationEvent | SessionActivityEvent

export interface ProjectionSessionActivitiesShape {
	readonly name: TrimmedNonEmptyString
	readonly apply: (
		event: ActivityProjectionEvent,
		tx: SqlClient.SqlClient
	) => Effect.Effect<void, SqlError | Schema.SchemaError>
	readonly truncate: (
		tx: SqlClient.SqlClient
	) => Effect.Effect<void, SqlError | Schema.SchemaError>
	readonly listBySession: (
		sessionId: SessionId
	) => Effect.Effect<ReadonlyArray<ProjectedSessionActivityRow>, SqlError | Schema.SchemaError>
}

export class ProjectionSessionActivities extends Context.Service<
	ProjectionSessionActivities,
	ProjectionSessionActivitiesShape
>()("@acepe/server/persistence/Services/ProjectionSessionActivities") {}

export const projectedSessionActivityFromRow = (
	row: ProjectionSessionActivityStoredRow
): ProjectedSessionActivityRow => ({
	activityId: row.activity_id,
	sessionId: row.session_id,
	sequence: row.sequence,
	statusSequence: row.status_sequence,
	kind: row.kind,
	toolCallId: row.tool_call_id,
	operationId: row.operation_id,
	status: row.status,
	title: row.title,
	path: row.path
})

export const statusRank = (status: SessionActivityStatus): number =>
	Match.value(status).pipe(
		Match.when("pending", () => 0),
		Match.when("in_progress", () => 1),
		Match.when("completed", () => 2),
		Match.when("failed", () => 2),
		Match.exhaustive
	)

export const shouldTakeIncomingStatus = (
	currentStatus: SessionActivityStatus,
	incomingStatus: SessionActivityStatus,
	currentSequence: Sequence,
	incomingSequence: Sequence
): boolean => {
	if (incomingSequence < currentSequence) {
		return false
	}
	if (incomingSequence === currentSequence) {
		return incomingStatus === currentStatus
	}
	const currentRank = statusRank(currentStatus)
	const incomingRank = statusRank(incomingStatus)
	if (incomingRank < currentRank) {
		return false
	}
	if (incomingRank === currentRank && incomingStatus !== currentStatus) {
		return false
	}
	return true
}

export const activityKindFromTool = (
	kind: string,
	path: TrimmedNonEmptyString | null
): SessionActivityKind => {
	if (path === null) {
		return "tool"
	}
	if (HashSet.has(FILE_OPERATION_KINDS, kind)) {
		return "file"
	}
	return "tool"
}

const isStubTitle = (title: TrimmedNonEmptyString): boolean => title === STUB_ACTIVITY_TITLE

const earlierSequence = (left: Sequence, right: Sequence): Sequence => (left < right ? left : right)

export const mergeActivityRow = (
	current: Option.Option<ProjectedSessionActivityRow>,
	incoming: ProjectedSessionActivityRow
): ProjectedSessionActivityRow => {
	if (Option.isNone(current)) {
		return incoming
	}
	const row = current.value
	const takeIncomingStatus = shouldTakeIncomingStatus(
		row.status,
		incoming.status,
		row.statusSequence,
		incoming.statusSequence
	)
	const fileKind = row.kind === "file" || incoming.kind === "file"
	return {
		activityId: row.activityId,
		sessionId: row.sessionId,
		sequence: earlierSequence(row.sequence, incoming.sequence),
		statusSequence: takeIncomingStatus ? incoming.statusSequence : row.statusSequence,
		kind: fileKind ? "file" : row.kind,
		toolCallId: row.toolCallId === null ? incoming.toolCallId : row.toolCallId,
		operationId: row.operationId === null ? incoming.operationId : row.operationId,
		status: takeIncomingStatus ? incoming.status : row.status,
		title: isStubTitle(row.title) ? incoming.title : row.title,
		path: row.path === null ? incoming.path : row.path
	}
}

const decodePayload = <S extends Schema.Top>(schema: S, value: unknown) =>
	Schema.decodeUnknownEffect(schema)(value)

const observedToolRow = (
	event: { readonly sequence: Sequence },
	payload: ToolCallObservedPayload
): ProjectedSessionActivityRow => ({
	activityId: payload.activityId,
	sessionId: payload.sessionId,
	sequence: event.sequence,
	statusSequence: event.sequence,
	kind: "tool",
	toolCallId: payload.toolCallId,
	operationId: payload.operationId,
	status: payload.status,
	title: payload.title,
	path: payload.path
})

const observedFileRow = (
	event: FileOperationObservedEvent,
	payload: FileOperationObservedPayload
): ProjectedSessionActivityRow => ({
	activityId: payload.activityId,
	sessionId: payload.sessionId,
	sequence: event.sequence,
	statusSequence: event.sequence,
	kind: "file",
	toolCallId: payload.toolCallId,
	operationId: payload.operationId,
	status: payload.status,
	title: payload.title,
	path: payload.path
})

const statusRow = (
	event: ActivityStatusAdvancedEvent,
	payload: ActivityStatusAdvancedPayload
): ProjectedSessionActivityRow => ({
	activityId: payload.activityId,
	sessionId: payload.sessionId,
	sequence: event.sequence,
	statusSequence: event.sequence,
	kind: "tool",
	toolCallId: null,
	operationId: null,
	status: payload.status,
	title: STUB_ACTIVITY_TITLE,
	path: null
})

const linkedRow = (
	event: ActivityOperationLinkedEvent,
	payload: ActivityOperationLinkedPayload
): ProjectedSessionActivityRow => ({
	activityId: payload.activityId,
	sessionId: payload.sessionId,
	sequence: event.sequence,
	statusSequence: 0,
	kind: "tool",
	toolCallId: null,
	operationId: payload.operationId,
	status: "pending",
	title: STUB_ACTIVITY_TITLE,
	path: null
})

const projectToolCallObserved = (
	current: Option.Option<ProjectedSessionActivityRow>,
	event: { readonly sequence: Sequence; readonly payload: unknown }
): Effect.Effect<Option.Option<ProjectedSessionActivityRow>, Schema.SchemaError> =>
	decodePayload(ToolCallObservedPayload, event.payload).pipe(
		Effect.map((payload) => Option.some(mergeActivityRow(current, observedToolRow(event, payload))))
	)

const projectFileOperationObserved = (
	current: Option.Option<ProjectedSessionActivityRow>,
	event: FileOperationObservedEvent
): Effect.Effect<Option.Option<ProjectedSessionActivityRow>, Schema.SchemaError> =>
	decodePayload(FileOperationObservedPayload, event.payload).pipe(
		Effect.map((payload) => Option.some(mergeActivityRow(current, observedFileRow(event, payload))))
	)

const projectStatusAdvanced = (
	current: Option.Option<ProjectedSessionActivityRow>,
	event: ActivityStatusAdvancedEvent
): Effect.Effect<Option.Option<ProjectedSessionActivityRow>, Schema.SchemaError> =>
	decodePayload(ActivityStatusAdvancedPayload, event.payload).pipe(
		Effect.map((payload) => Option.some(mergeActivityRow(current, statusRow(event, payload))))
	)

const projectOperationLinked = (
	current: Option.Option<ProjectedSessionActivityRow>,
	event: ActivityOperationLinkedEvent
): Effect.Effect<Option.Option<ProjectedSessionActivityRow>, Schema.SchemaError> =>
	decodePayload(ActivityOperationLinkedPayload, event.payload).pipe(
		Effect.map((payload) => Option.some(mergeActivityRow(current, linkedRow(event, payload))))
	)

export const activityIdFromEvent = (
	event: ActivityProjectionEvent
): Option.Option<ActivityId> =>
	Match.value(event).pipe(
		Match.when({ type: "ToolCallObserved" }, (observed) => Option.some(observed.payload.activityId)),
		Match.when({ type: "FileOperationObserved" }, (observed) =>
			Option.some(observed.payload.activityId)
		),
		Match.when({ type: "ActivityStatusAdvanced" }, (advanced) =>
			Option.some(advanced.payload.activityId)
		),
		Match.when({ type: "ActivityOperationLinked" }, (linked) => Option.some(linked.payload.activityId)),
		Match.orElse(() => Option.none())
	)

export const evolveSessionActivity = (
	current: Option.Option<ProjectedSessionActivityRow>,
	event: ActivityProjectionEvent
): Effect.Effect<Option.Option<ProjectedSessionActivityRow>, Schema.SchemaError> =>
	Match.value(event).pipe(
		Match.when({ type: "ToolCallObserved" }, (observed) =>
			projectToolCallObserved(current, observed)
		),
		Match.when({ type: "FileOperationObserved" }, (observed) =>
			projectFileOperationObserved(current, observed)
		),
		Match.when({ type: "ActivityStatusAdvanced" }, (advanced) =>
			projectStatusAdvanced(current, advanced)
		),
		Match.when({ type: "ActivityOperationLinked" }, (linked) =>
			projectOperationLinked(current, linked)
		),
		Match.orElse(() => Effect.succeed(current))
	)
