import {
	CommandId,
	EventId,
	MessageId,
	type OrchestrationEvent,
	ProjectId,
	SessionId,
	TurnId
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import {
	compactionSeamRow,
	decodeProjectedMessage,
	encodeContentJson,
	PROJECTION_SESSION_MESSAGES_NAME,
	ProjectionSessionMessages,
	rowFromEvent,
	userMessageRow
} from "./ProjectionSessionMessages.ts"

const occurredAt = "2026-08-20T12:00:09.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const messageId = MessageId.make("message-1")
const turnId = TurnId.make("turn-1")

const messageSent = (sequence: number, occurredAtValue: string): OrchestrationEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session",
	aggregateId: sessionId,
	occurredAt: occurredAtValue,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "MessageSent",
	payload: {
		sessionId,
		messageId,
		text: "Ship the transcript"
	}
})

const projectCreated = (): OrchestrationEvent => ({
	sequence: 1,
	eventId: EventId.make("event-1"),
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
})

Vitest.describe("ProjectionSessionMessages", () => {
	Vitest.it("is a service class named projection.session-messages", () => {
		Vitest.assert.strictEqual(
			ProjectionSessionMessages.key,
			"@acepe/server/persistence/Services/ProjectionSessionMessages"
		)
		Vitest.assert.strictEqual(PROJECTION_SESSION_MESSAGES_NAME, "projection.session-messages")
	})
})

Vitest.describe("rowFromEvent", () => {
	Vitest.it("maps MessageSent to a user row keyed by event sequence", () => {
		const row = rowFromEvent(messageSent(7, occurredAt))
		Vitest.assert.isTrue(Option.isSome(row))
		if (Option.isNone(row)) {
			return
		}
		Vitest.assert.deepStrictEqual(row.value, {
			sessionId,
			sequence: 7,
			messageId,
			turnId: null,
			rowType: "user",
			content: {
				text: "Ship the transcript"
			}
		})
	})

	Vitest.it("does not derive sequence from occurredAt", () => {
		const earlierClock = rowFromEvent(messageSent(9, "2026-08-20T11:00:00.000Z"))
		const laterClock = rowFromEvent(messageSent(2, "2026-08-20T18:00:00.000Z"))
		Vitest.assert.isTrue(Option.isSome(earlierClock))
		Vitest.assert.isTrue(Option.isSome(laterClock))
		if (Option.isNone(earlierClock) || Option.isNone(laterClock)) {
			return
		}
		Vitest.assert.strictEqual(earlierClock.value.sequence, 9)
		Vitest.assert.strictEqual(laterClock.value.sequence, 2)
	})

	Vitest.it("ignores events that are not transcript rows", () => {
		Vitest.assert.isTrue(Option.isNone(rowFromEvent(projectCreated())))
	})
})

Vitest.describe("encodeContentJson", () => {
	Vitest.it.effect("stores decoded user text, not an envelope or provider blob", () =>
		Effect.gen(function*() {
			const json = yield* encodeContentJson(
				userMessageRow({
					sessionId,
					sequence: 3,
					messageId,
					turnId,
					text: "Ship the transcript"
				})
			)
			Vitest.assert.isFalse(json.includes("sessionId"))
			Vitest.assert.isFalse(json.includes("messageId"))
			Vitest.assert.isFalse(json.includes("provider"))
		})
	)

	Vitest.it.effect("stores decoded compaction seam fields, not provider metadata", () =>
		Effect.gen(function*() {
			const json = yield* encodeContentJson(
				compactionSeamRow({
					sessionId,
					sequence: 4,
					messageId: "seam-1",
					turnId: null,
					content: {
						status: "completed",
						trigger: "auto",
						preCompactionTokens: 180000,
						postCompactionTokens: 42000,
						contextWindowSize: 200000,
						droppedTokens: 138000,
						summary: "Compacted history"
					}
				})
			)
			Vitest.assert.strictEqual(
				json,
				'{"status":"completed","trigger":"auto","preCompactionTokens":180000,"postCompactionTokens":42000,"contextWindowSize":200000,"droppedTokens":138000,"summary":"Compacted history"}'
			)
			Vitest.assert.isFalse(json.includes("providerMetadata"))
		})
	)
})

Vitest.describe("decodeProjectedMessage", () => {
	Vitest.it.effect("round-trips a compaction seam row", () =>
		Effect.gen(function*() {
			const message = compactionSeamRow({
				sessionId,
				sequence: 4,
				messageId: "seam-1",
				turnId: null,
				content: {
					status: "preparing",
					trigger: "manual",
					preCompactionTokens: null,
					postCompactionTokens: null,
					contextWindowSize: 200000,
					droppedTokens: null,
					summary: null
				}
			})
			const content = yield* encodeContentJson(message)
			const decoded = yield* decodeProjectedMessage({
				session_id: sessionId,
				sequence: 4,
				message_id: "seam-1",
				turn_id: null,
				row_type: "compaction",
				content
			})
			Vitest.assert.deepStrictEqual(decoded, message)
		})
	)
})
