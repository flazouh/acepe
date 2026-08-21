import {
	CommandId,
	EventId,
	MessageId,
	OrchestrationEvent,
	ProjectId,
	SessionId,
	TokenAppendedEvent
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import {
	isCapabilityEnabled,
	ProviderCapabilities,
	ProviderId
} from "./ProviderAdapter.ts"
import { makeFakeProviderAdapter } from "./FakeProviderAdapter.ts"

const decodeEvent = Schema.decodeUnknownEffect(OrchestrationEvent)

const sessionId = SessionId.make("session-1")
const projectId = ProjectId.make("project-1")
const messageId = MessageId.make("message-1")
const commandId = CommandId.make("cmd-1")
const occurredAt = "2026-08-20T12:00:00.000Z"

const tokenAppended = TokenAppendedEvent.make({
	sequence: 1,
	eventId: EventId.make("event-1"),
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
})

const fake = makeFakeProviderAdapter({
	providerId: ProviderId.make("fake"),
	capabilities: ProviderCapabilities.make({
		enabled: ["models"]
	}),
	installed: false,
	authenticated: false,
	updates: [tokenAppended]
})

Vitest.describe("FakeProviderAdapter", () => {
	Vitest.it.effect("streams CONTRACT TokenAppended events with no network services", () =>
		Effect.gen(function*() {
			const started = yield* Stream.runCollect(
				fake.startSession({
					sessionId,
					projectId,
					workspaceRoot: "/tmp/acepe"
				})
			)
			const prompted = yield* Stream.runCollect(
				fake.sendPrompt({
					sessionId,
					messageId,
					text: "Hi"
				})
			)
			yield* fake.cancelTurn({ sessionId })
			const presence = yield* fake.presence
			const decoded = yield* Effect.forEach(started, (event) => decodeEvent(event))
			Vitest.assert.strictEqual(decoded.length, 1)
			Vitest.assert.strictEqual(decoded[0]?.type, "TokenAppended")
			Vitest.assert.strictEqual(prompted[0]?.type, "TokenAppended")
			Vitest.assert.strictEqual(presence.installed, false)
			Vitest.assert.strictEqual(presence.authenticated, false)
			Vitest.assert.strictEqual(presence.providerId, fake.providerId)
			Vitest.assert.strictEqual(isCapabilityEnabled(fake.capabilities, "models"), true)
			Vitest.assert.strictEqual(isCapabilityEnabled(fake.capabilities, "plan"), false)
		})
	)
})
