import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import type { ProviderId } from "../Services/ProviderAdapter.ts"
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts"
import { ProviderNotFoundError, ProviderRegistry } from "../Services/ProviderRegistry.ts"

const makeProviderRegistry = Effect.gen(function*() {
	const adapters = yield* ProviderAdapterRegistry

	const resolve = Effect.fn("ProviderRegistry.resolve")(function*(providerId: ProviderId) {
		const found = yield* adapters.get(providerId)
		if (Option.isNone(found)) {
			return yield* new ProviderNotFoundError({ providerId })
		}
		return found.value
	})

	const list = adapters.adapters.pipe(
		Effect.flatMap((registered) => Effect.forEach(registered, (adapter) => adapter.presence))
	)

	return ProviderRegistry.of({
		resolve,
		list
	})
})

export const ProviderRegistryLive = Layer.effect(ProviderRegistry, makeProviderRegistry)
