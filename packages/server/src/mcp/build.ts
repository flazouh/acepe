import * as Arr from "effect/Array"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Str from "effect/String"
import type {
	AvailableCommand,
	ComposerMcpCatalog,
	ComposerMcpCatalogSource,
	ComposerMcpConnectionStatus,
	ComposerMcpServer,
	ComposerMcpTool,
	McpConnectionStatus,
	McpServerStatus,
	McpToolInfo
} from "./Schemas.ts"
import { parseMcpSlashServerName } from "./slash.ts"

export type BuildComposerMcpCatalogInput = {
	readonly configuredServerNames: ReadonlyArray<string>
	readonly availableCommands: ReadonlyArray<AvailableCommand>
	readonly liveServerStatuses: ReadonlyArray<McpServerStatus>
	readonly hadConfigServers: boolean
	readonly hadLiveStatuses: boolean
	readonly hadSessionCommands: boolean
}

export const emptyComposerMcpCatalog = (): ComposerMcpCatalog => ({
	source: "preconnectionConfig",
	servers: Arr.empty()
})

const resolveCatalogSource = (
	hadConfig: boolean,
	hadLive: boolean,
	hadSessionCommands: boolean
): ComposerMcpCatalogSource => {
	if (hadLive || hadSessionCommands) {
		if (hadConfig) {
			return "mixed"
		}
		return "liveSession"
	}
	return "preconnectionConfig"
}

const mapConnectionStatus = (status: McpConnectionStatus): ComposerMcpConnectionStatus => {
	if (status === "connected") {
		return "connected"
	}
	if (status === "failed") {
		return "failed"
	}
	if (status === "needs-auth") {
		return "needs-auth"
	}
	if (status === "pending") {
		return "pending"
	}
	return "disabled"
}

const mapTool = (serverName: string, tool: McpToolInfo): ComposerMcpTool => ({
	id: `${serverName}::${tool.name}`,
	name: tool.name,
	description: tool.description,
	insertText: `@[command:/mcp:${serverName}/${tool.name}]`
})

const groupMcpSlashCommands = (
	commands: ReadonlyArray<AvailableCommand>
): HashMap.HashMap<string, ReadonlyArray<AvailableCommand>> =>
	Arr.reduce(commands, HashMap.empty<string, ReadonlyArray<AvailableCommand>>(), (grouped, command) =>
		Option.match(parseMcpSlashServerName(command.name), {
			onNone: () => grouped,
			onSome: (serverName) => {
				const existing = HashMap.get(grouped, serverName)
				const next = Option.match(existing, {
					onNone: () => Arr.of(command),
					onSome: (list) => Arr.append(list, command)
				})
				return HashMap.set(grouped, serverName, next)
			}
		})
	)

export const buildComposerMcpCatalog = (
	input: BuildComposerMcpCatalogInput
): ComposerMcpCatalog => {
	const fromCommands = Arr.getSomes(
		Arr.map(input.availableCommands, (command) => parseMcpSlashServerName(command.name))
	)
	const fromLive = Arr.map(input.liveServerStatuses, (status) => status.name)
	const combined = Arr.appendAll(
		Arr.appendAll(input.configuredServerNames, fromCommands),
		fromLive
	)
	const serverNames = Arr.dedupeAdjacent(Arr.sort(combined, Str.Order))
	if (serverNames.length === 0) {
		return emptyComposerMcpCatalog()
	}
	const liveByName = Arr.reduce(
		input.liveServerStatuses,
		HashMap.empty<string, McpServerStatus>(),
		(map, status) => HashMap.set(map, status.name, status)
	)
	const slashByServer = groupMcpSlashCommands(input.availableCommands)
	const servers: ReadonlyArray<ComposerMcpServer> = Arr.map(serverNames, (serverName) => {
		const liveStatus = HashMap.get(liveByName, serverName)
		const slashCommands = Option.getOrElse(HashMap.get(slashByServer, serverName), () =>
			Arr.empty<AvailableCommand>()
		)
		const tools = Option.match(liveStatus, {
			onNone: () => Arr.empty<ComposerMcpTool>(),
			onSome: (status) =>
				status.tools === null
					? Arr.empty<ComposerMcpTool>()
					: Arr.map(status.tools, (tool) => mapTool(serverName, tool))
		})
		const mappedStatus = Option.match(liveStatus, {
			onNone: (): ComposerMcpConnectionStatus => "unknown",
			onSome: (status) => mapConnectionStatus(status.status)
		})
		const error = Option.match(liveStatus, {
			onNone: () => null,
			onSome: (status) => status.error
		})
		return {
			id: serverName,
			name: serverName,
			status: mappedStatus,
			error,
			tools,
			slashCommands
		}
	})
	return {
		source: resolveCatalogSource(
			input.hadConfigServers,
			input.hadLiveStatuses,
			input.hadSessionCommands
		),
		servers
	}
}
