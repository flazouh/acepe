import type { OrchestrationEvent } from "@acepe/contracts"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import type {
	ProviderAdapter,
	ProviderCapabilities,
	ProviderId
} from "./ProviderAdapter.ts"

export type FakeProviderAdapterInput = {
	readonly providerId: ProviderId
	readonly capabilities: ProviderCapabilities
	readonly installed: boolean
	readonly authenticated: boolean
	readonly updates: ReadonlyArray<OrchestrationEvent>
}

export const makeFakeProviderAdapter = (input: FakeProviderAdapterInput): ProviderAdapter => ({
	providerId: input.providerId,
	capabilities: input.capabilities,
	presence: Effect.succeed({
		providerId: input.providerId,
		installed: input.installed,
		authenticated: input.authenticated
	}),
	startSession: () => Stream.fromArray(input.updates),
	sendPrompt: () => Stream.fromArray(input.updates),
	cancelTurn: () => Effect.void
})
