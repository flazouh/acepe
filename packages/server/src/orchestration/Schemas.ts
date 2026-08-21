import {
	CheckpointId,
	IsoDateTime,
	MessageId,
	ProjectId,
	Sequence,
	SessionId,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as Schema from "effect/Schema"

export const MAX_SESSION_MESSAGES = 2_000
export const MAX_SESSION_CHECKPOINTS = 500

export {
	MessageSentPayload,
	ProjectCreatedPayload,
	ProjectDeletedPayload,
	ProjectMetaUpdatedPayload,
	TokenAppendedPayload,
	SessionArchivedPayload,
	SessionCreatedPayload,
	SessionDeletedPayload,
	SessionMetaUpdatedPayload,
	SessionUnarchivedPayload,
	TurnCancelledPayload
} from "@acepe/contracts"

export class OrchestrationProjectorDecodeError extends Schema.TaggedError<OrchestrationProjectorDecodeError>()(
	"OrchestrationProjectorDecodeError",
	{
		eventType: Schema.String,
		field: Schema.String,
		issue: Schema.String
	}
) {}

export const OrchestrationProject = Schema.Struct({
	id: ProjectId,
	title: TrimmedNonEmptyString,
	workspaceRoot: TrimmedNonEmptyString,
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	deletedAt: Schema.NullOr(IsoDateTime)
})
export type OrchestrationProject = typeof OrchestrationProject.Type

export const OrchestrationSessionMessage = Schema.Struct({
	id: MessageId,
	text: TrimmedNonEmptyString,
	createdAt: IsoDateTime
})
export type OrchestrationSessionMessage = typeof OrchestrationSessionMessage.Type

export const OrchestrationSessionCheckpoint = Schema.Struct({
	id: CheckpointId,
	createdAt: IsoDateTime
})
export type OrchestrationSessionCheckpoint = typeof OrchestrationSessionCheckpoint.Type

export const OrchestrationSession = Schema.Struct({
	id: SessionId,
	projectId: ProjectId,
	title: TrimmedNonEmptyString,
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	archivedAt: Schema.NullOr(IsoDateTime),
	deletedAt: Schema.NullOr(IsoDateTime),
	messages: Schema.Array(OrchestrationSessionMessage).check(
		Schema.isMaxLength(MAX_SESSION_MESSAGES)
	),
	checkpoints: Schema.Array(OrchestrationSessionCheckpoint).check(
		Schema.isMaxLength(MAX_SESSION_CHECKPOINTS)
	)
})
export type OrchestrationSession = typeof OrchestrationSession.Type

export const OrchestrationReadModel = Schema.Struct({
	snapshotSequence: Sequence,
	projects: Schema.Array(OrchestrationProject),
	sessions: Schema.Array(OrchestrationSession),
	updatedAt: IsoDateTime
})
export type OrchestrationReadModel = typeof OrchestrationReadModel.Type
