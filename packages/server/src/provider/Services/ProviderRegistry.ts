import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { type ProviderAdapter, ProviderId, type ProviderPresence } from "./ProviderAdapter.ts"

export class ProviderNotFoundError extends Schema.TaggedError<ProviderNotFoundError>()(
	"ProviderNotFoundError",
	{
		providerId: ProviderId
	}
) {
	override get message(): string {
		return `No provider adapter is registered for '${this.providerId}'.`
	}
}

export interface ProviderRegistryShape {
	readonly resolve: (
		providerId: ProviderId
	) => Effect.Effect<ProviderAdapter, ProviderNotFoundError>
	readonly list: Effect.Effect<ReadonlyArray<ProviderPresence>>
}

export class ProviderRegistry extends Context.Service<
	ProviderRegistry,
	ProviderRegistryShape
>()("@acepe/server/provider/Services/ProviderRegistry") {}
