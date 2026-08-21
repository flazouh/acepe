import {
	CommandId,
	EventId,
	MessageId,
	SessionId,
	TokenAppendedEvent
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { ProviderAdapterRegistryLive } from "./ProviderAdapterRegistry.ts"
import { ProviderRegistryLive } from "./ProviderRegistry.ts"
import { makeFakeProviderAdapter } from "../Services/FakeProviderAdapter.ts"
import { isCapabilityEnabled, ProviderCapabilities, ProviderId } from "../Services/ProviderAdapter.ts"
import { ProviderNotFoundError, ProviderRegistry } from "../Services/ProviderRegistry.ts"

const sessionId = SessionId.make("session-1")
const messageId = MessageId.make("message-1")
const commandId = CommandId.make("cmd-1")

const tokenAppended = TokenAppendedEvent.make({
	sequence: 1,
	eventId: EventId.make("event-1"),
	aggregateKind: "session",
	aggregateId: sessionId,
	occurredAt: "2026-08-20T12:00:00.000Z",
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

const fakeClaude = makeFakeProviderAdapter({
	providerId: ProviderId.make("claude-code"),
	capabilities: ProviderCapabilities.make({
		enabled: ["models", "plan"]
	}),
	installed: true,
	authenticated: true,
	updates: [tokenAppended]
})

const fakeCursor = makeFakeProviderAdapter({
	providerId: ProviderId.make("cursor"),
	capabilities: ProviderCapabilities.make({
		enabled: ["models"]
	}),
	installed: true,
	authenticated: false,
	updates: []
})

const TestLive = ProviderRegistryLive.pipe(
	Layer.provide(ProviderAdapterRegistryLive([fakeClaude, fakeCursor]))
)

Vitest.layer(TestLive)("ProviderRegistryLive", (it) => {
	it.effect("resolves a registered adapter by provider id", () =>
		Effect.gen(function*() {
			const registry = yield* ProviderRegistry
			const adapter = yield* registry.resolve(ProviderId.make("claude-code"))
			Vitest.assert.strictEqual(adapter.providerId, fakeClaude.providerId)
			Vitest.assert.strictEqual(isCapabilityEnabled(adapter.capabilities, "plan"), true)
			Vitest.assert.strictEqual(isCapabilityEnabled(adapter.capabilities, "usage"), false)
		})
	)

	it.effect("fails resolve for an unknown provider id", () =>
		Effect.gen(function*() {
			const registry = yield* ProviderRegistry
			const error = yield* Effect.flip(registry.resolve(ProviderId.make("codex")))
			Vitest.assert.strictEqual(error._tag, "ProviderNotFoundError")
			Vitest.assert.isTrue(Schema.is(ProviderNotFoundError)(error))
		})
	)

	it.effect("reports installed and authenticated flags for every adapter", () =>
		Effect.gen(function*() {
			const registry = yield* ProviderRegistry
			const listed = yield* registry.list
			Vitest.assert.deepStrictEqual(listed, [
				{
					providerId: fakeClaude.providerId,
					installed: true,
					authenticated: true
				},
				{
					providerId: fakeCursor.providerId,
					installed: true,
					authenticated: false
				}
			])
		})
	)
})
