import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import { McpCatalog } from "../Services/McpCatalog.ts"
import { McpCatalogLive } from "./McpCatalog.ts"

const PlatformLive = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const withCatalog = <A, E, R>(
	homeDir: string,
	program: Effect.Effect<A, E, R | McpCatalog>
) =>
	program.pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(McpCatalogLive({ homeDir }))
	)

Vitest.layer(PlatformLive)("McpCatalogLive", (it) => {
	it.effect("resolves and validates servers from preconnection config files", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const project = yield* fs.makeTempDirectoryScoped()
			const home = yield* fs.makeTempDirectoryScoped()
			yield* fs.makeDirectory(path.join(project, ".cursor"), { recursive: true })
			yield* fs.makeDirectory(path.join(home, ".cursor"), { recursive: true })
			yield* fs.writeFileString(
				path.join(project, ".cursor", "mcp.json"),
				'{"mcpServers":{"github":{"command":"npx"}}}'
			)
			yield* fs.writeFileString(
				path.join(home, ".cursor", "mcp.json"),
				'{"mcp_servers":{"linear":{"url":"https://example.com"}}}'
			)
			yield* withCatalog(
				home,
				Effect.gen(function*() {
					const catalog = yield* McpCatalog
					const resolved = yield* catalog.resolve({
						projectRoot: project,
						availableCommands: [],
						liveServerStatuses: []
					})
					Vitest.assert.strictEqual(resolved.source, "preconnectionConfig")
					Vitest.assert.deepStrictEqual(
						Arr.map(resolved.servers, (server) => server.name),
						["github", "linear"]
					)
					Vitest.assert.strictEqual(resolved.servers[0]?.status, "unknown")
				})
			)
		})
	)

	it.effect("marks mixed source when live session tools join config names", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const project = yield* fs.makeTempDirectoryScoped()
			const home = yield* fs.makeTempDirectoryScoped()
			yield* fs.makeDirectory(path.join(project, ".cursor"), { recursive: true })
			yield* fs.writeFileString(
				path.join(project, ".cursor", "mcp.json"),
				'{"mcpServers":{"github":{"command":"npx"}}}'
			)
			yield* withCatalog(
				home,
				Effect.gen(function*() {
					const catalog = yield* McpCatalog
					const resolved = yield* catalog.resolve({
						projectRoot: project,
						availableCommands: [],
						liveServerStatuses: [
							{
								name: "github",
								status: "connected",
								error: null,
								tools: [
									{
										name: "search_issues",
										description: "Search issues"
									}
								]
							}
						]
					})
					Vitest.assert.strictEqual(resolved.source, "mixed")
					Vitest.assert.strictEqual(
						resolved.servers[0]?.tools[0]?.insertText,
						"@[command:/mcp:github/search_issues]"
					)
				})
			)
		})
	)
})
