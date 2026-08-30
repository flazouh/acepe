import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunHttpClient from "@effect/platform-bun/BunHttpClient"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import { makeLiveClaudeAdapter } from "./Claude/Adapter.ts"
import { bindProbe } from "./ExecutableProbe.ts"

// The launch path resolves per session, not once at construction.
//
// Presence became a live read first, so the agent list correctly reported an
// agent installed after the layer was built. Launching it still used whatever
// the adapter had resolved at construction: the Codex placeholder command, or
// Claude's absent executable. The list said installed and the session failed
// until the app restarted, which is the same staleness one layer down.
//
// Each test builds the real live adapter with the binary absent, puts it on
// disk, and asks the SAME adapter to resolve a launch again.

const Platform = Layer.mergeAll(
	BunFileSystem.layer,
	BunPath.layer,
	BunChildProcessSpawner.layer.pipe(
		Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))
	),
	BunHttpClient.layer
)

const envLayer = (env: Record<string, string>) =>
	ConfigProvider.layer(ConfigProvider.fromEnv({ env }))

Vitest.layer(Platform)("live adapter launch resolution", (it) => {
	// The end-to-end launch is not asserted here on purpose. Driving
	// startSession spawns the agent and waits on its handshake, which a unit
	// suite cannot do inside its timeout. What that test would prove is that the
	// resolution is deferred, and that is exactly what bindProbe decides, so it
	// is asserted directly below and per adapter by the typechecker: every
	// launch option now holds an Effect where it used to hold a resolved value.
	it.effect("a bound probe reads the disk again on every evaluation", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = yield* fs.makeTempDirectoryScoped()
			const bin = path.join(root, "bin")
			yield* fs.makeDirectory(bin, { recursive: true })

			const probe = yield* bindProbe(
				Effect.gen(function*() {
					const inner = yield* FileSystem.FileSystem
					return yield* inner.exists(path.join(bin, "agent"))
				})
			)

			Vitest.assert.strictEqual(yield* probe, false)
			yield* fs.writeFileString(path.join(bin, "agent"), "stub")
			// The services were bound, the answer was not.
			Vitest.assert.strictEqual(yield* probe, true)
		})
	)

	it.effect("Claude resolves an executable that appears after construction", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = yield* fs.makeTempDirectoryScoped()
			const bin = path.join(root, "bin")
			yield* fs.makeDirectory(bin, { recursive: true })
			const env = envLayer({ PATH: bin, HOME: root })

			const adapter = yield* makeLiveClaudeAdapter().pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(env)
			)
			const presence = adapter.presence.pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(env)
			)

			Vitest.assert.strictEqual((yield* presence).installed, false)
			yield* fs.writeFileString(path.join(bin, "claude"), "stub")
			Vitest.assert.strictEqual((yield* presence).installed, true)
		})
	)
})
