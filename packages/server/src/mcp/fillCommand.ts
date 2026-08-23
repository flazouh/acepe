import {
	ComposerMcpCatalog,
	type OrchestrationCommand
} from "@acepe/contracts"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { OrchestrationCommandInvariantError } from "../orchestration/Errors.ts"
import { claudePreconnectionConfigOptions } from "../provider/Layers/ClaudeProvider.ts"
import { McpCatalog } from "./Services/McpCatalog.ts"

const decodeCatalog = Schema.decodeUnknownEffect(ComposerMcpCatalog)

const asMcpInvariant = (commandType: string) => (error: { readonly message: string }) =>
	new OrchestrationCommandInvariantError({
		commandType,
		detail: error.message
	})

const fillCatalogResolve = Effect.fn("fillMcpCatalogResolve")(function*(
	command: Extract<OrchestrationCommand, { readonly type: "mcp.catalog.resolve" }>
) {
	const mcp = yield* McpCatalog
	const resolved = yield* mcp
		.resolve({
			projectRoot: command.projectRoot,
			availableCommands: [],
			liveServerStatuses: []
		})
		.pipe(Effect.flatMap(decodeCatalog), Effect.mapError(asMcpInvariant(command.type)))
	return {
		type: command.type,
		commandId: command.commandId,
		projectId: command.projectId,
		projectRoot: command.projectRoot,
		catalog: resolved
	} satisfies OrchestrationCommand
})

const fillOptionsLoad = (
	command: Extract<OrchestrationCommand, { readonly type: "preconnection.options.load" }>
): OrchestrationCommand => {
	const options =
		command.providerId === "claude-code" ? claudePreconnectionConfigOptions() : []
	return {
		type: command.type,
		commandId: command.commandId,
		projectId: command.projectId,
		providerId: command.providerId,
		options
	}
}

export const fillMcpCommand = Effect.fn("fillMcpCommand")(function*(
	command: OrchestrationCommand
) {
	switch (command.type) {
		case "mcp.catalog.resolve":
			return yield* fillCatalogResolve(command)
		case "preconnection.options.load":
			return fillOptionsLoad(command)
		default:
			return command
	}
})
