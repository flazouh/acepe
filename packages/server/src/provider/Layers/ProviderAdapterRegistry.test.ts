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
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { makeFakeProviderAdapter } from "../Services/FakeProviderAdapter.ts"
import {
	DuplicateProviderIdError,
	ProviderAdapterRegistry
} from "../Services/ProviderAdapterRegistry.ts"
import { ProviderCapabilities, ProviderId } from "../Services/ProviderAdapter.ts"
import { ProviderAdapterRegistryLive } from "./ProviderAdapterRegistry.ts"

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
	installed: false,
	authenticated: false,
	updates: []
})

const RegistryLive = ProviderAdapterRegistryLive([fakeClaude, fakeCursor])

Vitest.layer(RegistryLive)("ProviderAdapterRegistryLive", (it) => {
	it.effect("resolves an adapter by provider id", () =>
		Effect.gen(function*() {
			const registry = yield* ProviderAdapterRegistry
			const found = yield* registry.get(ProviderId.make("claude-code"))
			const missing = yield* registry.get(ProviderId.make("codex"))
			Vitest.assert.strictEqual(Option.isSome(found), true)
			if (Option.isSome(found)) {
				Vitest.assert.strictEqual(found.value.providerId, fakeClaude.providerId)
			}
			Vitest.assert.strictEqual(Option.isNone(missing), true)
			const adapters = yield* registry.adapters
			Vitest.assert.deepStrictEqual(
				adapters.map((adapter) => adapter.providerId),
				[fakeClaude.providerId, fakeCursor.providerId]
			)
		})
	)
})

Vitest.describe("duplicate provider ids", () => {
	Vitest.it.effect("fail layer construction", () =>
		Effect.gen(function*() {
			const error = yield* ProviderAdapterRegistryLive([fakeClaude, fakeClaude]).pipe(
				Layer.build,
				Effect.scoped,
				Effect.flip
			)
			Vitest.assert.strictEqual(error._tag, "DuplicateProviderIdError")
			Vitest.assert.isTrue(Schema.is(DuplicateProviderIdError)(error))
		})
	)
})
