import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunHttpClient from "@effect/platform-bun/BunHttpClient"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import { makeLiveClaudeAdapter } from "./Claude/Adapter.ts"
import { makeLiveCodexAdapter } from "./Codex/Adapter.ts"
import { makeLiveCopilotAdapter } from "./Copilot/Adapter.ts"
import { makeLiveCursorAdapter } from "./Cursor/Adapter.ts"
import { makeLiveOpenCodeAdapter } from "./OpenCode/Adapter.ts"

// Presence is a live answer, not a boot-time snapshot.
//
// Every live adapter used to compute installed/authenticated once while its
// layer was being built and hand back that value forever. A managed install
// wrote the binary and the adapter still said "not installed"; a login wrote
// a credential store and the adapter still said "not authenticated". Both had
// to be worked around per provider, because the probe was duplicated per
// provider.
//
// Each test below builds the real live adapter, reads presence, changes the
// thing on disk that decides the answer, and reads presence again from the
// SAME adapter. No layer is rebuilt between the two reads, which is what
// "without an app restart" means in the product.

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

Vitest.layer(Platform)("live adapter presence", (it) => {
	it.effect("Claude reports an install and a login that happen after construction", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = yield* fs.makeTempDirectoryScoped()
			const bin = path.join(root, "bin")
			const home = path.join(root, "home")
			yield* fs.makeDirectory(bin, { recursive: true })
			yield* fs.makeDirectory(home, { recursive: true })
			const env = envLayer({ PATH: bin, HOME: home })

			const adapter = yield* makeLiveClaudeAdapter().pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(env)
			)
			const read = adapter.presence.pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(env)
			)

			const before = yield* read
			Vitest.assert.strictEqual(before.installed, false)
			Vitest.assert.strictEqual(before.authenticated, false)

			yield* fs.writeFileString(path.join(bin, "claude"), "stub")
			const installed = yield* read
			Vitest.assert.strictEqual(installed.installed, true)
			Vitest.assert.strictEqual(installed.authenticated, false)

			yield* fs.makeDirectory(path.join(home, ".claude"), { recursive: true })
			yield* fs.writeFileString(path.join(home, ".claude", ".credentials.json"), "{}")
			const signedIn = yield* read
			Vitest.assert.strictEqual(signedIn.installed, true)
			Vitest.assert.strictEqual(signedIn.authenticated, true)
		})
	)

	it.effect("Codex reports a managed install that lands after construction", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = yield* fs.makeTempDirectoryScoped()
			const cacheDir = path.join(root, "agents")
			const home = path.join(root, "home")
			const agentDir = path.join(cacheDir, "codex")
			yield* fs.makeDirectory(cacheDir, { recursive: true })
			yield* fs.makeDirectory(home, { recursive: true })
			const env = envLayer({ PATH: path.join(root, "bin"), HOME: home })

			const adapter = yield* makeLiveCodexAdapter({
				cacheDir: Option.some(cacheDir),
				command: Option.none(),
				args: Option.none(),
				config: Option.none()
			}).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(env)
			)
			const read = adapter.presence.pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(env)
			)

			const before = yield* read
			Vitest.assert.strictEqual(before.installed, false)
			Vitest.assert.strictEqual(before.authenticated, false)

			// What AgentInstaller leaves behind: the binary and the meta.json
			// that names it.
			yield* fs.makeDirectory(agentDir, { recursive: true })
			yield* fs.writeFileString(path.join(agentDir, "codex"), "stub")
			yield* fs.writeFileString(path.join(agentDir, "meta.json"), '{"cmd":"./codex"}')
			const installed = yield* read
			Vitest.assert.strictEqual(installed.installed, true)
			Vitest.assert.strictEqual(installed.authenticated, false)

			// What `codex login` leaves behind.
			yield* fs.makeDirectory(path.join(home, ".codex"), { recursive: true })
			yield* fs.writeFileString(path.join(home, ".codex", "auth.json"), "{}")
			const signedIn = yield* read
			Vitest.assert.strictEqual(signedIn.installed, true)
			Vitest.assert.strictEqual(signedIn.authenticated, true)
		})
	)

	it.effect("Copilot reports an install and a login that happen after construction", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = yield* fs.makeTempDirectoryScoped()
			const bin = path.join(root, "bin")
			const home = path.join(root, "home")
			yield* fs.makeDirectory(bin, { recursive: true })
			yield* fs.makeDirectory(home, { recursive: true })
			const env = envLayer({ PATH: bin, HOME: home })

			const adapter = yield* makeLiveCopilotAdapter().pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(env)
			)
			const read = adapter.presence.pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(env)
			)

			Vitest.assert.strictEqual((yield* read).installed, false)
			yield* fs.writeFileString(path.join(bin, "copilot"), "stub")
			Vitest.assert.strictEqual((yield* read).installed, true)

			Vitest.assert.strictEqual((yield* read).authenticated, false)
			yield* fs.makeDirectory(path.join(home, ".copilot"), { recursive: true })
			yield* fs.writeFileString(path.join(home, ".copilot", "config.json"), "{}")
			Vitest.assert.strictEqual((yield* read).authenticated, true)
		})
	)

	it.effect("OpenCode reports an install and a login that happen after construction", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = yield* fs.makeTempDirectoryScoped()
			const bin = path.join(root, "bin")
			const home = path.join(root, "home")
			yield* fs.makeDirectory(bin, { recursive: true })
			yield* fs.makeDirectory(home, { recursive: true })
			const env = envLayer({ PATH: bin, HOME: home })

			const adapter = yield* makeLiveOpenCodeAdapter().pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(env)
			)
			const read = adapter.presence.pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(env)
			)

			Vitest.assert.strictEqual((yield* read).installed, false)
			yield* fs.writeFileString(path.join(bin, "opencode"), "stub")
			Vitest.assert.strictEqual((yield* read).installed, true)

			Vitest.assert.strictEqual((yield* read).authenticated, false)
			const authDir = path.join(home, ".local", "share", "opencode")
			yield* fs.makeDirectory(authDir, { recursive: true })
			yield* fs.writeFileString(path.join(authDir, "auth.json"), "{}")
			Vitest.assert.strictEqual((yield* read).authenticated, true)
		})
	)

	it.effect("Cursor reports an install that happens after construction", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = yield* fs.makeTempDirectoryScoped()
			const bin = path.join(root, "bin")
			yield* fs.makeDirectory(bin, { recursive: true })
			const env = envLayer({ PATH: bin, HOME: root })

			const adapter = yield* makeLiveCursorAdapter().pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(env)
			)
			const read = adapter.presence.pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(env)
			)

			Vitest.assert.strictEqual((yield* read).installed, false)
			yield* fs.writeFileString(path.join(bin, "cursor-agent"), "stub")
			Vitest.assert.strictEqual((yield* read).installed, true)
		})
	)
})
