import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Layer from "effect/Layer"
import type { ProviderAdapter, ProviderId } from "../Services/ProviderAdapter.ts"
import {
	DuplicateProviderIdError,
	ProviderAdapterRegistry
} from "../Services/ProviderAdapterRegistry.ts"

const makeProviderAdapterRegistry = Effect.fn("ProviderAdapterRegistry.make")(function*(
	adapters: ReadonlyArray<ProviderAdapter>
) {
	let byId = HashMap.empty<ProviderId, ProviderAdapter>()
	for (const adapter of adapters) {
		if (HashMap.has(byId, adapter.providerId)) {
			return yield* new DuplicateProviderIdError({
				providerId: adapter.providerId
			})
		}
		byId = HashMap.set(byId, adapter.providerId, adapter)
	}

	const get = (providerId: ProviderId) => Effect.sync(() => HashMap.get(byId, providerId))

	return ProviderAdapterRegistry.of({
		get,
		adapters: Effect.succeed(adapters)
	})
})

export const ProviderAdapterRegistryLive = (adapters: ReadonlyArray<ProviderAdapter>) =>
	Layer.effect(ProviderAdapterRegistry, makeProviderAdapterRegistry(adapters))
