import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import { isCapabilityEnabled } from "../../Services/ProviderAdapter.ts"
import { loadCodexNativeConfigState } from "./Config.ts"
import {
	CODEX_APP_SERVER_ARGS,
	CODEX_CAPABILITIES,
	CODEX_DEFERRED_SESSION_CREATION,
	CODEX_PLACEHOLDER_COMMAND,
	CODEX_PROVIDER_ID,
	codexPresence,
	isCodexPlanCapabilityEnabled,
	isRecoverableThreadResumeError,
	normalizeCodexModelId,
	placeholderCodexSpawnConfig,
	probeCodexPresence,
	resolveCodexModeId,
	resolveCodexSpawnConfig
} from "./Provider.ts"

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const homeLayer = (homeDir: string) =>
	ConfigProvider.layer(ConfigProvider.fromEnv({ env: { HOME: homeDir } }))

Vitest.describe("CodexProvider", () => {
	Vitest.it("uses the codex provider id", () => {
		Vitest.assert.strictEqual(CODEX_PROVIDER_ID, "codex")
	})

	Vitest.it("does not use deferred session creation", () => {
		Vitest.assert.strictEqual(CODEX_DEFERRED_SESSION_CREATION, false)
	})

	Vitest.it("enables the capabilities the UI currently renders", () => {
		Vitest.assert.deepStrictEqual(CODEX_CAPABILITIES.enabled, [
			"models",
			"modes",
			"configOptions",
			"plan",
			"usage",
			"toolCalls",
			"permissionRequests"
		])
		Vitest.assert.strictEqual(isCapabilityEnabled(CODEX_CAPABILITIES, "plan"), true)
		Vitest.assert.strictEqual(isCapabilityEnabled(CODEX_CAPABILITIES, "compaction"), false)
		Vitest.assert.strictEqual(isCodexPlanCapabilityEnabled(), true)
	})

	Vitest.it("keeps the placeholder spawn on app-server", () => {
		const spawn = placeholderCodexSpawnConfig()
		Vitest.assert.strictEqual(spawn.command, CODEX_PLACEHOLDER_COMMAND)
		Vitest.assert.deepStrictEqual(spawn.args, Arr.fromIterable(CODEX_APP_SERVER_ARGS))
	})

	// Pinned literally (not just re-compared against CODEX_APP_SERVER_ARGS
	// itself) so a future edit that drops the isolation flags fails this
	// test by name. See CODEX_APP_SERVER_ARGS' doc comment for the empirical
	// evidence: `-c mcp_servers={}` blocks the operator's personal MCP
	// servers from spawning as app-server children, `--disable hooks` stops
	// ~/.codex/hooks.json from loading, and codex app-server has no
	// `--ignore-user-config` equivalent to isolate more wholesale.
	Vitest.it("spawns codex app-server with the operator's personal MCP servers and hooks blocked", () => {
		Vitest.assert.deepStrictEqual(Arr.fromIterable(CODEX_APP_SERVER_ARGS), [
			"app-server",
			"-c",
			"mcp_servers={}",
			"--disable",
			"hooks"
		])
	})

	Vitest.it("normalizes empty model ids to the default", () => {
		Vitest.assert.strictEqual(normalizeCodexModelId("  gpt-5.4  "), "gpt-5.4")
		Vitest.assert.strictEqual(normalizeCodexModelId("   "), "gpt-5.3-codex")
	})

	Vitest.it("maps visible mode ids onto agent or plan", () => {
		Vitest.assert.deepStrictEqual(resolveCodexModeId("plan"), Option.some("plan"))
		Vitest.assert.deepStrictEqual(resolveCodexModeId("build"), Option.some("agent"))
		Vitest.assert.deepStrictEqual(resolveCodexModeId("agent"), Option.some("agent"))
		Vitest.assert.strictEqual(Option.isNone(resolveCodexModeId("ask")), true)
	})

	Vitest.it("classifies recoverable thread/resume errors", () => {
		Vitest.assert.strictEqual(
			isRecoverableThreadResumeError("thread/resume failed: thread not found"),
			true
		)
		Vitest.assert.strictEqual(
			isRecoverableThreadResumeError("thread/resume failed: timed out waiting for server"),
			true
		)
		Vitest.assert.strictEqual(
			isRecoverableThreadResumeError(
				'thread/resume failed: {"code":-32602,"message":"Session not found: 019df08e-7bee"}'
			),
			true
		)
		Vitest.assert.strictEqual(
			isRecoverableThreadResumeError("thread/start failed: permission denied"),
			false
		)
	})

	Vitest.it("reports presence without reading process.env", () => {
		const presence = codexPresence(true, false)
		Vitest.assert.strictEqual(presence.providerId, CODEX_PROVIDER_ID)
		Vitest.assert.strictEqual(presence.installed, true)
		Vitest.assert.strictEqual(presence.authenticated, false)
	})
})

Vitest.layer(Platform)("CodexProvider live probes", (it) => {
	it.effect("treats a missing cache as not installed", () =>
		Effect.gen(function*() {
			const presence = yield* probeCodexPresence(Option.none())
			Vitest.assert.strictEqual(presence.providerId, CODEX_PROVIDER_ID)
			Vitest.assert.strictEqual(presence.installed, false)
			const spawn = yield* resolveCodexSpawnConfig(Option.none())
			Vitest.assert.strictEqual(spawn.command, CODEX_PLACEHOLDER_COMMAND)
			Vitest.assert.deepStrictEqual(spawn.args, Arr.fromIterable(CODEX_APP_SERVER_ARGS))
		})
	)

	it.effect("resolves the managed cache binary and auth file", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = yield* fs.makeTempDirectoryScoped()
			const cacheDir = path.join(root, "agents")
			const homeDir = path.join(root, "home")
			const agentDir = path.join(cacheDir, "codex")
			yield* fs.makeDirectory(agentDir, { recursive: true })
			yield* fs.makeDirectory(path.join(homeDir, ".codex"), { recursive: true })
			yield* fs.writeFileString(
				path.join(agentDir, "meta.json"),
				'{"cmd":"./codex"}'
			)
			yield* fs.writeFileString(path.join(agentDir, "codex"), "stub")
			yield* fs.writeFileString(path.join(homeDir, ".codex", "auth.json"), "{}")
			yield* fs.writeFileString(
				path.join(homeDir, ".codex", "config.toml"),
				'model = "gpt-5.4"\nmodel_reasoning_effort = "low"\n'
			)
			const env = homeLayer(homeDir)
			const presence = yield* probeCodexPresence(Option.some(cacheDir)).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(env)
			)
			Vitest.assert.strictEqual(presence.installed, true)
			Vitest.assert.strictEqual(presence.authenticated, true)
			const spawn = yield* resolveCodexSpawnConfig(Option.some(cacheDir))
			Vitest.assert.strictEqual(spawn.command, path.join(agentDir, "codex"))
			const config = yield* loadCodexNativeConfigState(path.join(root, "project")).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(env)
			)
			Vitest.assert.strictEqual(config.currentModelId, "gpt-5.4")
			Vitest.assert.strictEqual(config.reasoningEffort, "low")
		})
	)
})
