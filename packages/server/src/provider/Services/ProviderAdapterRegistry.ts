import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { type ProviderAdapter, ProviderId } from "./ProviderAdapter.ts"

export class DuplicateProviderIdError extends Schema.TaggedError<DuplicateProviderIdError>()(
	"DuplicateProviderIdError",
	{
		providerId: ProviderId
	}
) {
	override get message(): string {
		return `Provider adapter registry already has provider '${this.providerId}'.`
	}
}

export interface ProviderAdapterRegistryShape {
	readonly get: (providerId: ProviderId) => Effect.Effect<Option.Option<ProviderAdapter>>
	readonly adapters: Effect.Effect<ReadonlyArray<ProviderAdapter>>
}

export class ProviderAdapterRegistry extends Context.Service<
	ProviderAdapterRegistry,
	ProviderAdapterRegistryShape
>()("@acepe/server/provider/Services/ProviderAdapterRegistry") {}
