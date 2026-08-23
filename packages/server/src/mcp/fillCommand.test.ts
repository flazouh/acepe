import {
	CommandId,
	emptyComposerMcpCatalog,
	McpCatalogResolveCommand,
	PreconnectionOptionsLoadCommand,
	ProjectCreateCommand,
	ProjectId
} from "@acepe/contracts"
import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import { fillMcpCommand } from "./fillCommand.ts"
import { McpCatalogLive } from "./Layers/McpCatalog.ts"

const PlatformLive = Layer.mergeAll(
	BunCrypto.layer,
	BunFileSystem.layer,
	BunPath.layer,
	BunChildProcessSpawner.layer.pipe(
		Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))
	)
)

const commandId = CommandId.make("cmd-mcp")
const projectId = ProjectId.make("project-1")

const FillLive = (homeDir: string) =>
	McpCatalogLive({ homeDir }).pipe(Layer.provideMerge(PlatformLive))

Vitest.layer(PlatformLive)("fillMcpCommand", (it) => {
	it.effect("leaves non-mcp commands unchanged", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const homeDir = yield* fs.makeTempDirectoryScoped()
			const command = ProjectCreateCommand.make({
				type: "project.create",
				commandId,
				projectId,
				title: "Acepe",
				workspaceRoot: "/tmp/acepe"
			})
			const filled = yield* fillMcpCommand(command).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(FillLive(homeDir))
			)
			Vitest.assert.strictEqual(filled.type, "project.create")
		})
	)

	it.effect("fills mcp.catalog.resolve from project mcp.json", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const homeDir = yield* fs.makeTempDirectoryScoped()
			const projectRoot = yield* fs.makeTempDirectoryScoped()
			yield* fs.makeDirectory(path.join(projectRoot, ".cursor"), { recursive: true })
			yield* fs.writeFileString(
				path.join(projectRoot, ".cursor", "mcp.json"),
				'{"mcpServers":{"github":{"command":"npx"}}}'
			)
			const filled = yield* fillMcpCommand(
				McpCatalogResolveCommand.make({
					type: "mcp.catalog.resolve",
					commandId,
					projectId,
					projectRoot,
					catalog: emptyComposerMcpCatalog
				})
			).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(FillLive(homeDir))
			)
			Vitest.assert.strictEqual(filled.type, "mcp.catalog.resolve")
			if (filled.type === "mcp.catalog.resolve") {
				Vitest.assert.strictEqual(filled.catalog.source, "preconnectionConfig")
				Vitest.assert.strictEqual(filled.catalog.servers[0]?.id, "github")
				Vitest.assert.strictEqual(filled.catalog.servers[0]?.status, "unknown")
			}
		})
	)

	it.effect("fills claude-code preconnection options with reasoning_effort", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const homeDir = yield* fs.makeTempDirectoryScoped()
			const filled = yield* fillMcpCommand(
				PreconnectionOptionsLoadCommand.make({
					type: "preconnection.options.load",
					commandId,
					projectId,
					providerId: "claude-code",
					options: []
				})
			).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(FillLive(homeDir))
			)
			Vitest.assert.strictEqual(filled.type, "preconnection.options.load")
			if (filled.type === "preconnection.options.load") {
				Vitest.assert.strictEqual(filled.options[0]?.id, "reasoning_effort")
				Vitest.assert.strictEqual(filled.options[0]?.presentation, "compactReasoning")
			}
		})
	)

	it.effect("fills other providers with no preconnection options", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const homeDir = yield* fs.makeTempDirectoryScoped()
			const filled = yield* fillMcpCommand(
				PreconnectionOptionsLoadCommand.make({
					type: "preconnection.options.load",
					commandId,
					projectId,
					providerId: "cursor",
					options: []
				})
			).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(FillLive(homeDir))
			)
			Vitest.assert.strictEqual(filled.type, "preconnection.options.load")
			if (filled.type === "preconnection.options.load") {
				Vitest.assert.strictEqual(filled.options.length, 0)
			}
		})
	)
})
