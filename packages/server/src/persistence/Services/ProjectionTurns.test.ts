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
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import {
	evolveProjectedTurns,
	isOpenTurn,
	PROJECTION_TURNS_NAME,
	type ProjectedTurn,
	ProjectionTurns
} from "./ProjectionTurns.ts"

const NOW = "2026-08-20T12:00:00.000Z"
const LATER = "2026-08-20T12:00:01.000Z"
const END = "2026-08-20T12:00:02.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const otherSessionId = SessionId.make("session-2")
const messageId = MessageId.make("message-1")
const secondMessageId = MessageId.make("message-2")
const assistantMessageId = MessageId.make("message-1:assistant")
const turnId = TurnId.make("message-1")
const secondTurnId = TurnId.make("message-2")

type SessionEventType = Extract<
	OrchestrationEvent["type"],
	"MessageSent" | "TokenAppended" | "TurnCancelled"
>

const sessionEvent = <const Type extends SessionEventType, Payload>(
	sequence: number,
	type: Type,
	occurredAt: string,
	payload: Payload,
	aggregateId: SessionId = sessionId
) => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session" as const,
	aggregateId,
	occurredAt,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type,
	payload
})

const projectCreated = {
	sequence: 1,
	eventId: EventId.make("event-1"),
	aggregateKind: "project" as const,
	aggregateId: projectId,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "ProjectCreated" as const,
	payload: {
		projectId,
		title: "Acepe",
		workspaceRoot: "/tmp/acepe"
	}
}

const fold = (events: ReadonlyArray<OrchestrationEvent>) =>
	Effect.reduce(events, () => Arr.empty<ProjectedTurn>(), evolveProjectedTurns)

const requireTurn = (turns: ReadonlyArray<ProjectedTurn>, id: TurnId) => {
	const found = Arr.findFirst(turns, (turn) => turn.turnId === id)
	return Option.match(found, {
		onNone: () => {
			Vitest.assert.fail(`expected turn ${id}`)
			return undefined as never
		},
		onSome: (turn) => turn
	})
}

Vitest.describe("ProjectionTurns", () => {
	Vitest.it("is a service class named projection.turns", () => {
		Vitest.assert.strictEqual(
			ProjectionTurns.key,
			"@acepe/server/persistence/Services/ProjectionTurns"
		)
		Vitest.assert.strictEqual(PROJECTION_TURNS_NAME, "projection.turns")
	})
})

Vitest.describe("evolveProjectedTurns", () => {
	Vitest.it.effect("ignores project events", () =>
		Effect.gen(function*() {
			const turns = yield* fold([projectCreated])
			Vitest.assert.deepStrictEqual(turns, [])
		})
	)

	Vitest.it.effect("starts a running turn from MessageSent", () =>
		Effect.gen(function*() {
			const turns = yield* fold([
				sessionEvent(2, "MessageSent", NOW, {
					sessionId,
					messageId,
					text: "Ship the slice"
				})
			])
			Vitest.assert.deepStrictEqual(turns, [
				{
					turnId,
					sessionId,
					sequence: 2,
					status: "running",
					startedAt: NOW,
					endedAt: null,
					cancelledAt: null,
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					costUsd: 0
				}
			])
			Vitest.assert.isTrue(isOpenTurn(requireTurn(turns, turnId)))
		})
	)

	Vitest.it.effect("counts TokenAppended onto the open turn as output usage", () =>
		Effect.gen(function*() {
			const turns = yield* fold([
				sessionEvent(2, "MessageSent", NOW, {
					sessionId,
					messageId,
					text: "Ship the slice"
				}),
				sessionEvent(3, "TokenAppended", LATER, {
					sessionId,
					messageId: assistantMessageId,
					token: "Hello"
				}),
				sessionEvent(4, "TokenAppended", LATER, {
					sessionId,
					messageId: assistantMessageId,
					token: " from"
				}),
				sessionEvent(5, "TokenAppended", END, {
					sessionId,
					messageId: assistantMessageId,
					token: " Acepe."
				})
			])
			const turn = requireTurn(turns, turnId)
			Vitest.assert.strictEqual(turn.status, "running")
			Vitest.assert.strictEqual(turn.endedAt, null)
			Vitest.assert.strictEqual(turn.outputTokens, 3)
			Vitest.assert.strictEqual(turn.costUsd, 0)
			Vitest.assert.strictEqual(turn.sequence, 2)
		})
	)

	Vitest.it.effect("leaves a turn running when the log ends without a terminal event", () =>
		Effect.gen(function*() {
			const turns = yield* fold([
				sessionEvent(2, "MessageSent", NOW, {
					sessionId,
					messageId,
					text: "Ship the slice"
				}),
				sessionEvent(3, "TokenAppended", LATER, {
					sessionId,
					messageId: assistantMessageId,
					token: "Hello"
				})
			])
			const turn = requireTurn(turns, turnId)
			Vitest.assert.strictEqual(turn.status, "running")
			Vitest.assert.strictEqual(turn.endedAt, null)
			Vitest.assert.isTrue(isOpenTurn(turn))
		})
	)

	Vitest.it.effect("cancels the open turn from TurnCancelled without a turn id", () =>
		Effect.gen(function*() {
			const turns = yield* fold([
				sessionEvent(2, "MessageSent", NOW, {
					sessionId,
					messageId,
					text: "Ship the slice"
				}),
				sessionEvent(3, "TurnCancelled", LATER, {
					sessionId
				})
			])
			const turn = requireTurn(turns, turnId)
			Vitest.assert.strictEqual(turn.status, "cancelled")
			Vitest.assert.strictEqual(turn.endedAt, LATER)
			Vitest.assert.strictEqual(turn.cancelledAt, LATER)
			Vitest.assert.isFalse(isOpenTurn(turn))
		})
	)

	Vitest.it.effect("cancels the named turn from TurnCancelled with a turn id", () =>
		Effect.gen(function*() {
			const turns = yield* fold([
				sessionEvent(2, "MessageSent", NOW, {
					sessionId,
					messageId,
					text: "Ship the slice"
				}),
				sessionEvent(3, "TurnCancelled", LATER, {
					sessionId,
					turnId
				})
			])
			const turn = requireTurn(turns, turnId)
			Vitest.assert.strictEqual(turn.status, "cancelled")
			Vitest.assert.strictEqual(turn.cancelledAt, LATER)
		})
	)

	Vitest.it.effect("completes the open turn when a later MessageSent starts a new one", () =>
		Effect.gen(function*() {
			const turns = yield* fold([
				sessionEvent(2, "MessageSent", NOW, {
					sessionId,
					messageId,
					text: "First"
				}),
				sessionEvent(3, "TokenAppended", LATER, {
					sessionId,
					messageId: assistantMessageId,
					token: "Hello"
				}),
				sessionEvent(4, "MessageSent", END, {
					sessionId,
					messageId: secondMessageId,
					text: "Second"
				})
			])
			Vitest.assert.strictEqual(turns.length, 2)
			const first = requireTurn(turns, turnId)
			const second = requireTurn(turns, secondTurnId)
			Vitest.assert.strictEqual(first.status, "completed")
			Vitest.assert.strictEqual(first.endedAt, END)
			Vitest.assert.strictEqual(first.outputTokens, 1)
			Vitest.assert.strictEqual(second.status, "running")
			Vitest.assert.strictEqual(second.endedAt, null)
			Vitest.assert.strictEqual(second.sequence, 4)
		})
	)

	Vitest.it.effect("starts a turn from TokenAppended when no open turn exists", () =>
		Effect.gen(function*() {
			const turns = yield* fold([
				sessionEvent(4, "TokenAppended", NOW, {
					sessionId,
					messageId: assistantMessageId,
					token: "Hello"
				})
			])
			const turn = requireTurn(turns, TurnId.make("message-1:assistant"))
			Vitest.assert.strictEqual(turn.status, "running")
			Vitest.assert.strictEqual(turn.outputTokens, 1)
			Vitest.assert.strictEqual(turn.sequence, 4)
		})
	)

	Vitest.it.effect("ignores a MessageSent for another session", () =>
		Effect.gen(function*() {
			const turns = yield* fold([
				sessionEvent(2, "MessageSent", NOW, {
					sessionId,
					messageId,
					text: "First"
				}),
				sessionEvent(
					3,
					"MessageSent",
					LATER,
					{
						sessionId: otherSessionId,
						messageId: secondMessageId,
						text: "Other"
					},
					otherSessionId
				)
			])
			Vitest.assert.strictEqual(turns.length, 1)
			Vitest.assert.strictEqual(turns[0]?.turnId, turnId)
		})
	)

	Vitest.it.effect("replays the same events to an identical table", () =>
		Effect.gen(function*() {
			const events: ReadonlyArray<OrchestrationEvent> = [
				projectCreated,
				sessionEvent(2, "MessageSent", NOW, {
					sessionId,
					messageId,
					text: "Ship the slice"
				}),
				sessionEvent(3, "TokenAppended", LATER, {
					sessionId,
					messageId: assistantMessageId,
					token: "Hello"
				}),
				sessionEvent(4, "TurnCancelled", END, {
					sessionId,
					turnId
				})
			]
			const first = yield* fold(events)
			const second = yield* fold(events)
			Vitest.assert.deepStrictEqual(first, second)
			Vitest.assert.strictEqual(requireTurn(first, turnId).status, "cancelled")
			Vitest.assert.strictEqual(requireTurn(first, turnId).outputTokens, 1)
		})
	)
})
