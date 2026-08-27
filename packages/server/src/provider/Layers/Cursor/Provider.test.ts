import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import { decodeAgentJson } from "../../agentJson.ts"
import { isCapabilityEnabled, ProviderId } from "../../Services/ProviderAdapter.ts"
import {
	CURSOR_BINARY_ENV_KEY,
	CURSOR_BINARY_NAME,
	CURSOR_CAPABILITIES,
	CURSOR_MODES,
	CURSOR_PROVIDER_ID,
	CURSOR_REGISTRY_AGENT_ID,
	cursorLaunchConfig,
	cursorLaunchFromAgents,
	cursorPresence,
	launchFromAgentJson,
	probeCursorBinary
} from "./Provider.ts"

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

// The probe reads PATH and its override through Config, so each test names
// the environment it wants instead of inheriting the machine's.
const withEnv = <A, E, R>(program: Effect.Effect<A, E, R>, env: Record<string, string>) =>
	Effect.provideService(program, ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env }))

const cursorAgentJson = {
	id: "cursor",
	name: "Cursor",
	version: "2026.08.11",
	distribution: {
		binary: {
			"darwin-aarch64": {
				archive:
					"https://downloads.cursor.com/lab/2026.08.11-e8db854/darwin/arm64/agent-cli-package.tar.gz",
				cmd: "./dist-package/cursor-agent",
				args: ["acp"]
			}
		}
	}
}

Vitest.describe("CursorProvider", () => {
	Vitest.it("uses the ACP registry cursor id", () => {
		Vitest.assert.strictEqual(CURSOR_PROVIDER_ID, ProviderId.make("cursor"))
		Vitest.assert.strictEqual(CURSOR_REGISTRY_AGENT_ID, "cursor")
	})

	Vitest.it("enables models, modes, commands, plan, tools, and permissions as data", () => {
		Vitest.assert.strictEqual(isCapabilityEnabled(CURSOR_CAPABILITIES, "models"), true)
		Vitest.assert.strictEqual(isCapabilityEnabled(CURSOR_CAPABILITIES, "modes"), true)
		Vitest.assert.strictEqual(isCapabilityEnabled(CURSOR_CAPABILITIES, "commands"), true)
		Vitest.assert.strictEqual(isCapabilityEnabled(CURSOR_CAPABILITIES, "plan"), true)
		Vitest.assert.strictEqual(isCapabilityEnabled(CURSOR_CAPABILITIES, "toolCalls"), true)
		Vitest.assert.strictEqual(isCapabilityEnabled(CURSOR_CAPABILITIES, "permissionRequests"), true)
		Vitest.assert.strictEqual(isCapabilityEnabled(CURSOR_CAPABILITIES, "compaction"), false)
		Vitest.assert.strictEqual(isCapabilityEnabled(CURSOR_CAPABILITIES, "usage"), false)
		Vitest.assert.deepStrictEqual(CURSOR_MODES, ["agent", "ask"])
	})

	Vitest.it("reports presence without reading process.env", () => {
		const presence = cursorPresence(true, false)
		Vitest.assert.strictEqual(presence.providerId, CURSOR_PROVIDER_ID)
		Vitest.assert.strictEqual(presence.installed, true)
		Vitest.assert.strictEqual(presence.authenticated, false)
	})

	// The ACP registry entry runs the binary as `cursor-agent acp` (see
	// launchFromAgentJson's fixture below), and a binary the operator
	// installed themselves takes the same subcommand.
	Vitest.it("launches an operator-installed cursor-agent through its acp subcommand", () => {
		Vitest.assert.deepStrictEqual(cursorLaunchConfig("/usr/local/bin/cursor-agent"), {
			command: "/usr/local/bin/cursor-agent",
			args: ["acp"]
		})
	})
})

// Cursor was unreachable in the product because its only launch path went
// through AgentInstaller, which nothing builds. An operator who installed
// cursor-agent themselves has it on PATH, which is where Claude, Codex,
// OpenCode and Copilot all look for their own CLI.
Vitest.layer(Platform)("probeCursorBinary", (it) => {
	it.effect("finds cursor-agent on PATH", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			const binary = path.join(dir, CURSOR_BINARY_NAME)
			yield* fs.writeFileString(binary, "#!/bin/sh\n")
			const found = yield* withEnv(probeCursorBinary(), { PATH: `/nonexistent:${dir}` })
			Vitest.assert.deepStrictEqual(found, Option.some(binary))
		})
	)

	it.effect("prefers an explicit binary override over PATH", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			const override = path.join(dir, "cursor-agent-nightly")
			yield* fs.writeFileString(override, "#!/bin/sh\n")
			const found = yield* withEnv(probeCursorBinary(), {
				PATH: "/nonexistent",
				[CURSOR_BINARY_ENV_KEY]: override
			})
			Vitest.assert.deepStrictEqual(found, Option.some(override))
		})
	)

	it.effect("reports none when no cursor-agent is installed", () =>
		Effect.gen(function*() {
			const found = yield* withEnv(probeCursorBinary(), { PATH: "/nonexistent" })
			Vitest.assert.deepStrictEqual(found, Option.none())
		})
	)
})

Vitest.describe("launchFromAgentJson", () => {
	Vitest.it.effect("reads cmd and args from cursor/agent.json, not a hardcoded install", () =>
		Effect.gen(function*() {
			const agent = yield* decodeAgentJson(cursorAgentJson)
			const launch = launchFromAgentJson(agent, "darwin-aarch64")
			Vitest.assert.isTrue(Option.isSome(launch))
			if (Option.isSome(launch)) {
				Vitest.assert.strictEqual(launch.value.cmd, "./dist-package/cursor-agent")
				Vitest.assert.deepStrictEqual(launch.value.args, ["acp"])
				Vitest.assert.notStrictEqual(launch.value.cmd, "cursor-agent")
			}
		})
	)

	Vitest.it.effect("returns none when the platform is missing from agent.json", () =>
		Effect.gen(function*() {
			const agent = yield* decodeAgentJson(cursorAgentJson)
			Vitest.assert.deepStrictEqual(launchFromAgentJson(agent, "linux-x86_64"), Option.none())
		})
	)

	Vitest.it.effect("finds the registry cursor entry among other agents", () =>
		Effect.gen(function*() {
			const cursor = yield* decodeAgentJson(cursorAgentJson)
			const goose = yield* decodeAgentJson({
				id: "goose",
				version: "1.46.0",
				distribution: {
					binary: {
						"darwin-aarch64": {
							archive: "https://github.com/block/goose/releases/download/v1.46.0/goose.tar.bz2",
							cmd: "./goose",
							args: ["acp"]
						}
					}
				}
			})
			const launch = cursorLaunchFromAgents([goose, cursor], "darwin-aarch64")
			Vitest.assert.isTrue(Option.isSome(launch))
			if (Option.isSome(launch)) {
				Vitest.assert.strictEqual(launch.value.cmd, "./dist-package/cursor-agent")
				Vitest.assert.deepStrictEqual(launch.value.args, ["acp"])
			}
			Vitest.assert.deepStrictEqual(
				cursorLaunchFromAgents(Arr.of(goose), "darwin-aarch64"),
				Option.none()
			)
		})
	)
})
