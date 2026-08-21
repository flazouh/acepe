import { TrimmedNonEmptyString } from "@acepe/contracts"
import * as Schema from "effect/Schema"

export const ComposerMcpCatalogSource = Schema.Literals([
	"preconnectionConfig",
	"liveSession",
	"mixed"
])
export type ComposerMcpCatalogSource = typeof ComposerMcpCatalogSource.Type

export const ComposerMcpConnectionStatus = Schema.Literals([
	"connected",
	"failed",
	"needs-auth",
	"pending",
	"disabled",
	"unknown"
])
export type ComposerMcpConnectionStatus = typeof ComposerMcpConnectionStatus.Type

export const CommandInput = Schema.Struct({
	hint: Schema.String
})
export type CommandInput = typeof CommandInput.Type

export const AvailableCommand = Schema.Struct({
	name: Schema.String,
	description: Schema.String,
	input: Schema.NullOr(CommandInput).pipe(Schema.optionalKey)
})
export type AvailableCommand = typeof AvailableCommand.Type

export const ComposerMcpTool = Schema.Struct({
	id: TrimmedNonEmptyString,
	name: TrimmedNonEmptyString,
	description: Schema.NullOr(Schema.String),
	insertText: TrimmedNonEmptyString
})
export type ComposerMcpTool = typeof ComposerMcpTool.Type

export const ComposerMcpServer = Schema.Struct({
	id: TrimmedNonEmptyString,
	name: TrimmedNonEmptyString,
	status: ComposerMcpConnectionStatus,
	error: Schema.NullOr(Schema.String),
	tools: Schema.Array(ComposerMcpTool),
	slashCommands: Schema.Array(AvailableCommand)
})
export type ComposerMcpServer = typeof ComposerMcpServer.Type

export const ComposerMcpCatalog = Schema.Struct({
	source: ComposerMcpCatalogSource,
	servers: Schema.Array(ComposerMcpServer)
})
export type ComposerMcpCatalog = typeof ComposerMcpCatalog.Type

export const McpConnectionStatus = Schema.Literals([
	"connected",
	"failed",
	"needs-auth",
	"pending",
	"disabled"
])
export type McpConnectionStatus = typeof McpConnectionStatus.Type

export const McpToolInfo = Schema.Struct({
	name: TrimmedNonEmptyString,
	description: Schema.NullOr(Schema.String)
})
export type McpToolInfo = typeof McpToolInfo.Type

export const McpServerStatus = Schema.Struct({
	name: TrimmedNonEmptyString,
	status: McpConnectionStatus,
	error: Schema.NullOr(Schema.String),
	tools: McpToolInfo.pipe(Schema.Array, Schema.NullOr)
})
export type McpServerStatus = typeof McpServerStatus.Type

export const ResolveMcpCatalogInput = Schema.Struct({
	projectRoot: TrimmedNonEmptyString,
	availableCommands: Schema.Array(AvailableCommand),
	liveServerStatuses: Schema.Array(McpServerStatus)
})
export type ResolveMcpCatalogInput = typeof ResolveMcpCatalogInput.Type

export const decodeComposerMcpCatalog = Schema.decodeUnknownEffect(ComposerMcpCatalog)
export const decodeResolveMcpCatalogInput = Schema.decodeUnknownEffect(ResolveMcpCatalogInput)
