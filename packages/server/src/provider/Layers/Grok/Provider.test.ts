import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import { isCapabilityEnabled, ProviderId } from "../../Services/ProviderAdapter.ts"
import {
	GROK_ACP_ARGS,
	GROK_API_KEY_ENV_KEYS,
	GROK_AUTH_API_KEY,
	GROK_AUTH_CACHED_TOKEN,
	GROK_AUTH_RELATIVE_PATH,
	GROK_BINARY_ENV_KEY,
	GROK_BINARY_NAME,
	GROK_CAPABILITIES,
	GROK_MODES,
	GROK_PROVIDER_ID,
	GROK_REGISTRY_AGENT_ID,
	grokAuthenticateParams,
	grokLaunchConfig,
	grokPresence,
	missingGrokBinaryError,
	probeGrokBinary,
	probeGrokPresence
} from "./Provider.ts"

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const withEnv = <A, E, R>(program: Effect.Effect<A, E, R>, env: Record<string, string>) =>
	Effect.provideService(program, ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env }))

Vitest.describe("GrokProvider", () => {
	Vitest.it("uses the ACP registry grok-build id", () => {
		Vitest.assert.strictEqual(GROK_PROVIDER_ID, ProviderId.make("grok-build"))
		Vitest.assert.strictEqual(GROK_REGISTRY_AGENT_ID, "grok-build")
	})

	Vitest.it("enables models, modes, commands, plan, tools, and permissions as data", () => {
		Vitest.assert.strictEqual(isCapabilityEnabled(GROK_CAPABILITIES, "models"), true)
		Vitest.assert.strictEqual(isCapabilityEnabled(GROK_CAPABILITIES, "modes"), true)
		Vitest.assert.strictEqual(isCapabilityEnabled(GROK_CAPABILITIES, "commands"), true)
		Vitest.assert.strictEqual(isCapabilityEnabled(GROK_CAPABILITIES, "plan"), true)
		Vitest.assert.strictEqual(isCapabilityEnabled(GROK_CAPABILITIES, "toolCalls"), true)
		Vitest.assert.strictEqual(isCapabilityEnabled(GROK_CAPABILITIES, "permissionRequests"), true)
		Vitest.assert.strictEqual(isCapabilityEnabled(GROK_CAPABILITIES, "compaction"), false)
		Vitest.assert.strictEqual(isCapabilityEnabled(GROK_CAPABILITIES, "usage"), false)
		Vitest.assert.deepStrictEqual(GROK_MODES, ["agent"])
	})

	Vitest.it("reports presence without reading process.env", () => {
		const presence = grokPresence(true, false)
		Vitest.assert.strictEqual(presence.providerId, GROK_PROVIDER_ID)
		Vitest.assert.strictEqual(presence.installed, true)
		Vitest.assert.strictEqual(presence.authenticated, false)
	})

	// The ACP registry entry for grok-build runs `@xai-official/grok` as
	// `agent stdio`. An operator-installed `grok` on PATH takes the same args.
	Vitest.it("launches an operator-installed grok through agent stdio", () => {
		Vitest.assert.deepStrictEqual(GROK_ACP_ARGS, ["agent", "stdio"])
		Vitest.assert.deepStrictEqual(grokLaunchConfig("/usr/local/bin/grok"), {
			command: "/usr/local/bin/grok",
			args: ["agent", "stdio"]
		})
	})

	Vitest.it("authenticates with cached_token, or xai.api_key plus headless when a key is present", () => {
		Vitest.assert.deepStrictEqual(grokAuthenticateParams(false), {
			methodId: GROK_AUTH_CACHED_TOKEN
		})
		Vitest.assert.deepStrictEqual(grokAuthenticateParams(true), {
			methodId: GROK_AUTH_API_KEY,
			_meta: { headless: true }
		})
		Vitest.assert.deepStrictEqual(GROK_API_KEY_ENV_KEYS, ["XAI_API_KEY", "GROK_CODE_XAI_API_KEY"])
		Vitest.assert.strictEqual(GROK_AUTH_RELATIVE_PATH, ".grok/auth.json")
	})

	Vitest.it("names the grok CLI when the binary is missing", () => {
		const error = missingGrokBinaryError()
		Vitest.assert.strictEqual(error.operation, "startSession")
		Vitest.assert.strictEqual(error.providerId, GROK_PROVIDER_ID)
		Vitest.assert.isTrue(error.detail.includes(GROK_BINARY_NAME))
		Vitest.assert.isTrue(error.detail.includes(GROK_BINARY_ENV_KEY))
	})
})

Vitest.layer(Platform)("probeGrokBinary", (it) => {
	it.effect("finds grok on PATH", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			const binary = path.join(dir, GROK_BINARY_NAME)
			yield* fs.writeFileString(binary, "#!/bin/sh\n")
			const found = yield* withEnv(probeGrokBinary(), { PATH: `/nonexistent:${dir}` })
			Vitest.assert.deepStrictEqual(found, Option.some(binary))
		})
	)

	it.effect("prefers an explicit binary override over PATH", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			const override = path.join(dir, "grok-nightly")
			yield* fs.writeFileString(override, "#!/bin/sh\n")
			const found = yield* withEnv(probeGrokBinary(), {
				PATH: "/nonexistent",
				[GROK_BINARY_ENV_KEY]: override
			})
			Vitest.assert.deepStrictEqual(found, Option.some(override))
		})
	)

	it.effect("reports none when no grok is installed", () =>
		Effect.gen(function*() {
			const found = yield* withEnv(probeGrokBinary(), { PATH: "/nonexistent" })
			Vitest.assert.deepStrictEqual(found, Option.none())
		})
	)
})

Vitest.layer(Platform)("probeGrokPresence", (it) => {
	it.effect("flips installed when a grok stub appears on PATH", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = yield* fs.makeTempDirectoryScoped()
			const bin = path.join(root, "bin")
			const home = path.join(root, "home")
			yield* fs.makeDirectory(bin, { recursive: true })
			yield* fs.makeDirectory(home, { recursive: true })
			const env = { PATH: bin, HOME: home }

			const before = yield* withEnv(probeGrokPresence(), env)
			Vitest.assert.strictEqual(before.providerId, GROK_PROVIDER_ID)
			Vitest.assert.strictEqual(before.installed, false)
			Vitest.assert.strictEqual(before.authenticated, false)

			yield* fs.writeFileString(path.join(bin, GROK_BINARY_NAME), "#!/bin/sh\n")
			const installed = yield* withEnv(probeGrokPresence(), env)
			Vitest.assert.strictEqual(installed.installed, true)
			Vitest.assert.strictEqual(installed.authenticated, false)
		})
	)

	it.effect("flips authenticated when ~/.grok/auth.json appears", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = yield* fs.makeTempDirectoryScoped()
			const bin = path.join(root, "bin")
			const home = path.join(root, "home")
			yield* fs.makeDirectory(bin, { recursive: true })
			yield* fs.makeDirectory(home, { recursive: true })
			yield* fs.writeFileString(path.join(bin, GROK_BINARY_NAME), "#!/bin/sh\n")
			const env = { PATH: bin, HOME: home }

			const before = yield* withEnv(probeGrokPresence(), env)
			Vitest.assert.strictEqual(before.authenticated, false)

			yield* fs.makeDirectory(path.join(home, ".grok"), { recursive: true })
			yield* fs.writeFileString(path.join(home, ".grok", "auth.json"), "{}")
			const signedIn = yield* withEnv(probeGrokPresence(), env)
			Vitest.assert.strictEqual(signedIn.installed, true)
			Vitest.assert.strictEqual(signedIn.authenticated, true)
		})
	)

	it.effect("treats a non-empty XAI_API_KEY as authenticated", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = yield* fs.makeTempDirectoryScoped()
			const bin = path.join(root, "bin")
			const home = path.join(root, "home")
			yield* fs.makeDirectory(bin, { recursive: true })
			yield* fs.makeDirectory(home, { recursive: true })
			yield* fs.writeFileString(path.join(bin, GROK_BINARY_NAME), "#!/bin/sh\n")

			const blank = yield* withEnv(probeGrokPresence(), {
				PATH: bin,
				HOME: home,
				XAI_API_KEY: "   "
			})
			Vitest.assert.strictEqual(blank.authenticated, false)

			const keyed = yield* withEnv(probeGrokPresence(), {
				PATH: bin,
				HOME: home,
				XAI_API_KEY: "xai-test-key"
			})
			Vitest.assert.strictEqual(keyed.authenticated, true)
		})
	)

	it.effect("treats a non-empty GROK_CODE_XAI_API_KEY as authenticated", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = yield* fs.makeTempDirectoryScoped()
			const bin = path.join(root, "bin")
			const home = path.join(root, "home")
			yield* fs.makeDirectory(bin, { recursive: true })
			yield* fs.makeDirectory(home, { recursive: true })
			yield* fs.writeFileString(path.join(bin, GROK_BINARY_NAME), "#!/bin/sh\n")

			const keyed = yield* withEnv(probeGrokPresence(), {
				PATH: bin,
				HOME: home,
				GROK_CODE_XAI_API_KEY: "grok-code-key"
			})
			Vitest.assert.strictEqual(keyed.authenticated, true)
		})
	)
})
