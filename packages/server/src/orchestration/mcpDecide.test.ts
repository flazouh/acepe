import {
	CommandId,
	emptyComposerMcpCatalog,
	EventId,
	McpCatalogResolveCommand,
	PreconnectionOptionsLoadCommand,
	ProjectId,
	type ComposerMcpServer,
	type ConfigOptionData
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import type { OrchestrationReadModel } from "./commandInvariants.ts"
import { decideMcp } from "./mcpDecide.ts"

const occurredAt = "2026-08-20T12:00:00.000Z"
const commandId = CommandId.make("cmd-mcp")
const eventId = EventId.make("event-mcp")
const projectId = ProjectId.make("project-1")
const identity = {
	eventId,
	occurredAt
}

const emptyReadModel: OrchestrationReadModel = {
	snapshotSequence: 0,
	projects: [],
	sessions: []
}

const withProject: OrchestrationReadModel = {
	snapshotSequence: 3,
	projects: [
		{
			id: projectId
		}
	],
	sessions: []
}

const githubServer: ComposerMcpServer = {
	id: "github",
	name: "github",
	status: "unknown",
	error: null,
	tools: [],
	slashCommands: []
}

const reasoningOption: ConfigOptionData = {
	id: "reasoning_effort",
	name: "Reasoning Effort",
	category: "reasoning_effort",
	type: "select",
	currentValue: "auto",
	presentation: "compactReasoning"
}

Vitest.describe("decideMcp", () => {
	Vitest.it.effect("rejects mcp commands when the project is missing", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decideMcp(
					emptyReadModel,
					McpCatalogResolveCommand.make({
						type: "mcp.catalog.resolve",
						commandId,
						projectId,
						projectRoot: "/tmp/acepe",
						catalog: emptyComposerMcpCatalog
					}),
					identity
				)
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(error.commandType, "mcp.catalog.resolve")
		})
	)

	Vitest.it.effect("emits McpCatalogResolved for mcp.catalog.resolve", () =>
		Effect.gen(function*() {
			const events = yield* decideMcp(
				withProject,
				McpCatalogResolveCommand.make({
					type: "mcp.catalog.resolve",
					commandId,
					projectId,
					projectRoot: "/tmp/acepe",
					catalog: {
						source: "preconnectionConfig",
						servers: [githubServer]
					}
				}),
				identity
			)
			Vitest.assert.strictEqual(events[0]?.type, "McpCatalogResolved")
			Vitest.assert.strictEqual(events[0]?.aggregateKind, "mcp")
			Vitest.assert.strictEqual(events[0]?.aggregateId, projectId)
			Vitest.assert.strictEqual(events[0]?.sequence, 4)
		})
	)

	Vitest.it.effect("emits PreconnectionOptionsLoaded for preconnection.options.load", () =>
		Effect.gen(function*() {
			const events = yield* decideMcp(
				withProject,
				PreconnectionOptionsLoadCommand.make({
					type: "preconnection.options.load",
					commandId,
					projectId,
					providerId: "claude-code",
					options: [reasoningOption]
				}),
				identity
			)
			Vitest.assert.strictEqual(events[0]?.type, "PreconnectionOptionsLoaded")
			Vitest.assert.strictEqual(events[0]?.aggregateKind, "mcp")
			Vitest.assert.strictEqual(events[0]?.aggregateId, projectId)
			Vitest.assert.strictEqual(events[0]?.sequence, 4)
		})
	)

	Vitest.it.effect("rejects duplicate mcp server ids", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decideMcp(
					withProject,
					McpCatalogResolveCommand.make({
						type: "mcp.catalog.resolve",
						commandId,
						projectId,
						projectRoot: "/tmp/acepe",
						catalog: {
							source: "preconnectionConfig",
							servers: [githubServer, githubServer]
						}
					}),
					identity
				)
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(error.commandType, "mcp.catalog.resolve")
		})
	)

	Vitest.it.effect("rejects duplicate config option ids", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				decideMcp(
					withProject,
					PreconnectionOptionsLoadCommand.make({
						type: "preconnection.options.load",
						commandId,
						projectId,
						providerId: "claude-code",
						options: [reasoningOption, reasoningOption]
					}),
					identity
				)
			)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
			Vitest.assert.strictEqual(error.commandType, "preconnection.options.load")
		})
	)
})
