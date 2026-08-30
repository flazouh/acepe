import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import type { PlatformError } from "effect/PlatformError"
import * as Stream from "effect/Stream"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import {
	agentChildProcess,
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

// The real spawn seam, not a stand-in: agentChildProcess is the very
// function the Codex, Cursor and Copilot adapters call, run through the real
// spawner against a real child, so a change to Effect's own extendEnv
// semantics breaks here rather than silently in production.
const readChildEnv = (
	overrides: Record<string, string>
): Effect.Effect<string, PlatformError, ChildProcessSpawner.ChildProcessSpawner> =>
	Effect.gen(function*() {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
		const scope = yield* Scope.make()
		const child = yield* spawner
			.spawn(agentChildProcess("/usr/bin/env", [], { envOverrides: overrides }))
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

	// The overrides name one variable, and the child still gets the whole
	// inherited environment: PATH and HOME are both there and both real.
	it.effect("keeps the parent environment the child already needed", () =>
		Effect.gen(function*() {
			const output = yield* readChildEnv({ ACEPE_ENV_PROBE: "probe-value" })
			Vitest.assert.match(output, /(^|\n)PATH=[^\n]*\/usr\/bin/)
			Vitest.assert.match(output, /(^|\n)HOME=[^\n]+/)
		}))

	// HOME is inherited from this process, so overriding it proves the
	// override WINS on a collision rather than being appended beside the
	// inherited value: the child sees exactly one HOME, and it is ours.
	it.effect("lets an override win over the same name in the parent", () =>
		Effect.gen(function*() {
			const output = yield* readChildEnv({ HOME: "/tmp/acepe-env-probe-home" })
			const homeLines = output.split("\n").filter((line) => line.startsWith("HOME="))
			Vitest.assert.deepStrictEqual(homeLines, ["HOME=/tmp/acepe-env-probe-home"])
		}))

	// The blocklist has to hold at the spawn itself, not only where the
	// setting is read, because agentChildProcess is what every CLI provider
	// calls.
	it.effect("refuses a hijacking name even when it reaches the spawn builder", () =>
		Effect.gen(function*() {
			const output = yield* readChildEnv({
				NODE_OPTIONS: "--require /tmp/evil.js",
				ACEPE_ENV_PROBE: "probe-value"
			})
			Vitest.assert.include(output, "ACEPE_ENV_PROBE=probe-value")
			Vitest.assert.notInclude(output, "NODE_OPTIONS=--require /tmp/evil.js")
		}))

	// A NUL byte is the one value a spawn rejects outright, and the runtime
	// quotes the offending VALUE back in the error it throws. That error
	// becomes a durable ProviderSessionFailed detail, so the entry has to be
	// dropped before it ever reaches the spawn.
	it.effect("drops a value that would make the spawn print it in an error", () =>
		Effect.gen(function*() {
			const output = yield* readChildEnv({
				ACEPE_ENV_PROBE_NUL: `${SECRET}\u0000`,
				ACEPE_ENV_PROBE: "probe-value"
			})
			Vitest.assert.include(output, "ACEPE_ENV_PROBE=probe-value")
			Vitest.assert.notInclude(output, SECRET)
		}))
})
