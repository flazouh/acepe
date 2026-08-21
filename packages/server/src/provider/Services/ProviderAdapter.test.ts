import { OrchestrationEvent } from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
	decodeProviderId,
	isCapabilityEnabled,
	ProviderAdapterError,
	ProviderCapabilityName,
	ProviderCapabilities,
	ProviderId,
	PROVIDER_CAPABILITY_NAMES
} from "./ProviderAdapter.ts"

const decodeEvent = Schema.decodeUnknownEffect(OrchestrationEvent)
const decodeCapabilityName = Schema.decodeUnknownEffect(ProviderCapabilityName)
const decodeCapabilities = Schema.decodeUnknownEffect(ProviderCapabilities)

Vitest.describe("ProviderId", () => {
	Vitest.it("does not allow a raw string as a ProviderId", () => {
		// @ts-expect-error raw string is not assignable to ProviderId
		const providerId: ProviderId = "claude-code"
		Vitest.assert.strictEqual(String(providerId), "claude-code")
	})

	Vitest.it.effect("decodes a non-empty provider id", () =>
		Effect.gen(function*() {
			const providerId = yield* decodeProviderId("claude-code")
			Vitest.assert.strictEqual(providerId, ProviderId.make("claude-code"))
		})
	)
})

Vitest.describe("capability resolution", () => {
	Vitest.it("treats a missing capability as disabled data, not an error", () => {
		const capabilities = ProviderCapabilities.make({
			enabled: ["models"]
		})
		Vitest.assert.strictEqual(isCapabilityEnabled(capabilities, "models"), true)
		Vitest.assert.strictEqual(isCapabilityEnabled(capabilities, "plan"), false)
		Vitest.assert.strictEqual(isCapabilityEnabled(capabilities, "usage"), false)
	})

	Vitest.it.effect("decodes the capability name catalog", () =>
		Effect.gen(function*() {
			const names = yield* Effect.forEach(PROVIDER_CAPABILITY_NAMES, (name) =>
				decodeCapabilityName(name)
			)
			Vitest.assert.deepStrictEqual(names, Arr.fromIterable(PROVIDER_CAPABILITY_NAMES))
			const capabilities = yield* decodeCapabilities({ enabled: [] })
			Vitest.assert.strictEqual(isCapabilityEnabled(capabilities, "toolCalls"), false)
		})
	)
})

Vitest.describe("CONTRACT events", () => {
	Vitest.it.effect("reject a provider-shaped payload", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decodeEvent({
					type: "content_block_delta",
					delta: { text: "hi" }
				})
			)
			Vitest.assert.strictEqual(error._tag, "SchemaError")
		})
	)
})

Vitest.describe("ProviderAdapterError", () => {
	Vitest.it.effect("is a tagged yieldable error", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new ProviderAdapterError({
					providerId: ProviderId.make("fake"),
					operation: "sendPrompt",
					detail: "cancelled"
				})
			)
			Vitest.assert.strictEqual(error._tag, "ProviderAdapterError")
			Vitest.assert.strictEqual(
				error.message,
				"Provider adapter 'fake' failed during sendPrompt: cancelled"
			)
		})
	)
})
