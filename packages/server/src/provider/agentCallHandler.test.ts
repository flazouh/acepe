import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { routeAgentCall } from "./agentCallHandler.ts"
import { ProviderAdapterRegistryLive } from "./Layers/ProviderAdapterRegistry.ts"
import { ProviderRegistryLive } from "./Layers/ProviderRegistry.ts"
import { makeFakeProviderAdapter } from "./Services/FakeProviderAdapter.ts"
import { ProviderCapabilities, ProviderId } from "./Services/ProviderAdapter.ts"

const fakeClaude = makeFakeProviderAdapter({
	providerId: ProviderId.make("claude-code"),
	capabilities: ProviderCapabilities.make({ enabled: ["models", "plan"] }),
	installed: true,
	authenticated: true,
	updates: []
})

const fakeCodex = makeFakeProviderAdapter({
	providerId: ProviderId.make("codex"),
	capabilities: ProviderCapabilities.make({ enabled: ["models"] }),
	installed: false,
	authenticated: false,
	updates: []
})

const fakeUnknownProvider = makeFakeProviderAdapter({
	providerId: ProviderId.make("something-new"),
	capabilities: ProviderCapabilities.make({ enabled: [] }),
	installed: true,
	authenticated: false,
	updates: []
})

const TestLive = ProviderRegistryLive.pipe(
	Layer.provide(ProviderAdapterRegistryLive([fakeClaude, fakeCodex, fakeUnknownProvider]))
)

Vitest.layer(TestLive)("routeAgentCall", (it) => {
	it.effect("lists every registered provider adapter as an agent, mapping presence to availabilityKind", () =>
		Effect.gen(function*() {
			const result = yield* routeAgentCall({ op: "agent.list" })
			Vitest.assert.deepStrictEqual(result, {
				op: "agent.list",
				agents: [
					{
						id: "claude-code",
						name: "Claude Code",
						availabilityKind: { kind: "installable", installed: true }
					},
					{
						id: "codex",
						name: "Codex",
						availabilityKind: { kind: "installable", installed: false }
					},
					{
						id: "something-new",
						name: "something-new",
						availabilityKind: { kind: "installable", installed: true }
					}
				]
			})
		})
	)
})
