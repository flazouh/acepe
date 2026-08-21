import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import { ProviderId } from "./ProviderAdapter.ts"
import { ProviderNotFoundError, ProviderRegistry } from "./ProviderRegistry.ts"

Vitest.describe("ProviderRegistry", () => {
	Vitest.it("is a service class", () => {
		Vitest.assert.strictEqual(
			ProviderRegistry.key,
			"@acepe/server/provider/Services/ProviderRegistry"
		)
	})
})

Vitest.describe("ProviderNotFoundError", () => {
	Vitest.it.effect("is a tagged yieldable error", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new ProviderNotFoundError({
					providerId: ProviderId.make("codex")
				})
			)
			Vitest.assert.strictEqual(error._tag, "ProviderNotFoundError")
			Vitest.assert.strictEqual(error.message, "No provider adapter is registered for 'codex'.")
		})
	)
})
