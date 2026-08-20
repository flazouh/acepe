import type {
	EventId,
	IsoDateTime,
	JsonObject,
	MessageSendCommand,
	MessageSentEvent,
	OrchestrationCommand,
	OrchestrationEvent,
	ProjectCreateCommand,
	ProjectCreatedEvent,
	ProjectDeleteCommand,
	ProjectDeletedEvent,
	ProjectMetaUpdateCommand,
	ProjectMetaUpdatedEvent,
	ProjectMetaUpdatedPayload,
	Sequence,
	SessionArchiveCommand,
	SessionArchivedEvent,
	SessionCreateCommand,
	SessionCreatedEvent,
	SessionDeleteCommand,
	SessionDeletedEvent,
	SessionMetaUpdateCommand,
	SessionMetaUpdatedEvent,
	SessionMetaUpdatedPayload,
	SessionUnarchiveCommand,
	SessionUnarchivedEvent,
	TurnCancelCommand,
	TurnCancelledEvent,
	TurnCancelledPayload
} from "@acepe/contracts"
import * as Effect from "effect/Effect"
import {
	type OrchestrationReadModel,
	requireProject,
	requireProjectAbsent,
	requireSession,
	requireSessionAbsent,
	requireSessionArchived,
	requireSessionNotArchived
} from "./commandInvariants.ts"
import type { OrchestrationCommandInvariantError } from "./Errors.ts"

export type DecideIdentity = {
	readonly eventId: EventId
	readonly occurredAt: IsoDateTime
}

const EMPTY_METADATA: JsonObject = {}

const nextSequence = (snapshotSequence: Sequence): Sequence => snapshotSequence + 1

const projectMetaUpdatedPayload = (command: ProjectMetaUpdateCommand): ProjectMetaUpdatedPayload => {
	if (command.title !== undefined && command.workspaceRoot !== undefined) {
		return {
			projectId: command.projectId,
			title: command.title,
			workspaceRoot: command.workspaceRoot
		}
	}
	if (command.title !== undefined) {
		return {
			projectId: command.projectId,
			title: command.title
		}
	}
	if (command.workspaceRoot !== undefined) {
		return {
			projectId: command.projectId,
			workspaceRoot: command.workspaceRoot
		}
	}
	return { projectId: command.projectId }
}

const sessionMetaUpdatedPayload = (command: SessionMetaUpdateCommand): SessionMetaUpdatedPayload => {
	if (command.title === undefined) {
		return { sessionId: command.sessionId }
	}
	return {
		sessionId: command.sessionId,
		title: command.title
	}
}

const turnCancelledPayload = (command: TurnCancelCommand): TurnCancelledPayload => {
	if (command.turnId === undefined) {
		return { sessionId: command.sessionId }
	}
	return {
		sessionId: command.sessionId,
		turnId: command.turnId
	}
}

const withEnvelope = <
	const Kind extends OrchestrationEvent["aggregateKind"],
	AggregateId extends Extract<OrchestrationEvent, { aggregateKind: Kind }>["aggregateId"]
>(input: {
	readonly sequence: Sequence
	readonly eventId: EventId
	readonly aggregateKind: Kind
	readonly aggregateId: AggregateId
	readonly occurredAt: IsoDateTime
	readonly commandId: OrchestrationEvent["commandId"]
}) => ({
	sequence: input.sequence,
	eventId: input.eventId,
	aggregateKind: input.aggregateKind,
	aggregateId: input.aggregateId,
	occurredAt: input.occurredAt,
	commandId: input.commandId,
	causationEventId: null,
	correlationId: input.commandId,
	metadata: EMPTY_METADATA
})

const projectCreatedEvent = (
	command: ProjectCreateCommand,
	identity: DecideIdentity,
	sequence: Sequence
): ProjectCreatedEvent => ({
	...withEnvelope({
		sequence,
		eventId: identity.eventId,
		aggregateKind: "project",
		aggregateId: command.projectId,
		occurredAt: identity.occurredAt,
		commandId: command.commandId
	}),
	type: "ProjectCreated",
	payload: {
		projectId: command.projectId,
		title: command.title,
		workspaceRoot: command.workspaceRoot
	}
})

const projectMetaUpdatedEvent = (
	command: ProjectMetaUpdateCommand,
	identity: DecideIdentity,
	sequence: Sequence
): ProjectMetaUpdatedEvent => ({
	...withEnvelope({
		sequence,
		eventId: identity.eventId,
		aggregateKind: "project",
		aggregateId: command.projectId,
		occurredAt: identity.occurredAt,
		commandId: command.commandId
	}),
	type: "ProjectMetaUpdated",
	payload: projectMetaUpdatedPayload(command)
})

const projectDeletedEvent = (
	command: ProjectDeleteCommand,
	identity: DecideIdentity,
	sequence: Sequence
): ProjectDeletedEvent => ({
	...withEnvelope({
		sequence,
		eventId: identity.eventId,
		aggregateKind: "project",
		aggregateId: command.projectId,
		occurredAt: identity.occurredAt,
		commandId: command.commandId
	}),
	type: "ProjectDeleted",
	payload: {
		projectId: command.projectId
	}
})

const sessionCreatedEvent = (
	command: SessionCreateCommand,
	identity: DecideIdentity,
	sequence: Sequence
): SessionCreatedEvent => ({
	...withEnvelope({
		sequence,
		eventId: identity.eventId,
		aggregateKind: "session",
		aggregateId: command.sessionId,
		occurredAt: identity.occurredAt,
		commandId: command.commandId
	}),
	type: "SessionCreated",
	payload: {
		sessionId: command.sessionId,
		projectId: command.projectId,
		title: command.title
	}
})

const sessionMetaUpdatedEvent = (
	command: SessionMetaUpdateCommand,
	identity: DecideIdentity,
	sequence: Sequence
): SessionMetaUpdatedEvent => ({
	...withEnvelope({
		sequence,
		eventId: identity.eventId,
		aggregateKind: "session",
		aggregateId: command.sessionId,
		occurredAt: identity.occurredAt,
		commandId: command.commandId
	}),
	type: "SessionMetaUpdated",
	payload: sessionMetaUpdatedPayload(command)
})

const sessionArchivedEvent = (
	command: SessionArchiveCommand,
	identity: DecideIdentity,
	sequence: Sequence
): SessionArchivedEvent => ({
	...withEnvelope({
		sequence,
		eventId: identity.eventId,
		aggregateKind: "session",
		aggregateId: command.sessionId,
		occurredAt: identity.occurredAt,
		commandId: command.commandId
	}),
	type: "SessionArchived",
	payload: {
		sessionId: command.sessionId
	}
})

const sessionUnarchivedEvent = (
	command: SessionUnarchiveCommand,
	identity: DecideIdentity,
	sequence: Sequence
): SessionUnarchivedEvent => ({
	...withEnvelope({
		sequence,
		eventId: identity.eventId,
		aggregateKind: "session",
		aggregateId: command.sessionId,
		occurredAt: identity.occurredAt,
		commandId: command.commandId
	}),
	type: "SessionUnarchived",
	payload: {
		sessionId: command.sessionId
	}
})

const sessionDeletedEvent = (
	command: SessionDeleteCommand,
	identity: DecideIdentity,
	sequence: Sequence
): SessionDeletedEvent => ({
	...withEnvelope({
		sequence,
		eventId: identity.eventId,
		aggregateKind: "session",
		aggregateId: command.sessionId,
		occurredAt: identity.occurredAt,
		commandId: command.commandId
	}),
	type: "SessionDeleted",
	payload: {
		sessionId: command.sessionId
	}
})

const messageSentEvent = (
	command: MessageSendCommand,
	identity: DecideIdentity,
	sequence: Sequence
): MessageSentEvent => ({
	...withEnvelope({
		sequence,
		eventId: identity.eventId,
		aggregateKind: "session",
		aggregateId: command.sessionId,
		occurredAt: identity.occurredAt,
		commandId: command.commandId
	}),
	type: "MessageSent",
	payload: {
		sessionId: command.sessionId,
		messageId: command.messageId,
		text: command.text
	}
})

const turnCancelledEvent = (
	command: TurnCancelCommand,
	identity: DecideIdentity,
	sequence: Sequence
): TurnCancelledEvent => ({
	...withEnvelope({
		sequence,
		eventId: identity.eventId,
		aggregateKind: "session",
		aggregateId: command.sessionId,
		occurredAt: identity.occurredAt,
		commandId: command.commandId
	}),
	type: "TurnCancelled",
	payload: turnCancelledPayload(command)
})

const decideProjectCreate = Effect.fn("decideProjectCreate")(function*(
	readModel: OrchestrationReadModel,
	command: ProjectCreateCommand,
	identity: DecideIdentity
) {
	yield* requireProjectAbsent({
		readModel,
		command,
		projectId: command.projectId
	})
	return [projectCreatedEvent(command, identity, nextSequence(readModel.snapshotSequence))]
})

const decideProjectMetaUpdate = Effect.fn("decideProjectMetaUpdate")(function*(
	readModel: OrchestrationReadModel,
	command: ProjectMetaUpdateCommand,
	identity: DecideIdentity
) {
	yield* requireProject({
		readModel,
		command,
		projectId: command.projectId
	})
	return [projectMetaUpdatedEvent(command, identity, nextSequence(readModel.snapshotSequence))]
})

const decideProjectDelete = Effect.fn("decideProjectDelete")(function*(
	readModel: OrchestrationReadModel,
	command: ProjectDeleteCommand,
	identity: DecideIdentity
) {
	yield* requireProject({
		readModel,
		command,
		projectId: command.projectId
	})
	return [projectDeletedEvent(command, identity, nextSequence(readModel.snapshotSequence))]
})

const decideSessionCreate = Effect.fn("decideSessionCreate")(function*(
	readModel: OrchestrationReadModel,
	command: SessionCreateCommand,
	identity: DecideIdentity
) {
	yield* requireProject({
		readModel,
		command,
		projectId: command.projectId
	})
	yield* requireSessionAbsent({
		readModel,
		command,
		sessionId: command.sessionId
	})
	return [sessionCreatedEvent(command, identity, nextSequence(readModel.snapshotSequence))]
})

const decideSessionMetaUpdate = Effect.fn("decideSessionMetaUpdate")(function*(
	readModel: OrchestrationReadModel,
	command: SessionMetaUpdateCommand,
	identity: DecideIdentity
) {
	yield* requireSessionNotArchived({
		readModel,
		command,
		sessionId: command.sessionId
	})
	return [sessionMetaUpdatedEvent(command, identity, nextSequence(readModel.snapshotSequence))]
})

const decideSessionArchive = Effect.fn("decideSessionArchive")(function*(
	readModel: OrchestrationReadModel,
	command: SessionArchiveCommand,
	identity: DecideIdentity
) {
	yield* requireSessionNotArchived({
		readModel,
		command,
		sessionId: command.sessionId
	})
	return [sessionArchivedEvent(command, identity, nextSequence(readModel.snapshotSequence))]
})

const decideSessionUnarchive = Effect.fn("decideSessionUnarchive")(function*(
	readModel: OrchestrationReadModel,
	command: SessionUnarchiveCommand,
	identity: DecideIdentity
) {
	yield* requireSessionArchived({
		readModel,
		command,
		sessionId: command.sessionId
	})
	return [sessionUnarchivedEvent(command, identity, nextSequence(readModel.snapshotSequence))]
})

const decideSessionDelete = Effect.fn("decideSessionDelete")(function*(
	readModel: OrchestrationReadModel,
	command: SessionDeleteCommand,
	identity: DecideIdentity
) {
	yield* requireSession({
		readModel,
		command,
		sessionId: command.sessionId
	})
	return [sessionDeletedEvent(command, identity, nextSequence(readModel.snapshotSequence))]
})

const decideMessageSend = Effect.fn("decideMessageSend")(function*(
	readModel: OrchestrationReadModel,
	command: MessageSendCommand,
	identity: DecideIdentity
) {
	yield* requireSessionNotArchived({
		readModel,
		command,
		sessionId: command.sessionId
	})
	return [messageSentEvent(command, identity, nextSequence(readModel.snapshotSequence))]
})

const decideTurnCancel = Effect.fn("decideTurnCancel")(function*(
	readModel: OrchestrationReadModel,
	command: TurnCancelCommand,
	identity: DecideIdentity
) {
	yield* requireSessionNotArchived({
		readModel,
		command,
		sessionId: command.sessionId
	})
	return [turnCancelledEvent(command, identity, nextSequence(readModel.snapshotSequence))]
})

export const decide = Effect.fn("decide")(function*(
	readModel: OrchestrationReadModel,
	command: OrchestrationCommand,
	identity: DecideIdentity
): Effect.fn.Return<ReadonlyArray<OrchestrationEvent>, OrchestrationCommandInvariantError> {
	switch (command.type) {
		case "project.create":
			return yield* decideProjectCreate(readModel, command, identity)
		case "project.meta.update":
			return yield* decideProjectMetaUpdate(readModel, command, identity)
		case "project.delete":
			return yield* decideProjectDelete(readModel, command, identity)
		case "session.create":
			return yield* decideSessionCreate(readModel, command, identity)
		case "session.meta.update":
			return yield* decideSessionMetaUpdate(readModel, command, identity)
		case "session.archive":
			return yield* decideSessionArchive(readModel, command, identity)
		case "session.unarchive":
			return yield* decideSessionUnarchive(readModel, command, identity)
		case "session.delete":
			return yield* decideSessionDelete(readModel, command, identity)
		case "message.send":
			return yield* decideMessageSend(readModel, command, identity)
		case "turn.cancel":
			return yield* decideTurnCancel(readModel, command, identity)
	}
})
