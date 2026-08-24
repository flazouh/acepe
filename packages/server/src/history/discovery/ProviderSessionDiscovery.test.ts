import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import { pathToSlug } from "./Roots.ts"
import { ProviderSessionDiscovery, ProviderSessionDiscoveryLive } from "./ProviderSessionDiscovery.ts"

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const claudeLine = (fields: Record<string, unknown>): string => JSON.stringify(fields)

const writeSession = Effect.fn("writeSession")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	projectDir: string,
	fileName: string,
	title: string,
	sessionId: string
) {
	yield* fs.makeDirectory(projectDir, { recursive: true })
	yield* fs.writeFileString(
		path.join(projectDir, fileName),
		claudeLine({ type: "user", sessionId, message: { role: "user", content: title } })
	)
})

const discoveryLayerFor = (homeDir: string) =>
	ProviderSessionDiscoveryLive.pipe(
		Layer.provide(Platform),
		Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { HOME: homeDir } })))
	)

Vitest.layer(Platform)("ProviderSessionDiscovery", (it) => {
	it.effect("lists sessions for a project and caches until the directory changes", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const homeDir = yield* fs.makeTempDirectoryScoped()
			const projectPath = "/Users/example/acme"
			const projectDir = path.join(homeDir, ".claude", "projects", pathToSlug(projectPath))
			yield* writeSession(fs, path, projectDir, "s1.jsonl", "First title", "s1")

			const discovery = yield* ProviderSessionDiscovery.pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(discoveryLayerFor(homeDir))
			)
			const first = yield* discovery.listSessionsForProject(projectPath)
			Vitest.assert.strictEqual(first.length, 1)
			Vitest.assert.strictEqual(first[0]?.title, "First title")

			// Calling again with nothing changed on disk must hit the cache: the
			// exact same array instance comes back rather than a fresh scan.
			const cached = yield* discovery.listSessionsForProject(projectPath)
			Vitest.assert.strictEqual(cached, first)

			// A real content change (new mtime) must invalidate the cache.
			yield* fs.writeFileString(
				path.join(projectDir, "s1.jsonl"),
				claudeLine({ type: "user", sessionId: "s1", message: { role: "user", content: "Changed title" } })
			)
			const afterEdit = yield* discovery.listSessionsForProject(projectPath)
			Vitest.assert.strictEqual(afterEdit[0]?.title, "Changed title")
			Vitest.assert.notStrictEqual(afterEdit, first)

			yield* writeSession(fs, path, projectDir, "s2.jsonl", "Second session", "s2")
			const third = yield* discovery.listSessionsForProject(projectPath)
			Vitest.assert.strictEqual(third.length, 2)
		}))

	it.effect("lists all discovered projects and caches until the root changes", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const homeDir = yield* fs.makeTempDirectoryScoped()
			const projectOne = "/Users/example/one"
			const projectsRoot = path.join(homeDir, ".claude", "projects")
			yield* writeSession(fs, path, path.join(projectsRoot, pathToSlug(projectOne)), "s1.jsonl", "hi", "s1")

			const discovery = yield* ProviderSessionDiscovery.pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(discoveryLayerFor(homeDir))
			)
			const first = yield* discovery.listProjects()
			Vitest.assert.strictEqual(first.length, 1)
			const cached = yield* discovery.listProjects()
			Vitest.assert.strictEqual(cached, first)

			const projectTwo = "/Users/example/two"
			yield* writeSession(fs, path, path.join(projectsRoot, pathToSlug(projectTwo)), "s2.jsonl", "hi", "s2")
			const second = yield* discovery.listProjects()
			Vitest.assert.strictEqual(second.length, 2)
		}))

	it.effect("returns an empty list when the Claude home directory does not exist yet", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const homeDir = yield* fs.makeTempDirectoryScoped()
			const discovery = yield* ProviderSessionDiscovery.pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(discoveryLayerFor(homeDir))
			)
			const projects = yield* discovery.listProjects()
			Vitest.assert.deepStrictEqual(projects, [])
			const sessions = yield* discovery.listSessionsForProject("/Users/example/never-seen")
			Vitest.assert.deepStrictEqual(sessions, [])
		}))
})
