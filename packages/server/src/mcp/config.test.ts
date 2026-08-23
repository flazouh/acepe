import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import {
	loadConfiguredMcpServerNames,
	projectMcpConfigPaths,
	userMcpConfigPath
} from "./config.ts"

const PlatformLive = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

Vitest.layer(PlatformLive)("mcp config paths", (it) => {
	it.effect("includes project .cursor/mcp.json, project mcp.json, and user .cursor/mcp.json", () =>
		Effect.gen(function*() {
			const path = yield* Path.Path
			const project = "/tmp/project"
			const home = "/tmp/home"
			const projectPaths = projectMcpConfigPaths(path, project)
			Vitest.assert.strictEqual(projectPaths[0]?.endsWith("/.cursor/mcp.json"), true)
			Vitest.assert.strictEqual(projectPaths[1]?.endsWith("/mcp.json"), true)
			Vitest.assert.strictEqual(
				userMcpConfigPath(path, home).endsWith("/.cursor/mcp.json"),
				true
			)
		})
	)

	it.effect("reads cursor-style mcpServers from a project file", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const project = yield* fs.makeTempDirectoryScoped()
			const home = yield* fs.makeTempDirectoryScoped()
			yield* fs.makeDirectory(path.join(project, ".cursor"), { recursive: true })
			yield* fs.writeFileString(
				path.join(project, ".cursor", "mcp.json"),
				'{"mcpServers":{"github":{"command":"npx"},"linear":{"url":"https://example.com"}}}'
			)
			const names = yield* loadConfiguredMcpServerNames(fs, path, project, home)
			Vitest.assert.deepStrictEqual(names, ["github", "linear"])
		})
	)

	it.effect("skips invalid json and missing files", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const project = yield* fs.makeTempDirectoryScoped()
			const home = yield* fs.makeTempDirectoryScoped()
			yield* fs.writeFileString(path.join(project, "mcp.json"), "{not json")
			const names = yield* loadConfiguredMcpServerNames(fs, path, project, home)
			Vitest.assert.deepStrictEqual(names, [])
		})
	)

	it.effect("drops servers without command or url and keeps valid ones", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const project = yield* fs.makeTempDirectoryScoped()
			const home = yield* fs.makeTempDirectoryScoped()
			yield* fs.makeDirectory(path.join(project, ".cursor"), { recursive: true })
			yield* fs.writeFileString(
				path.join(project, ".cursor", "mcp.json"),
				'{"mcpServers":{"github":{"command":"npx"},"broken":{"args":[]},"remote":{"url":"https://example.com"}}}'
			)
			const names = yield* loadConfiguredMcpServerNames(fs, path, project, home)
			Vitest.assert.deepStrictEqual(names, ["github", "remote"])
		})
	)
})
