import * as Match from "effect/Match"
import * as Schema from "effect/Schema"

import { CheckpointFileCount, CheckpointNumber, CheckpointStatus, StreamToken, TrimmedNonEmptyString } from "./baseSchemas.ts"
import { CheckpointId, CommandId, MessageId, ProjectId, SessionId, ToolCallId, TurnId } from "./ids.ts"

export const OrchestrationAggregateKind = Schema.Literals(["project", "session"])
export type OrchestrationAggregateKind = typeof OrchestrationAggregateKind.Type

export type OrchestrationAggregateRef =
	| {
			readonly aggregateKind: "project"
			readonly aggregateId: ProjectId
	  }
	| {
			readonly aggregateKind: "session"
			readonly aggregateId: SessionId
	  }

export const ProjectCreateCommand = Schema.Struct({
	type: Schema.Literal("project.create"),
	commandId: CommandId,
	projectId: ProjectId,
	title: TrimmedNonEmptyString,
	workspaceRoot: TrimmedNonEmptyString,
})
export type ProjectCreateCommand = typeof ProjectCreateCommand.Type

export const ProjectMetaUpdateCommand = Schema.Struct({
	type: Schema.Literal("project.meta.update"),
	commandId: CommandId,
	projectId: ProjectId,
	title: Schema.optionalKey(TrimmedNonEmptyString),
	workspaceRoot: Schema.optionalKey(TrimmedNonEmptyString),
})
export type ProjectMetaUpdateCommand = typeof ProjectMetaUpdateCommand.Type

export const ProjectDeleteCommand = Schema.Struct({
	type: Schema.Literal("project.delete"),
	commandId: CommandId,
	projectId: ProjectId,
})
export type ProjectDeleteCommand = typeof ProjectDeleteCommand.Type

export const SessionCreateCommand = Schema.Struct({
	type: Schema.Literal("session.create"),
	commandId: CommandId,
	sessionId: SessionId,
	projectId: ProjectId,
	title: TrimmedNonEmptyString,
})
export type SessionCreateCommand = typeof SessionCreateCommand.Type

export const SessionPrLinkMode = Schema.Literals(["automatic", "manual"])
export type SessionPrLinkMode = typeof SessionPrLinkMode.Type

export const SessionPrNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
export type SessionPrNumber = typeof SessionPrNumber.Type

export const SessionMetaUpdateCommand = Schema.Struct({
	type: Schema.Literal("session.meta.update"),
	commandId: CommandId,
	sessionId: SessionId,
	title: Schema.optionalKey(TrimmedNonEmptyString),
	prNumber: SessionPrNumber.pipe(Schema.NullOr, Schema.optionalKey),
	prLinkMode: Schema.optionalKey(SessionPrLinkMode),
})
export type SessionMetaUpdateCommand = typeof SessionMetaUpdateCommand.Type

export const SessionArchiveCommand = Schema.Struct({
	type: Schema.Literal("session.archive"),
	commandId: CommandId,
	sessionId: SessionId,
})
export type SessionArchiveCommand = typeof SessionArchiveCommand.Type

export const SessionUnarchiveCommand = Schema.Struct({
	type: Schema.Literal("session.unarchive"),
	commandId: CommandId,
	sessionId: SessionId,
})
export type SessionUnarchiveCommand = typeof SessionUnarchiveCommand.Type

export const SessionDeleteCommand = Schema.Struct({
	type: Schema.Literal("session.delete"),
	commandId: CommandId,
	sessionId: SessionId,
})
export type SessionDeleteCommand = typeof SessionDeleteCommand.Type

export const MessageSendCommand = Schema.Struct({
	type: Schema.Literal("message.send"),
	commandId: CommandId,
	sessionId: SessionId,
	messageId: MessageId,
	text: TrimmedNonEmptyString,
})
export type MessageSendCommand = typeof MessageSendCommand.Type

export const TokenAppendCommand = Schema.Struct({
	type: Schema.Literal("token.append"),
	commandId: CommandId,
	sessionId: SessionId,
	messageId: MessageId,
	token: StreamToken,
})
export type TokenAppendCommand = typeof TokenAppendCommand.Type

export const TurnCancelCommand = Schema.Struct({
	type: Schema.Literal("turn.cancel"),
	commandId: CommandId,
	sessionId: SessionId,
	turnId: Schema.optionalKey(TurnId),
})
export type TurnCancelCommand = typeof TurnCancelCommand.Type

export const CheckpointCreateCommand = Schema.Struct({
	type: Schema.Literal("checkpoint.create"),
	commandId: CommandId,
	sessionId: SessionId,
	checkpointId: CheckpointId,
	checkpointNumber: CheckpointNumber,
	name: Schema.NullOr(TrimmedNonEmptyString),
	isAuto: Schema.Boolean,
	toolCallId: Schema.NullOr(ToolCallId),
	fileCount: CheckpointFileCount,
})
export type CheckpointCreateCommand = typeof CheckpointCreateCommand.Type

export const CheckpointReportReadinessCommand = Schema.Struct({
	type: Schema.Literal("checkpoint.report-readiness"),
	commandId: CommandId,
	sessionId: SessionId,
	checkpointId: CheckpointId,
	status: CheckpointStatus,
})
export type CheckpointReportReadinessCommand = typeof CheckpointReportReadinessCommand.Type

export const CheckpointRevertCommand = Schema.Struct({
	type: Schema.Literal("checkpoint.revert"),
	commandId: CommandId,
	sessionId: SessionId,
	checkpointId: CheckpointId,
})
export type CheckpointRevertCommand = typeof CheckpointRevertCommand.Type

export const OrchestrationCommand = Schema.Union([
	ProjectCreateCommand,
	ProjectMetaUpdateCommand,
	ProjectDeleteCommand,
	SessionCreateCommand,
	SessionMetaUpdateCommand,
	SessionArchiveCommand,
	SessionUnarchiveCommand,
	SessionDeleteCommand,
	MessageSendCommand,
	TokenAppendCommand,
	TurnCancelCommand,
	CheckpointCreateCommand,
	CheckpointReportReadinessCommand,
	CheckpointRevertCommand,
])
export type OrchestrationCommand = typeof OrchestrationCommand.Type

const projectRef = (projectId: ProjectId): OrchestrationAggregateRef => ({
	aggregateKind: "project",
	aggregateId: projectId,
})

const sessionRef = (sessionId: SessionId): OrchestrationAggregateRef => ({
	aggregateKind: "session",
	aggregateId: sessionId,
})

export const commandToAggregateRef = Match.type<OrchestrationCommand>().pipe(
	Match.discriminatorsExhaustive("type")({
		"project.create": (command) => projectRef(command.projectId),
		"project.meta.update": (command) => projectRef(command.projectId),
		"project.delete": (command) => projectRef(command.projectId),
		"session.create": (command) => sessionRef(command.sessionId),
		"session.meta.update": (command) => sessionRef(command.sessionId),
		"session.archive": (command) => sessionRef(command.sessionId),
		"session.unarchive": (command) => sessionRef(command.sessionId),
		"session.delete": (command) => sessionRef(command.sessionId),
		"message.send": (command) => sessionRef(command.sessionId),
		"token.append": (command) => sessionRef(command.sessionId),
		"turn.cancel": (command) => sessionRef(command.sessionId),
		"checkpoint.create": (command) => sessionRef(command.sessionId),
		"checkpoint.report-readiness": (command) => sessionRef(command.sessionId),
		"checkpoint.revert": (command) => sessionRef(command.sessionId),
	}),
)
