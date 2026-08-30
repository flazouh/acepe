import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import { routeAgentCall } from "./agentCallHandler.ts"
import { ProviderAdapterRegistryLive } from "./Layers/ProviderAdapterRegistry.ts"
import { AgentInstallerUnsupportedPlatformLive } from "./Layers/AgentInstaller.ts"
import { ProviderRegistryLive } from "./Layers/ProviderRegistry.ts"
import {
	AgentInstaller,
	AgentNotFoundError,
	type InstalledAgent
} from "./Services/AgentInstaller.ts"
import { makeFakeProviderAdapter } from "./Services/FakeProviderAdapter.ts"
import {
	type ProviderAdapter,
	ProviderCapabilities,
	ProviderId
} from "./Services/ProviderAdapter.ts"

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

// routeAgentCall reads AgentInstaller for its install/uninstall ops, so
// every caller carries it -- agent.list included. The unsupported-platform
// installer stands in here: it never touches the network and never writes a
// managed install directory.
const TestLive = Layer.mergeAll(
	ProviderRegistryLive.pipe(
		Layer.provide(ProviderAdapterRegistryLive([fakeClaude, fakeCodex, fakeUnknownProvider]))
	),
	AgentInstallerUnsupportedPlatformLive("test-host")
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

// The adapters below read their presence out of a Ref the fake installer
// writes, which is what an adapter that resolves its binary from the
// managed install directory does on the real path. It is what makes the
// assertion below meaningful: agent.install has to re-read the registry
// after the installer ran, not echo the request back.
const CODEX_ID = ProviderId.make("codex")

const installedCodex: InstalledAgent = {
	agentId: CODEX_ID,
	version: "1.2.3",
	binaryPath: "/managed/codex/codex",
	args: []
}

const refBackedAdapter = (
	providerId: ProviderId,
	installedRef: Ref.Ref<boolean>
): ProviderAdapter => ({
	...makeFakeProviderAdapter({
		providerId,
		capabilities: ProviderCapabilities.make({ enabled: [] }),
		installed: false,
		authenticated: false,
		updates: []
	}),
	presence: Ref.get(installedRef).pipe(
		Effect.map((installed) => ({ providerId, installed, authenticated: false }))
	)
})

const fakeInstallerLayer = (installedRef: Ref.Ref<boolean>) =>
	Layer.succeed(
		AgentInstaller,
		AgentInstaller.of({
			resolveDistribution: () => Effect.die("resolveDistribution is not used here"),
			install: () => Effect.die("install is not used here"),
			ensureLatest: (agentId) =>
				agentId === CODEX_ID
					? Ref.set(installedRef, true).pipe(
							Effect.as({
								outcome: "installed" as const,
								agent: installedCodex,
								previousVersion: null
							})
						)
					: Effect.fail(new AgentNotFoundError({ agentId })),
			getCached: () =>
				Ref.get(installedRef).pipe(
					Effect.map((installed) =>
						installed ? Option.some(installedCodex) : Option.none<InstalledAgent>()
					)
				),
			uninstall: () => Ref.set(installedRef, false)
		})
	)

const registryWith = (adapter: ProviderAdapter) =>
	ProviderRegistryLive.pipe(Layer.provide(ProviderAdapterRegistryLive([adapter])))

const installEnv = (installedRef: Ref.Ref<boolean>) =>
	Layer.mergeAll(
		registryWith(refBackedAdapter(CODEX_ID, installedRef)),
		fakeInstallerLayer(installedRef)
	)

Vitest.describe("routeAgentCall agent.install", () => {
	Vitest.it.effect("runs the installer and answers with the agent list read back afterwards", () =>
		Effect.gen(function*() {
			const installedRef = yield* Ref.make(false)
			const before = yield* routeAgentCall({ op: "agent.list" }).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(installEnv(installedRef))
			)
			Vitest.assert.deepStrictEqual(before, {
				op: "agent.list",
				agents: [
					{
						id: "codex",
						name: "Codex",
						availabilityKind: { kind: "installable", installed: false }
					}
				]
			})
			const result = yield* routeAgentCall({ op: "agent.install", agentId: "codex" }).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(installEnv(installedRef))
			)
			Vitest.assert.deepStrictEqual(result, {
				op: "agent.install",
				agentId: "codex",
				version: "1.2.3",
				agents: [
					{
						id: "codex",
						name: "Codex",
						availabilityKind: { kind: "installable", installed: true }
					}
				]
			})
		})
	)

	Vitest.it.effect("reports the installer's own failure as an RpcAgentCallError", () =>
		Effect.gen(function*() {
			const installedRef = yield* Ref.make(false)
			const outcome = yield* Effect.result(
				routeAgentCall({ op: "agent.install", agentId: "nope" }).pipe(
					// @effect-diagnostics-next-line strictEffectProvide:off
					Effect.provide(installEnv(installedRef))
				)
			)
			Vitest.assert.strictEqual(outcome._tag, "Failure")
			if (outcome._tag === "Failure") {
				Vitest.assert.strictEqual(outcome.failure._tag, "RpcAgentCallError")
				Vitest.assert.strictEqual(outcome.failure.message.includes("agent.install failed"), true)
			}
		})
	)

	Vitest.it.effect("answers a blank agent id with a typed error, not a defect", () =>
		Effect.gen(function*() {
			const installedRef = yield* Ref.make(false)
			const outcome = yield* Effect.result(
				routeAgentCall({ op: "agent.install", agentId: "   " }).pipe(
					// @effect-diagnostics-next-line strictEffectProvide:off
					Effect.provide(installEnv(installedRef))
				)
			)
			Vitest.assert.strictEqual(outcome._tag, "Failure")
			if (outcome._tag === "Failure") {
				Vitest.assert.strictEqual(outcome.failure._tag, "RpcAgentCallError")
			}
		})
	)

	Vitest.it.effect("removes the managed install and answers with the list read back afterwards", () =>
		Effect.gen(function*() {
			const installedRef = yield* Ref.make(true)
			const result = yield* routeAgentCall({ op: "agent.uninstall", agentId: "codex" }).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(installEnv(installedRef))
			)
			Vitest.assert.deepStrictEqual(result, {
				op: "agent.uninstall",
				agentId: "codex",
				agents: [
					{
						id: "codex",
						name: "Codex",
						availabilityKind: { kind: "installable", installed: false }
					}
				]
			})
		})
	)
})
