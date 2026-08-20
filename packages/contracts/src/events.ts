import * as Schema from "effect/Schema"

import { IsoDateTime, JsonObject, Sequence, TrimmedNonEmptyString } from "./baseSchemas.ts"
import { CommandId, EventId, MessageId, ProjectId, SessionId, TurnId } from "./ids.ts"
import type { OrchestrationAggregateKind } from "./orchestration.ts"

export const CorrelationId = CommandId
export type CorrelationId = typeof CorrelationId.Type

export const OrchestrationEventType = Schema.Literals([
	"ProjectCreated",
	"ProjectMetaUpdated",
	"ProjectDeleted",
	"SessionCreated",
	"SessionMetaUpdated",
	"SessionArchived",
	"SessionUnarchived",
	"SessionDeleted",
	"MessageSent",
	"TurnCancelled",
])
export type OrchestrationEventType = typeof OrchestrationEventType.Type

export const ProjectCreatedPayload = Schema.Struct({
	projectId: ProjectId,
	title: TrimmedNonEmptyString,
	workspaceRoot: TrimmedNonEmptyString,
})
export type ProjectCreatedPayload = typeof ProjectCreatedPayload.Type

export const ProjectMetaUpdatedPayload = Schema.Struct({
	projectId: ProjectId,
	title: Schema.optionalKey(TrimmedNonEmptyString),
	workspaceRoot: Schema.optionalKey(TrimmedNonEmptyString),
})
export type ProjectMetaUpdatedPayload = typeof ProjectMetaUpdatedPayload.Type

export const ProjectDeletedPayload = Schema.Struct({
	projectId: ProjectId,
})
export type ProjectDeletedPayload = typeof ProjectDeletedPayload.Type

export const SessionCreatedPayload = Schema.Struct({
	sessionId: SessionId,
	projectId: ProjectId,
	title: TrimmedNonEmptyString,
})
export type SessionCreatedPayload = typeof SessionCreatedPayload.Type

export const SessionMetaUpdatedPayload = Schema.Struct({
	sessionId: SessionId,
	title: Schema.optionalKey(TrimmedNonEmptyString),
})
export type SessionMetaUpdatedPayload = typeof SessionMetaUpdatedPayload.Type

export const SessionArchivedPayload = Schema.Struct({
	sessionId: SessionId,
})
export type SessionArchivedPayload = typeof SessionArchivedPayload.Type

export const SessionUnarchivedPayload = Schema.Struct({
	sessionId: SessionId,
})
export type SessionUnarchivedPayload = typeof SessionUnarchivedPayload.Type

export const SessionDeletedPayload = Schema.Struct({
	sessionId: SessionId,
})
export type SessionDeletedPayload = typeof SessionDeletedPayload.Type

export const MessageSentPayload = Schema.Struct({
	sessionId: SessionId,
	messageId: MessageId,
	text: TrimmedNonEmptyString,
})
export type MessageSentPayload = typeof MessageSentPayload.Type

export const TurnCancelledPayload = Schema.Struct({
	sessionId: SessionId,
	turnId: Schema.optionalKey(TurnId),
})
export type TurnCancelledPayload = typeof TurnCancelledPayload.Type

const defineOrchestrationEvent = <
	const EventType extends OrchestrationEventType,
	Payload extends Schema.Top,
	const Kind extends OrchestrationAggregateKind,
	AggregateId extends Schema.Top,
>(fields: {
	readonly type: EventType
	readonly payload: Payload
	readonly aggregateKind: Kind
	readonly aggregateId: AggregateId
}) =>
	Schema.Struct({
		sequence: Sequence,
		eventId: EventId,
		aggregateKind: Schema.Literal(fields.aggregateKind),
		aggregateId: fields.aggregateId,
		occurredAt: IsoDateTime,
		commandId: CommandId,
		causationEventId: Schema.NullOr(EventId),
		correlationId: CorrelationId,
		metadata: JsonObject,
		type: Schema.Literal(fields.type),
		payload: fields.payload,
	})

export const ProjectCreatedEvent = defineOrchestrationEvent({
	type: "ProjectCreated",
	payload: ProjectCreatedPayload,
	aggregateKind: "project",
	aggregateId: ProjectId,
})
export type ProjectCreatedEvent = typeof ProjectCreatedEvent.Type

export const ProjectMetaUpdatedEvent = defineOrchestrationEvent({
	type: "ProjectMetaUpdated",
	payload: ProjectMetaUpdatedPayload,
	aggregateKind: "project",
	aggregateId: ProjectId,
})
export type ProjectMetaUpdatedEvent = typeof ProjectMetaUpdatedEvent.Type

export const ProjectDeletedEvent = defineOrchestrationEvent({
	type: "ProjectDeleted",
	payload: ProjectDeletedPayload,
	aggregateKind: "project",
	aggregateId: ProjectId,
})
export type ProjectDeletedEvent = typeof ProjectDeletedEvent.Type

export const SessionCreatedEvent = defineOrchestrationEvent({
	type: "SessionCreated",
	payload: SessionCreatedPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type SessionCreatedEvent = typeof SessionCreatedEvent.Type

export const SessionMetaUpdatedEvent = defineOrchestrationEvent({
	type: "SessionMetaUpdated",
	payload: SessionMetaUpdatedPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type SessionMetaUpdatedEvent = typeof SessionMetaUpdatedEvent.Type

export const SessionArchivedEvent = defineOrchestrationEvent({
	type: "SessionArchived",
	payload: SessionArchivedPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type SessionArchivedEvent = typeof SessionArchivedEvent.Type

export const SessionUnarchivedEvent = defineOrchestrationEvent({
	type: "SessionUnarchived",
	payload: SessionUnarchivedPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type SessionUnarchivedEvent = typeof SessionUnarchivedEvent.Type

export const SessionDeletedEvent = defineOrchestrationEvent({
	type: "SessionDeleted",
	payload: SessionDeletedPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type SessionDeletedEvent = typeof SessionDeletedEvent.Type

export const MessageSentEvent = defineOrchestrationEvent({
	type: "MessageSent",
	payload: MessageSentPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type MessageSentEvent = typeof MessageSentEvent.Type

export const TurnCancelledEvent = defineOrchestrationEvent({
	type: "TurnCancelled",
	payload: TurnCancelledPayload,
	aggregateKind: "session",
	aggregateId: SessionId,
})
export type TurnCancelledEvent = typeof TurnCancelledEvent.Type

export const OrchestrationEvent = Schema.Union([
	ProjectCreatedEvent,
	ProjectMetaUpdatedEvent,
	ProjectDeletedEvent,
	SessionCreatedEvent,
	SessionMetaUpdatedEvent,
	SessionArchivedEvent,
	SessionUnarchivedEvent,
	SessionDeletedEvent,
	MessageSentEvent,
	TurnCancelledEvent,
])
export type OrchestrationEvent = typeof OrchestrationEvent.Type
