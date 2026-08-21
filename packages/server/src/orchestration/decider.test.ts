import {
	CommandId,
	EventId,
	MessageId,
	MessageSendCommand,
	ProjectCreateCommand,
	ProjectDeleteCommand,
	ProjectId,
	ProjectMetaUpdateCommand,
	SessionArchiveCommand,
	SessionCreateCommand,
	SessionDeleteCommand,
	SessionId,
	SessionMetaUpdateCommand,
	SessionUnarchiveCommand,
	TokenAppendCommand,
	TurnCancelCommand,
	TurnId
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import type { OrchestrationReadModel } from "./commandInvariants.ts"
import { type DecideIdentity, decide } from "./decider.ts"

const occurredAt = "2026-08-20T12:00:00.000Z"
const laterOccurredAt = "2026-08-20T13:00:00.000Z"
const commandId = CommandId.make("cmd-1")
const eventId = EventId.make("event-1")
const otherEventId = EventId.make("event-2")
const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const messageId = MessageId.make("message-1")
const turnId = TurnId.make("turn-1")

const identity: DecideIdentity = {
	eventId,
	occurredAt
}

const emptyReadModel: OrchestrationReadModel = {
	snapshotSequence: 0,
	projects: [],
	sessions: []
}

const projectReadModel: OrchestrationReadModel = {
	snapshotSequence: 1,
	projects: [{ id: projectId }],
	sessions: []
}

const sessionReadModel: OrchestrationReadModel = {
	snapshotSequence: 2,
	projects: [{ id: projectId }],
	sessions: [
		{
			id: sessionId,
			projectId,
			archivedAt: null
		}
	]
}

const archivedSessionReadModel: OrchestrationReadModel = {
	snapshotSequence: 3,
	projects: [{ id: projectId }],
	sessions: [
		{
			id: sessionId,
			projectId,
			archivedAt: occurredAt
		}
	]
}

const createProjectCommand = ProjectCreateCommand.make({
	type: "project.create",
	commandId,
	projectId,
	title: "Acepe",
	workspaceRoot: "/tmp/acepe"
})

Vitest.describe("decide", () => {
	Vitest.it.effect("emits identical events when run twice with the same inputs", () =>
		Effect.gen(function*() {
			const first = yield* decide(emptyReadModel, createProjectCommand, identity)
			const second = yield* decide(emptyReadModel, createProjectCommand, identity)
			Vitest.assert.deepStrictEqual(first, second)
			Vitest.assert.deepStrictEqual(first, [
				{
					sequence: 1,
					eventId,
					aggregateKind: "project",
					aggregateId: projectId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "ProjectCreated",
					payload: {
						projectId,
						title: "Acepe",
						workspaceRoot: "/tmp/acepe"
					}
				}
			])
		})
	)

	Vitest.it.effect("uses the injected event id and timestamp rather than generating them inline", () =>
		Effect.gen(function*() {
			const events = yield* decide(emptyReadModel, createProjectCommand, {
				eventId: otherEventId,
				occurredAt: laterOccurredAt
			})
			const event = events[0]
			Vitest.assert.isDefined(event)
			Vitest.assert.strictEqual(event.eventId, otherEventId)
			Vitest.assert.strictEqual(event.occurredAt, laterOccurredAt)
		})
	)

	Vitest.it.effect("rejects project.create when the project already exists", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decide(projectReadModel, createProjectCommand, identity)
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(
				error.detail,
				"Project 'project-1' already exists and cannot be created twice."
			)
		})
	)

	Vitest.it.effect("emits ProjectMetaUpdated from the command fields", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				projectReadModel,
				ProjectMetaUpdateCommand.make({
					type: "project.meta.update",
					commandId,
					projectId,
					title: "Acepe Desktop"
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 2,
					eventId,
					aggregateKind: "project",
					aggregateId: projectId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "ProjectMetaUpdated",
					payload: {
						projectId,
						title: "Acepe Desktop"
					}
				}
			])
		})
	)

	Vitest.it.effect("emits ProjectDeleted when the project exists", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				projectReadModel,
				ProjectDeleteCommand.make({
					type: "project.delete",
					commandId,
					projectId
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 2,
					eventId,
					aggregateKind: "project",
					aggregateId: projectId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "ProjectDeleted",
					payload: { projectId }
				}
			])
		})
	)

	Vitest.it.effect("emits SessionCreated when the project exists and the session is absent", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				projectReadModel,
				SessionCreateCommand.make({
					type: "session.create",
					commandId,
					sessionId,
					projectId,
					title: "First session"
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 2,
					eventId,
					aggregateKind: "session",
					aggregateId: sessionId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "SessionCreated",
					payload: {
						sessionId,
						projectId,
						title: "First session"
					}
				}
			])
		})
	)

	Vitest.it.effect("rejects session.create when the project is missing", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decide(
					emptyReadModel,
					SessionCreateCommand.make({
						type: "session.create",
						commandId,
						sessionId,
						projectId,
						title: "First session"
					}),
					identity
				)
			)
			Vitest.assert.strictEqual(
				error.detail,
				"Project 'project-1' does not exist for command 'session.create'."
			)
		})
	)

	Vitest.it.effect("emits SessionMetaUpdated from the command fields", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				sessionReadModel,
				SessionMetaUpdateCommand.make({
					type: "session.meta.update",
					commandId,
					sessionId,
					title: "Renamed session"
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 3,
					eventId,
					aggregateKind: "session",
					aggregateId: sessionId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "SessionMetaUpdated",
					payload: {
						sessionId,
						title: "Renamed session"
					}
				}
			])
		})
	)

	Vitest.it.effect("emits SessionArchived for a live session", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				sessionReadModel,
				SessionArchiveCommand.make({
					type: "session.archive",
					commandId,
					sessionId
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 3,
					eventId,
					aggregateKind: "session",
					aggregateId: sessionId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "SessionArchived",
					payload: { sessionId }
				}
			])
		})
	)

	Vitest.it.effect("emits SessionUnarchived for an archived session", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				archivedSessionReadModel,
				SessionUnarchiveCommand.make({
					type: "session.unarchive",
					commandId,
					sessionId
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 4,
					eventId,
					aggregateKind: "session",
					aggregateId: sessionId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "SessionUnarchived",
					payload: { sessionId }
				}
			])
		})
	)

	Vitest.it.effect("rejects session.unarchive when the session is not archived", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decide(
					sessionReadModel,
					SessionUnarchiveCommand.make({
						type: "session.unarchive",
						commandId,
						sessionId
					}),
					identity
				)
			)
			Vitest.assert.strictEqual(
				error.detail,
				"Session 'session-1' is not archived for command 'session.unarchive'."
			)
		})
	)

	Vitest.it.effect("emits SessionDeleted when the session exists", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				archivedSessionReadModel,
				SessionDeleteCommand.make({
					type: "session.delete",
					commandId,
					sessionId
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 4,
					eventId,
					aggregateKind: "session",
					aggregateId: sessionId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "SessionDeleted",
					payload: { sessionId }
				}
			])
		})
	)

	Vitest.it.effect("emits MessageSent for a live session", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				sessionReadModel,
				MessageSendCommand.make({
					type: "message.send",
					commandId,
					sessionId,
					messageId,
					text: "Ship the lifecycle slice"
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 3,
					eventId,
					aggregateKind: "session",
					aggregateId: sessionId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "MessageSent",
					payload: {
						sessionId,
						messageId,
						text: "Ship the lifecycle slice"
					}
				}
			])
		})
	)

	Vitest.it.effect("emits TokenAppended for a live session", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				sessionReadModel,
				TokenAppendCommand.make({
					type: "token.append",
					commandId,
					sessionId,
					messageId,
					token: "Hello"
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 3,
					eventId,
					aggregateKind: "session",
					aggregateId: sessionId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "TokenAppended",
					payload: {
						sessionId,
						messageId,
						token: "Hello"
					}
				}
			])
		})
	)

	Vitest.it.effect("rejects token.append when the session is archived", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decide(
					archivedSessionReadModel,
					TokenAppendCommand.make({
						type: "token.append",
						commandId,
						sessionId,
						messageId,
						token: "Hello"
					}),
					identity
				)
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(
				error.detail,
				"Session 'session-1' is already archived and cannot handle command 'token.append'."
			)
		})
	)

	Vitest.it.effect("rejects message.send when the session is archived", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decide(
					archivedSessionReadModel,
					MessageSendCommand.make({
						type: "message.send",
						commandId,
						sessionId,
						messageId,
						text: "Ship the lifecycle slice"
					}),
					identity
				)
			)
			Vitest.assert.strictEqual(
				error.detail,
				"Session 'session-1' is already archived and cannot handle command 'message.send'."
			)
		})
	)

	Vitest.it.effect("emits TurnCancelled with the optional turn id", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				sessionReadModel,
				TurnCancelCommand.make({
					type: "turn.cancel",
					commandId,
					sessionId,
					turnId
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 3,
					eventId,
					aggregateKind: "session",
					aggregateId: sessionId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "TurnCancelled",
					payload: {
						sessionId,
						turnId
					}
				}
			])
		})
	)

	Vitest.it.effect("emits TurnCancelled without a turn id when the command omits it", () =>
		Effect.gen(function*() {
			const events = yield* decide(
				sessionReadModel,
				TurnCancelCommand.make({
					type: "turn.cancel",
					commandId,
					sessionId
				}),
				identity
			)
			Vitest.assert.deepStrictEqual(events, [
				{
					sequence: 3,
					eventId,
					aggregateKind: "session",
					aggregateId: sessionId,
					occurredAt,
					commandId,
					causationEventId: null,
					correlationId: commandId,
					metadata: {},
					type: "TurnCancelled",
					payload: { sessionId }
				}
			])
		})
	)
})
