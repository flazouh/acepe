import {
	type EventId,
	type IsoDateTime,
	type JsonObject,
	type McpCatalogResolveCommand,
	type McpCatalogResolvedEvent,
	type OrchestrationCommand,
	type OrchestrationEvent,
	type PreconnectionOptionsLoadCommand,
	type PreconnectionOptionsLoadedEvent,
	type Sequence
} from "@acepe/contracts"
import * as Effect from "effect/Effect"
import {
	requireProject,
	requireUniqueConfigOptionIds,
	requireUniqueMcpServerIds,
	type OrchestrationReadModel
} from "./commandInvariants.ts"
import type { OrchestrationCommandInvariantError } from "./Errors.ts"

type McpDecideIdentity = {
	readonly eventId: EventId
	readonly occurredAt: IsoDateTime
}

export type McpCommand = Extract<
	OrchestrationCommand,
	{
		readonly type: "mcp.catalog.resolve" | "preconnection.options.load"
	}
>

const EMPTY_METADATA: JsonObject = {}

const nextSequence = (snapshotSequence: Sequence): Sequence => snapshotSequence + 1

const mcpEvent = <Type extends string, Payload>(
	command: {
		readonly commandId: OrchestrationEvent["commandId"]
		readonly projectId: McpCommand["projectId"]
	},
	identity: McpDecideIdentity,
	sequence: Sequence,
	type: Type,
	payload: Payload
) => ({
	sequence,
	eventId: identity.eventId,
	aggregateKind: "mcp" as const,
	aggregateId: command.projectId,
	occurredAt: identity.occurredAt,
	commandId: command.commandId,
	causationEventId: null,
	correlationId: command.commandId,
	metadata: EMPTY_METADATA,
	type,
	payload
})

const mcpCatalogResolvedEvent = (
	command: McpCatalogResolveCommand,
	identity: McpDecideIdentity,
	sequence: Sequence
): McpCatalogResolvedEvent =>
	mcpEvent(command, identity, sequence, "McpCatalogResolved", {
		projectId: command.projectId,
		catalog: command.catalog
	})

const preconnectionOptionsLoadedEvent = (
	command: PreconnectionOptionsLoadCommand,
	identity: McpDecideIdentity,
	sequence: Sequence
): PreconnectionOptionsLoadedEvent =>
	mcpEvent(command, identity, sequence, "PreconnectionOptionsLoaded", {
		projectId: command.projectId,
		providerId: command.providerId,
		options: command.options
	})

export const decideMcp = Effect.fn("decideMcp")(function*(
	readModel: OrchestrationReadModel,
	command: McpCommand,
	identity: McpDecideIdentity
): Effect.fn.Return<ReadonlyArray<OrchestrationEvent>, OrchestrationCommandInvariantError> {
	yield* requireProject({
		readModel,
		projectId: command.projectId,
		command
	})
	const sequence = nextSequence(readModel.snapshotSequence)
	switch (command.type) {
		case "mcp.catalog.resolve":
			yield* requireUniqueMcpServerIds(command)
			return [mcpCatalogResolvedEvent(command, identity, sequence)]
		case "preconnection.options.load":
			yield* requireUniqueConfigOptionIds(command)
			return [preconnectionOptionsLoadedEvent(command, identity, sequence)]
	}
})
