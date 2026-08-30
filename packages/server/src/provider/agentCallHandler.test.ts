import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import { routeAgentCall } from "./agentCallHandler.ts"
import { signInMethodForAgent } from "./signIn.ts"
import { ProviderAdapterRegistryLive } from "./Layers/ProviderAdapterRegistry.ts"
import { AgentInstallerUnsupportedPlatformLive } from "./Layers/AgentInstaller.ts"
import { ProviderRegistryLive } from "./Layers/ProviderRegistry.ts"
import {
	AgentAuthenticator,
	AgentSignInCancelledError,
	AgentSignInRejectedError
} from "./Services/AgentAuthenticator.ts"
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

const fakeGrok = makeFakeProviderAdapter({
	providerId: ProviderId.make("grok-build"),
	capabilities: ProviderCapabilities.make({ enabled: ["toolCalls", "permissionRequests"] }),
	installed: true,
	authenticated: true,
	updates: []
})

// routeAgentCall reads AgentInstaller for its install/uninstall ops, so
// every caller carries it -- agent.list included. The unsupported-platform
// installer stands in here: it never touches the network and never writes a
// managed install directory.
// Records what the handler asked of the authenticator, so a test can tell
// "the handler reached the sign-in path" from "the handler answered by
// itself". `outcome` decides what that sign-in does.
const fakeAuthenticatorLayer = (
	calls: Ref.Ref<ReadonlyArray<string>>,
	outcome: Effect.Effect<void, AgentSignInRejectedError | AgentSignInCancelledError> =
		Effect.void,
	cancelAnswer = true
) =>
	Layer.succeed(
		AgentAuthenticator,
		AgentAuthenticator.of({
			signIn: (agentId) =>
				Ref.update(calls, (seen) => [...seen, `signIn:${agentId}`]).pipe(Effect.andThen(outcome)),
			cancel: (agentId) =>
				Ref.update(calls, (seen) => [...seen, `cancel:${agentId}`]).pipe(
					Effect.as(cancelAnswer)
				)
		})
	)

const TestLive = Layer.mergeAll(
	ProviderRegistryLive.pipe(
		Layer.provide(ProviderAdapterRegistryLive([fakeClaude, fakeCodex, fakeUnknownProvider, fakeGrok]))
	),
	AgentInstallerUnsupportedPlatformLive("test-host"),
	Layer.effect(
		AgentAuthenticator,
		Effect.map(Ref.make<ReadonlyArray<string>>([]), (calls) =>
			AgentAuthenticator.of({
				signIn: (agentId) => Ref.update(calls, (seen) => [...seen, `signIn:${agentId}`]),
				cancel: () => Effect.succeed(false)
			}))
	)
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
						availabilityKind: { kind: "installable", installed: true },
						signIn: { kind: "browser" }
					},
					{
						id: "codex",
						name: "Codex",
						availabilityKind: { kind: "installable", installed: false },
						signIn: { kind: "browser" }
					},
					{
						id: "something-new",
						name: "something-new",
						availabilityKind: { kind: "installable", installed: true },
						// An agent the sign-in table does not know reports manual
						// with the copy the server owns, never a browser method
						// nothing can run.
						signIn: signInMethodForAgent("something-new")
					},
					{
						id: "grok-build",
						name: "Grok Build",
						availabilityKind: { kind: "installable", installed: true },
						signIn: { kind: "browser" }
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

// The same shape for the fact a login changes. Presence reads the ref every
// time the handler asks, which is what a live adapter does now that its
// probe runs on each read rather than once at layer construction.
const authRefBackedAdapter = (
	providerId: ProviderId,
	authenticatedRef: Ref.Ref<boolean>
): ProviderAdapter => ({
	...makeFakeProviderAdapter({
		providerId,
		capabilities: ProviderCapabilities.make({ enabled: [] }),
		installed: true,
		authenticated: false,
		updates: []
	}),
	presence: Ref.get(authenticatedRef).pipe(
		Effect.map((authenticated) => ({ providerId, installed: true, authenticated }))
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
		fakeInstallerLayer(installedRef),
		Layer.effect(
			AgentAuthenticator,
			Effect.map(Ref.make<ReadonlyArray<string>>([]), (calls) =>
				AgentAuthenticator.of({
					signIn: (agentId) => Ref.update(calls, (seen) => [...seen, `signIn:${agentId}`]),
					cancel: () => Effect.succeed(false)
				}))
		)
	)

const authEnv = (
	calls: Ref.Ref<ReadonlyArray<string>>,
	outcome?: Effect.Effect<void, AgentSignInRejectedError | AgentSignInCancelledError>,
	cancelAnswer?: boolean
) =>
	Layer.mergeAll(
		registryWith(
			makeFakeProviderAdapter({
				providerId: CODEX_ID,
				capabilities: ProviderCapabilities.make({ enabled: [] }),
				installed: true,
				authenticated: false,
				updates: []
			})
		),
		AgentInstallerUnsupportedPlatformLive("test-host"),
		fakeAuthenticatorLayer(calls, outcome ?? Effect.void, cancelAnswer ?? true)
	)

Vitest.describe("routeAgentCall agent.authenticate", () => {
	Vitest.it.effect("reaches the provider's sign-in path rather than answering by itself", () =>
		Effect.gen(function*() {
			const calls = yield* Ref.make<ReadonlyArray<string>>([])
			const result = yield* routeAgentCall({ op: "agent.authenticate", agentId: "codex" }).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(authEnv(calls))
			)
			Vitest.assert.deepStrictEqual(yield* Ref.get(calls), ["signIn:codex"])
			Vitest.assert.strictEqual(result.op, "agent.authenticate")
			if (result.op === "agent.authenticate") {
				Vitest.assert.strictEqual(result.agentId, "codex")
			}
		})
	)

	// The point of carrying an agent list here at all: the list is read AFTER
	// the login command exited, so a credential the login just wrote is in
	// the answer that reaches the caller. While every adapter cached its
	// presence at layer construction this result had to carry nothing.
	Vitest.it.effect("answers with the agent list read after the login finished", () =>
		Effect.gen(function*() {
			const calls = yield* Ref.make<ReadonlyArray<string>>([])
			const authenticated = yield* Ref.make(false)
			const env = Layer.mergeAll(
				registryWith(authRefBackedAdapter(CODEX_ID, authenticated)),
				AgentInstallerUnsupportedPlatformLive("test-host"),
				Layer.succeed(
					AgentAuthenticator,
					AgentAuthenticator.of({
						// What a real login does: it writes the credential store the
						// adapter's presence probe reads.
						signIn: (agentId) =>
							Ref.update(calls, (seen) => [...seen, `signIn:${agentId}`]).pipe(
								Effect.andThen(Ref.set(authenticated, true))
							),
						cancel: () => Effect.succeed(false)
					})
				)
			)
			const result = yield* routeAgentCall({ op: "agent.authenticate", agentId: "codex" }).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(env)
			)
			Vitest.assert.strictEqual(result.op, "agent.authenticate")
			if (result.op === "agent.authenticate") {
				Vitest.assert.deepStrictEqual(
					result.agents.map((agent) => agent.id),
					["codex"]
				)
			}
		})
	)

	Vitest.it.effect("carries the sign-in's own reason, not the name of a missing call", () =>
		Effect.gen(function*() {
			const calls = yield* Ref.make<ReadonlyArray<string>>([])
			const outcome = Effect.fail(
				new AgentSignInRejectedError({ agentId: CODEX_ID, exitCode: 7 })
			)
			const result = yield* Effect.result(
				routeAgentCall({ op: "agent.authenticate", agentId: "codex" }).pipe(
					// @effect-diagnostics-next-line strictEffectProvide:off
					Effect.provide(authEnv(calls, outcome))
				)
			)
			Vitest.assert.strictEqual(result._tag, "Failure")
			if (result._tag === "Failure") {
				Vitest.assert.strictEqual(result.failure._tag, "RpcAgentCallError")
				Vitest.assert.strictEqual(result.failure.message.includes("code 7"), true)
				Vitest.assert.strictEqual(result.failure.message.includes("unsupported"), false)
			}
		})
	)
})

Vitest.describe("routeAgentCall agent.cancel-authentication", () => {
	Vitest.it.effect("stops the sign-in that is running and says it did", () =>
		Effect.gen(function*() {
			const calls = yield* Ref.make<ReadonlyArray<string>>([])
			const result = yield* routeAgentCall({
				op: "agent.cancel-authentication",
				agentId: "codex"
			}).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(authEnv(calls))
			)
			Vitest.assert.deepStrictEqual(yield* Ref.get(calls), ["cancel:codex"])
			Vitest.assert.deepStrictEqual(result, {
				op: "agent.cancel-authentication",
				agentId: "codex",
				cancelled: true
			})
		})
	)

	Vitest.it.effect("says so when there was no sign-in to stop", () =>
		Effect.gen(function*() {
			const calls = yield* Ref.make<ReadonlyArray<string>>([])
			const result = yield* routeAgentCall({
				op: "agent.cancel-authentication",
				agentId: "codex"
			}).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(authEnv(calls, undefined, false))
			)
			Vitest.assert.deepStrictEqual(result, {
				op: "agent.cancel-authentication",
				agentId: "codex",
				cancelled: false
			})
		})
	)
})

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
						availabilityKind: { kind: "installable", installed: false },
						signIn: { kind: "browser" }
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
						availabilityKind: { kind: "installable", installed: true },
						signIn: { kind: "browser" }
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
						availabilityKind: { kind: "installable", installed: false },
						signIn: { kind: "browser" }
					}
				]
			})
		})
	)
})
