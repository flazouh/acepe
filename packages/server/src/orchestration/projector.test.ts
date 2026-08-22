import {
	CheckpointId,
	CommandId,
	EventId,
	MessageId,
	type OrchestrationEvent,
	OrchestrationEvent as OrchestrationEventSchema,
	ProjectId,
	SessionId,
	TurnId
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as FastCheck from "effect/testing/FastCheck"
import { createEmptyReadModel, projectEvent } from "./projector.ts"
import {
	MAX_SESSION_CHECKPOINTS,
	MAX_SESSION_MESSAGES,
	type OrchestrationReadModel,
	type OrchestrationSession,
	OrchestrationProjectorDecodeError
} from "./Schemas.ts"

const NOW = "2026-08-20T12:00:00.000Z"
const LATER = "2026-08-20T12:00:01.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const messageId = MessageId.make("message-1")
const turnId = TurnId.make("turn-1")

type ProjectEventType = Extract<
	OrchestrationEvent["type"],
	"ProjectCreated" | "ProjectMetaUpdated" | "ProjectDeleted"
>
type SessionEventType = Exclude<
	OrchestrationEvent["type"],
	| ProjectEventType
	| "SettingsUpdated"
	| "SkillsDiscovered"
	| "VoiceModelsListed"
	| "VoiceLanguagesListed"
	| "VoiceModelStatusReported"
	| "VoiceModelDownloaded"
	| "VoiceModelDeleted"
	| "VoiceModelLoaded"
	| "VoiceRecordingStarted"
	| "VoiceRecordingStopped"
	| "VoiceRecordingCancelled"
>

const projectEventEnvelope = <const Type extends ProjectEventType, Payload>(
	sequence: number,
	type: Type,
	occurredAt: string,
	payload: Payload
) => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "project" as const,
	aggregateId: projectId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type,
	payload
})

const sessionEventEnvelope = <const Type extends SessionEventType, Payload>(
	sequence: number,
	type: Type,
	occurredAt: string,
	payload: Payload
) => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session" as const,
	aggregateId: sessionId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type,
	payload
})

const fold = (
	events: ReadonlyArray<OrchestrationEvent>,
	start: OrchestrationReadModel = createEmptyReadModel(NOW)
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> =>
	Effect.reduce(events, () => start, projectEvent)

const projectCreated = projectEventEnvelope(1, "ProjectCreated", NOW, {
	projectId,
	title: "Acepe",
	workspaceRoot: "/tmp/acepe"
})

const sessionCreated = sessionEventEnvelope(2, "SessionCreated", NOW, {
	sessionId,
	projectId,
	title: "First session"
})

const requireSession = (model: OrchestrationReadModel): OrchestrationSession => {
	const session = model.sessions[0]
	Vitest.assert.isDefined(session)
	return session
}

Vitest.describe("createEmptyReadModel", () => {
	Vitest.it("returns the zero value", () => {
		Vitest.assert.deepStrictEqual(createEmptyReadModel(NOW), {
			snapshotSequence: 0,
			projects: [],
			sessions: [],
			updatedAt: NOW
		})
	})
})

Vitest.describe("projectEvent", () => {
	Vitest.it.effect("projects the v1 lifecycle sequence", () =>
		Effect.gen(function*() {
			const model = yield* fold([
				projectCreated,
				projectEventEnvelope(2, "ProjectMetaUpdated", LATER, {
					projectId,
					title: "Acepe Desktop"
				}),
				sessionEventEnvelope(3, "SessionCreated", LATER, {
					sessionId,
					projectId,
					title: "First session"
				}),
				sessionEventEnvelope(4, "SessionMetaUpdated", LATER, {
					sessionId,
					title: "Renamed session"
				}),
				sessionEventEnvelope(5, "MessageSent", LATER, {
					sessionId,
					messageId,
					text: "Ship the lifecycle slice"
				}),
				sessionEventEnvelope(6, "SessionArchived", LATER, {
					sessionId
				}),
				sessionEventEnvelope(7, "SessionUnarchived", LATER, {
					sessionId
				}),
				sessionEventEnvelope(8, "TurnCancelled", LATER, {
					sessionId,
					turnId
				}),
				sessionEventEnvelope(9, "SessionDeleted", LATER, {
					sessionId
				}),
				projectEventEnvelope(10, "ProjectDeleted", LATER, {
					projectId
				})
			])

			Vitest.assert.strictEqual(model.snapshotSequence, 10)
			Vitest.assert.strictEqual(model.updatedAt, LATER)
			Vitest.assert.deepStrictEqual(model.projects, [
				{
					id: projectId,
					title: "Acepe Desktop",
					workspaceRoot: "/tmp/acepe",
					createdAt: NOW,
					updatedAt: LATER,
					deletedAt: LATER
				}
			])
			Vitest.assert.deepStrictEqual(model.sessions, [
				{
					id: sessionId,
					projectId,
					title: "Renamed session",
					createdAt: LATER,
					updatedAt: LATER,
					archivedAt: null,
					deletedAt: LATER,
					messages: [
						{
							id: messageId,
							text: "Ship the lifecycle slice",
							createdAt: LATER
						}
					],
					checkpoints: []
				}
			])
		})
	)

	Vitest.it.effect("keeps a project workspaceRoot when meta update omits it", () =>
		Effect.gen(function*() {
			const model = yield* fold([
				projectCreated,
				projectEventEnvelope(2, "ProjectMetaUpdated", LATER, {
					projectId,
					title: "Acepe Desktop"
				})
			])
			const project = model.projects[0]
			Vitest.assert.isDefined(project)
			Vitest.assert.strictEqual(project.workspaceRoot, "/tmp/acepe")
			Vitest.assert.strictEqual(project.title, "Acepe Desktop")
		})
	)

	Vitest.it.effect("replaces a duplicate ProjectCreated instead of appending", () =>
		Effect.gen(function*() {
			const model = yield* fold([
				projectCreated,
				projectEventEnvelope(2, "ProjectCreated", LATER, {
					projectId,
					title: "Acepe Reloaded",
					workspaceRoot: "/tmp/acepe-reloaded"
				})
			])
			Vitest.assert.strictEqual(model.projects.length, 1)
			const project = model.projects[0]
			Vitest.assert.isDefined(project)
			Vitest.assert.strictEqual(project.title, "Acepe Reloaded")
			Vitest.assert.strictEqual(project.workspaceRoot, "/tmp/acepe-reloaded")
			Vitest.assert.strictEqual(project.createdAt, LATER)
			Vitest.assert.strictEqual(project.deletedAt, null)
		})
	)

	Vitest.it.effect("does not create a session when MessageSent has no session", () =>
		Effect.gen(function*() {
			const model = yield* fold([
				sessionEventEnvelope(1, "MessageSent", NOW, {
					sessionId,
					messageId,
					text: "orphan"
				})
			])
			Vitest.assert.strictEqual(model.snapshotSequence, 1)
			Vitest.assert.deepStrictEqual(model.sessions, [])
		})
	)

	Vitest.it.effect("replaces a message with the same id instead of appending", () =>
		Effect.gen(function*() {
			const model = yield* fold([
				projectCreated,
				sessionCreated,
				sessionEventEnvelope(3, "MessageSent", NOW, {
					sessionId,
					messageId,
					text: "first"
				}),
				sessionEventEnvelope(4, "MessageSent", LATER, {
					sessionId,
					messageId,
					text: "second"
				})
			])
			const session = requireSession(model)
			Vitest.assert.deepStrictEqual(session.messages, [
				{
					id: messageId,
					text: "second",
					createdAt: LATER
				}
			])
		})
	)

	Vitest.it.effect("concatenates TokenAppended tokens onto one assistant message", () =>
		Effect.gen(function*() {
			const assistantId = MessageId.make("message-assistant")
			const model = yield* fold([
				projectCreated,
				sessionCreated,
				sessionEventEnvelope(3, "MessageSent", NOW, {
					sessionId,
					messageId,
					text: "Ping"
				}),
				sessionEventEnvelope(4, "TokenAppended", LATER, {
					sessionId,
					messageId: assistantId,
					token: "Hello"
				}),
				sessionEventEnvelope(5, "TokenAppended", LATER, {
					sessionId,
					messageId: assistantId,
					token: " from"
				}),
				sessionEventEnvelope(6, "TokenAppended", LATER, {
					sessionId,
					messageId: assistantId,
					token: " Acepe."
				})
			])
			const session = requireSession(model)
			Vitest.assert.deepStrictEqual(session.messages, [
				{
					id: messageId,
					text: "Ping",
					createdAt: NOW
				},
				{
					id: assistantId,
					text: "Hello from Acepe.",
					createdAt: LATER
				}
			])
		})
	)

	Vitest.it.effect("fails when the payload does not match its own schema", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				projectEvent(
					createEmptyReadModel(NOW),
					// @ts-expect-error payload is missing title and workspaceRoot
					projectEventEnvelope(1, "ProjectCreated", NOW, {
						projectId
					})
				)
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationProjectorDecodeError")
			Vitest.assert.strictEqual(error.eventType, "ProjectCreated")
			Vitest.assert.strictEqual(error.field, "payload")
		})
	)

	Vitest.it.effect("keeps the newest messages when the bound is exceeded", () =>
		Effect.gen(function*() {
			const extra = 3
			const messageEvents = Arr.makeBy(MAX_SESSION_MESSAGES + extra, (index) =>
				sessionEventEnvelope(index + 3, "MessageSent", LATER, {
					sessionId,
					messageId: MessageId.make(`message-${index}`),
					text: `text-${index}`
				})
			)
			const model = yield* fold(
				Arr.appendAll([projectCreated, sessionCreated], messageEvents)
			)
			const session = requireSession(model)
			Vitest.assert.strictEqual(session.messages.length, MAX_SESSION_MESSAGES)
			const first = session.messages[0]
			const last = session.messages[MAX_SESSION_MESSAGES - 1]
			Vitest.assert.isDefined(first)
			Vitest.assert.isDefined(last)
			Vitest.assert.strictEqual(first.id, MessageId.make(`message-${extra}`))
			Vitest.assert.strictEqual(last.id, MessageId.make(`message-${MAX_SESSION_MESSAGES + extra - 1}`))
		})
	)

	Vitest.it.effect("trims checkpoints back to the bound on the next event", () =>
		Effect.gen(function*() {
			const bloated: OrchestrationReadModel = {
				snapshotSequence: 1,
				projects: [],
				sessions: [
					{
						id: sessionId,
						projectId,
						title: "First session",
						createdAt: NOW,
						updatedAt: NOW,
						archivedAt: null,
						deletedAt: null,
						messages: [],
						checkpoints: Arr.makeBy(MAX_SESSION_CHECKPOINTS + 4, (index) => ({
							id: CheckpointId.make(`checkpoint-${index}`),
							createdAt: NOW
						}))
					}
				],
				updatedAt: NOW
			}
			const model = yield* projectEvent(
				bloated,
				sessionEventEnvelope(2, "TurnCancelled", LATER, {
					sessionId
				})
			)
			const session = requireSession(model)
			Vitest.assert.strictEqual(session.checkpoints.length, MAX_SESSION_CHECKPOINTS)
			const first = session.checkpoints[0]
			const last = session.checkpoints[MAX_SESSION_CHECKPOINTS - 1]
			Vitest.assert.isDefined(first)
			Vitest.assert.isDefined(last)
			Vitest.assert.strictEqual(first.id, CheckpointId.make("checkpoint-4"))
			Vitest.assert.strictEqual(
				last.id,
				CheckpointId.make(`checkpoint-${MAX_SESSION_CHECKPOINTS + 3}`)
			)
		})
	)

	Vitest.it.effect("records CheckpointCreated on the in-memory session and ignores revert", () =>
		Effect.gen(function*() {
			const checkpointId = CheckpointId.make("checkpoint-1")
			const model = yield* fold([
				projectCreated,
				sessionCreated,
				sessionEventEnvelope(3, "CheckpointCreated", LATER, {
					sessionId,
					checkpointId,
					checkpointNumber: 1,
					name: "After edit",
					isAuto: true,
					toolCallId: null,
					fileCount: 1
				}),
				sessionEventEnvelope(4, "CheckpointReadinessChanged", LATER, {
					sessionId,
					checkpointId,
					status: "ready" as const
				}),
				sessionEventEnvelope(5, "CheckpointReverted", LATER, {
					sessionId,
					checkpointId
				})
			])
			const session = requireSession(model)
			Vitest.assert.deepStrictEqual(session.checkpoints, [
				{
					id: checkpointId,
					createdAt: LATER
				}
			])
			Vitest.assert.strictEqual(session.updatedAt, LATER)
		})
	)

	Vitest.it.effect.prop(
		"replaying the same generated sequence from empty yields the same read model",
		[
			FastCheck.array(Schema.toArbitrary(OrchestrationEventSchema)(FastCheck), {
				maxLength: 20
			})
		],
		([events]) =>
			Effect.gen(function*() {
				const empty = createEmptyReadModel(NOW)
				const first = yield* fold(events, empty)
				const second = yield* fold(events, empty)
				Vitest.assert.deepStrictEqual(first, second)
				for (const session of first.sessions) {
					Vitest.assert.isTrue(session.messages.length <= MAX_SESSION_MESSAGES)
					Vitest.assert.isTrue(session.checkpoints.length <= MAX_SESSION_CHECKPOINTS)
				}
			}),
		{ fastCheck: { numRuns: 50, seed: 1 } }
	)
})
