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
import * as Schema from "effect/Schema"
import { isCapabilityEnabled } from "../Services/ProviderAdapter.ts"
import {
	buildCodexInitializeParams,
	buildCodexTurnStartParams,
	buildThreadResumeParams,
	buildThreadStartParams,
	buildTurnInterruptParams,
	CODEX_APP_SERVER_ARGS,
	CODEX_CAPABILITIES,
	CODEX_DEFERRED_SESSION_CREATION,
	CODEX_PLACEHOLDER_COMMAND,
	CODEX_PROVIDER_ID,
	codexPresence,
	defaultCodexNativeConfigState,
	isCodexPlanCapabilityEnabled,
	isRecoverableThreadResumeError,
	loadCodexNativeConfigState,
	mapCodexPermissionReply,
	normalizeCodexModelId,
	parseCodexToml,
	parseThreadId,
	parseTurnId,
	placeholderCodexSpawnConfig,
	probeCodexPresence,
	resolveCodexModeId,
	resolveCodexSpawnConfig
} from "./CodexProvider.ts"

type Json = typeof Schema.Json.Type
type JsonObject = typeof Schema.JsonObject.Type

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)
const isJsonObject = Schema.is(Schema.JsonObject)

const homeLayer = (homeDir: string) =>
	ConfigProvider.layer(ConfigProvider.fromEnv({ env: { HOME: homeDir } }))

const asObject = (value: Json | undefined): Option.Option<JsonObject> => {
	if (value === undefined || isJsonObject(value) === false) {
		return Option.none()
	}
	return Option.some(value)
}

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

	Vitest.it("parses only the Codex config.toml keys rust reads", () => {
		const patch = parseCodexToml(
			'model = "gpt-5.4"\nmodel_reasoning_effort = "medium"\nservice_tier = "fast"\n# comment\nignored = "nope"\n'
		)
		Vitest.assert.deepStrictEqual(patch.currentModelId, Option.some("gpt-5.4"))
		Vitest.assert.deepStrictEqual(patch.reasoningEffort, Option.some("medium"))
		Vitest.assert.deepStrictEqual(patch.fastMode, Option.some(true))
	})

	Vitest.it("builds native protocol payloads", () => {
		Vitest.assert.deepStrictEqual(buildThreadStartParams("/tmp/project"), {
			cwd: "/tmp/project",
			experimentalRawEvents: false,
			persistExtendedHistory: true
		})
		Vitest.assert.deepStrictEqual(buildThreadResumeParams("thread-1", "/tmp/project"), {
			threadId: "thread-1",
			cwd: "/tmp/project",
			persistExtendedHistory: true
		})
		Vitest.assert.deepStrictEqual(buildTurnInterruptParams("thread-1", "turn-1"), {
			threadId: "thread-1",
			turnId: "turn-1"
		})
		const initialize = buildCodexInitializeParams()
		const capabilities = asObject(initialize.capabilities)
		Vitest.assert.isTrue(Option.isSome(capabilities))
		if (Option.isSome(capabilities)) {
			Vitest.assert.strictEqual(capabilities.value.experimentalApi, true)
		}
		const turn = buildCodexTurnStartParams({
			threadId: "thread-1",
			text: "Hello",
			state: defaultCodexNativeConfigState(),
			modeId: "plan"
		})
		Vitest.assert.strictEqual(turn.threadId, "thread-1")
		Vitest.assert.strictEqual(turn.effort, "high")
		const collaboration = asObject(turn.collaborationMode)
		Vitest.assert.isTrue(Option.isSome(collaboration))
		if (Option.isSome(collaboration)) {
			Vitest.assert.strictEqual(collaboration.value.mode, "plan")
		}
	})

	Vitest.it("parses thread and turn ids from app-server results", () => {
		Vitest.assert.deepStrictEqual(
			parseThreadId({ thread: { id: "thread-1" } }),
			Option.some("thread-1")
		)
		Vitest.assert.deepStrictEqual(parseThreadId({ threadId: "thread-2" }), Option.some("thread-2"))
		Vitest.assert.deepStrictEqual(parseTurnId({ turn: { id: "turn-1" } }), Option.some("turn-1"))
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

	Vitest.it("maps permission replies onto Codex decisions", () => {
		Vitest.assert.deepStrictEqual(mapCodexPermissionReply("once"), Option.some("accept"))
		Vitest.assert.deepStrictEqual(
			mapCodexPermissionReply("always"),
			Option.some("acceptForSession")
		)
		Vitest.assert.deepStrictEqual(mapCodexPermissionReply("reject"), Option.some("decline"))
		Vitest.assert.deepStrictEqual(mapCodexPermissionReply("allow"), Option.some("accept"))
		Vitest.assert.strictEqual(Option.isNone(mapCodexPermissionReply("maybe")), true)
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
