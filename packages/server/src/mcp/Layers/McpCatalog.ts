import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import { buildComposerMcpCatalog } from "../build.ts"
import { loadConfiguredMcpServerNames } from "../config.ts"
import {
	decodeComposerMcpCatalog,
	decodeResolveMcpCatalogInput,
	type ResolveMcpCatalogInput
} from "../Schemas.ts"
import { McpCatalog } from "../Services/McpCatalog.ts"
import { isMcpSlashCommand } from "../slash.ts"

export type McpCatalogLiveOptions = {
	readonly homeDir: string
}

export const makeMcpCatalog = Effect.fn("McpCatalog.make")(function*(
	options: McpCatalogLiveOptions
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path

	const resolve = Effect.fn("McpCatalog.resolve")(function*(input: ResolveMcpCatalogInput) {
		const decoded = yield* decodeResolveMcpCatalogInput(input)
		const configuredServerNames = yield* loadConfiguredMcpServerNames(
			fs,
			path,
			decoded.projectRoot,
			options.homeDir
		)
		const hadConfigServers = configuredServerNames.length > 0
		const hadSessionCommands = decoded.availableCommands.length > 0
		const hadLiveStatuses = decoded.liveServerStatuses.length > 0
		const availableCommands = Arr.filter(decoded.availableCommands, (command) =>
			isMcpSlashCommand(command.name)
		)
		const catalog = buildComposerMcpCatalog({
			configuredServerNames,
			availableCommands,
			liveServerStatuses: decoded.liveServerStatuses,
			hadConfigServers,
			hadLiveStatuses,
			hadSessionCommands
		})
		return yield* decodeComposerMcpCatalog(catalog)
	})

	return McpCatalog.of({
		resolve
	})
})

export const McpCatalogLive = (options: McpCatalogLiveOptions) =>
	Layer.effect(McpCatalog, makeMcpCatalog(options))
