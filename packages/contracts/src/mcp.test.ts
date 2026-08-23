import { describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { ProjectId } from "./ids.ts"
import {
	ComposerMcpCatalog,
	ComposerMcpServer,
	emptyComposerMcpCatalog,
	emptyProjectedMcpCatalog,
	ProjectedMcpCatalog,
} from "./mcp.ts"

const decodeServer = Schema.decodeUnknownEffect(ComposerMcpServer)
const decodeCatalog = Schema.decodeUnknownEffect(ComposerMcpCatalog)
const decodeProjected = Schema.decodeUnknownEffect(ProjectedMcpCatalog)

const projectId = ProjectId.make("project-1")

describe("ComposerMcpServer", () => {
	it("decodes a catalog server row", () => {
		const server = Effect.runSync(
			decodeServer({
				id: "github",
				name: "github",
				status: "unknown",
				error: null,
				tools: [],
				slashCommands: [],
			}),
		)
		expect(server.id).toBe("github")
		expect(server.status).toBe("unknown")
	})
})

describe("ComposerMcpCatalog", () => {
	it("decodes an empty preconnection catalog", () => {
		const catalog = Effect.runSync(decodeCatalog(emptyComposerMcpCatalog))
		expect(catalog.source).toBe("preconnectionConfig")
		expect(catalog.servers).toEqual([])
	})

	it("decodes a resolved github server", () => {
		const catalog = Effect.runSync(
			decodeCatalog({
				source: "preconnectionConfig",
				servers: [
					{
						id: "github",
						name: "github",
						status: "unknown",
						error: null,
						tools: [],
						slashCommands: [],
					},
				],
			}),
		)
		expect(catalog.servers[0]?.id).toBe("github")
	})
})

describe("ProjectedMcpCatalog", () => {
	it("adds projection sequence and project id", () => {
		const projected = Effect.runSync(
			decodeProjected({
				sequence: 4,
				projectId,
				catalog: emptyComposerMcpCatalog,
			}),
		)
		expect(projected.sequence).toBe(4)
		expect(projected.projectId).toBe(projectId)
	})

	it("builds an empty projected catalog", () => {
		const projected = emptyProjectedMcpCatalog(projectId, 0)
		expect(projected.catalog.servers).toEqual([])
	})
})
