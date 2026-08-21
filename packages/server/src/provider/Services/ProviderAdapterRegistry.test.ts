import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import {
	DuplicateProviderIdError,
	ProviderAdapterRegistry
} from "./ProviderAdapterRegistry.ts"
import { ProviderId } from "./ProviderAdapter.ts"

Vitest.describe("ProviderAdapterRegistry", () => {
	Vitest.it("is a service class", () => {
		Vitest.assert.strictEqual(
			ProviderAdapterRegistry.key,
			"@acepe/server/provider/Services/ProviderAdapterRegistry"
		)
	})
})

Vitest.describe("DuplicateProviderIdError", () => {
	Vitest.it.effect("is a tagged yieldable error", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new DuplicateProviderIdError({
					providerId: ProviderId.make("fake")
				})
			)
			Vitest.assert.strictEqual(error._tag, "DuplicateProviderIdError")
			Vitest.assert.strictEqual(
				error.message,
				"Provider adapter registry already has provider 'fake'."
			)
		})
	)
})
