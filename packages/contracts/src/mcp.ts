import * as Schema from "effect/Schema"

import { Sequence, TrimmedNonEmptyString } from "./baseSchemas.ts"
import { ProjectId } from "./ids.ts"

export const ComposerMcpCatalogSource = Schema.Literals([
	"preconnectionConfig",
	"liveSession",
	"mixed",
])
export type ComposerMcpCatalogSource = typeof ComposerMcpCatalogSource.Type

export const ComposerMcpConnectionStatus = Schema.Literals([
	"connected",
	"failed",
	"needs-auth",
	"pending",
	"disabled",
	"unknown",
])
export type ComposerMcpConnectionStatus = typeof ComposerMcpConnectionStatus.Type

export const CommandInput = Schema.Struct({
	hint: Schema.String,
})
export type CommandInput = typeof CommandInput.Type

export const AvailableCommand = Schema.Struct({
	name: Schema.String,
	description: Schema.String,
	input: Schema.NullOr(CommandInput).pipe(Schema.optionalKey),
})
export type AvailableCommand = typeof AvailableCommand.Type

export const ComposerMcpTool = Schema.Struct({
	id: TrimmedNonEmptyString,
	name: TrimmedNonEmptyString,
	description: Schema.NullOr(Schema.String),
	insertText: TrimmedNonEmptyString,
})
export type ComposerMcpTool = typeof ComposerMcpTool.Type

export const ComposerMcpServer = Schema.Struct({
	id: TrimmedNonEmptyString,
	name: TrimmedNonEmptyString,
	status: ComposerMcpConnectionStatus,
	error: Schema.NullOr(Schema.String),
	tools: Schema.Array(ComposerMcpTool),
	slashCommands: Schema.Array(AvailableCommand),
})
export type ComposerMcpServer = typeof ComposerMcpServer.Type

export const ComposerMcpCatalog = Schema.Struct({
	source: ComposerMcpCatalogSource,
	servers: Schema.Array(ComposerMcpServer),
})
export type ComposerMcpCatalog = typeof ComposerMcpCatalog.Type

export const ProjectedMcpCatalog = Schema.Struct({
	sequence: Sequence,
	projectId: ProjectId,
	catalog: ComposerMcpCatalog,
})
export type ProjectedMcpCatalog = typeof ProjectedMcpCatalog.Type

export const emptyComposerMcpCatalog: ComposerMcpCatalog = {
	source: "preconnectionConfig",
	servers: [],
}

export const emptyProjectedMcpCatalog = (
	projectId: ProjectId,
	sequence: Sequence,
): ProjectedMcpCatalog => ({
	sequence,
	projectId,
	catalog: emptyComposerMcpCatalog,
})
