import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import {
	agentEnvOverridesFor,
	describeAgentEnvOverrides,
	EMPTY_AGENT_ENV,
	mergeAgentEnv,
	sanitizeAgentEnvOverrides
} from "./AgentEnv.ts"

const SECRET = "sk-do-not-log-me-4711"

const SpawnerPlatform = BunChildProcessSpawner.layer.pipe(
	Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))
)

const settingJson = JSON.stringify({
	"claude-code": { ANTHROPIC_API_KEY: SECRET, HTTPS_PROXY: "http://proxy.internal:8080" },
	codex: { OPENAI_API_KEY: "codex-secret" }
})

Vitest.describe("agentEnvOverridesFor", () => {
	Vitest.it("reads the overrides stored for one agent", () => {
		Vitest.assert.deepStrictEqual(agentEnvOverridesFor(settingJson, "claude-code"), {
			ANTHROPIC_API_KEY: SECRET,
			HTTPS_PROXY: "http://proxy.internal:8080"
		})
	})

	Vitest.it("gives an agent with no stored overrides an empty map", () => {
		Vitest.assert.deepStrictEqual(agentEnvOverridesFor(settingJson, "cursor"), EMPTY_AGENT_ENV)
	})

	Vitest.it("survives a missing, blank, or malformed setting", () => {
		Vitest.assert.deepStrictEqual(agentEnvOverridesFor("", "claude-code"), EMPTY_AGENT_ENV)
		Vitest.assert.deepStrictEqual(agentEnvOverridesFor("not json", "claude-code"), EMPTY_AGENT_ENV)
		Vitest.assert.deepStrictEqual(
			agentEnvOverridesFor(JSON.stringify({ "claude-code": { KEY: 7 } }), "claude-code"),
			EMPTY_AGENT_ENV
		)
	})

	Vitest.it("drops a stored name that would hijack the spawned process", () => {
		const stored = JSON.stringify({
			"claude-code": {
				PATH: "/tmp/evil",
				NODE_OPTIONS: "--require /tmp/evil.js",
				DYLD_INSERT_LIBRARIES: "/tmp/evil.dylib",
				LD_PRELOAD: "/tmp/evil.so",
				BASH_ENV: "/tmp/evil.sh",
				ANTHROPIC_API_KEY: SECRET
			}
		})
		Vitest.assert.deepStrictEqual(agentEnvOverridesFor(stored, "claude-code"), {
			ANTHROPIC_API_KEY: SECRET
		})
	})

	Vitest.it("drops a name that cannot be a variable", () => {
		Vitest.assert.deepStrictEqual(
			sanitizeAgentEnvOverrides({ "": "x", "A=B": "y", KEEP: "z" }),
			{ KEEP: "z" }
		)
	})
})

Vitest.describe("mergeAgentEnv", () => {
	Vitest.it("keeps the parent environment the child still needs", () => {
		const merged = mergeAgentEnv(
			{ PATH: "/usr/bin", HOME: "/Users/someone", ANTHROPIC_API_KEY: "inherited" },
			{ ANTHROPIC_API_KEY: SECRET }
		)
		Vitest.assert.strictEqual(merged["PATH"], "/usr/bin")
		Vitest.assert.strictEqual(merged["HOME"], "/Users/someone")
		Vitest.assert.strictEqual(merged["ANTHROPIC_API_KEY"], SECRET)
	})

	Vitest.it("refuses to let an override replace the inherited PATH", () => {
		const merged = mergeAgentEnv({ PATH: "/usr/bin" }, { PATH: "/tmp/evil" })
		Vitest.assert.strictEqual(merged["PATH"], "/usr/bin")
	})
})

Vitest.describe("describeAgentEnvOverrides", () => {
	Vitest.it("names the variables and never their values", () => {
		const described = describeAgentEnvOverrides({
			ANTHROPIC_API_KEY: SECRET,
			HTTPS_PROXY: "http://user:hunter2@proxy.internal:8080"
		})
		Vitest.assert.strictEqual(described, "ANTHROPIC_API_KEY, HTTPS_PROXY")
		Vitest.assert.isFalse(described.includes(SECRET))
		Vitest.assert.isFalse(described.includes("hunter2"))
	})

	Vitest.it("says so when there is nothing to report", () => {
		Vitest.assert.strictEqual(describeAgentEnvOverrides(EMPTY_AGENT_ENV), "none")
	})
})

// The real spawn seam, not a stand-in: this is exactly the ChildProcess.make
// shape the Codex, Cursor and Copilot adapters use, run through the real
// spawner against a real child, so a change to Effect's own extendEnv
// semantics breaks here rather than silently in production.
const readChildEnv = (
	overrides: Record<string, string>
): Effect.Effect<string, unknown, ChildProcessSpawner.ChildProcessSpawner> =>
	Effect.gen(function*() {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
		const scope = yield* Scope.make()
		const child = yield* spawner
			.spawn(
				ChildProcess.make("/usr/bin/env", [], {
					env: overrides,
					extendEnv: true,
					detached: false
				})
			)
			.pipe(Effect.provideService(Scope.Scope, scope))
		const output = yield* child.stdout.pipe(Stream.decodeText, Stream.mkString)
		yield* Scope.close(scope, Exit.void).pipe(Effect.ignore)
		return output
	})

Vitest.layer(SpawnerPlatform)("the spawn environment a provider actually gets", (it) => {
	it.effect("carries an override into the child process", () =>
		Effect.gen(function*() {
			const output = yield* readChildEnv({ ACEPE_ENV_PROBE: "probe-value" })
			Vitest.assert.include(output, "ACEPE_ENV_PROBE=probe-value")
		}))

	it.effect("keeps the parent environment the child already needed", () =>
		Effect.gen(function*() {
			const output = yield* readChildEnv({ ACEPE_ENV_PROBE: "probe-value" })
			Vitest.assert.include(output, `PATH=${process.env["PATH"] ?? ""}`)
		}))

	it.effect("lets an override win over the same name in the parent", () =>
		Effect.gen(function*() {
			process.env["ACEPE_ENV_PROBE_PARENT"] = "from-parent"
			const output = yield* readChildEnv({ ACEPE_ENV_PROBE_PARENT: "from-override" })
			Vitest.assert.include(output, "ACEPE_ENV_PROBE_PARENT=from-override")
			Vitest.assert.notInclude(output, "ACEPE_ENV_PROBE_PARENT=from-parent")
		}))
})
