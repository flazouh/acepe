import * as Vitest from "@effect/vitest"
import * as Schema from "effect/Schema"
import {
	AvailableCommand,
	ComposerMcpCatalog,
	ComposerMcpServer,
	McpServerStatus
} from "./Schemas.ts"

const decodeCommand = Schema.decodeUnknownSync(AvailableCommand)
const decodeServer = Schema.decodeUnknownSync(ComposerMcpServer)
const decodeCatalog = Schema.decodeUnknownSync(ComposerMcpCatalog)
const decodeStatus = Schema.decodeUnknownSync(McpServerStatus)

Vitest.describe("AvailableCommand", () => {
	Vitest.it("decodes an mcp slash command", () => {
		const command = decodeCommand({
			name: "mcp:github",
			description: "GitHub MCP"
		})
		Vitest.assert.strictEqual(command.name, "mcp:github")
	})
})

Vitest.describe("ComposerMcpServer", () => {
	Vitest.it("decodes a catalog server row", () => {
		const server = decodeServer({
			id: "github",
			name: "github",
			status: "unknown",
			error: null,
			tools: [],
			slashCommands: []
		})
		Vitest.assert.strictEqual(server.status, "unknown")
	})
})

Vitest.describe("ComposerMcpCatalog", () => {
	Vitest.it("decodes an empty preconnection catalog", () => {
		const catalog = decodeCatalog({
			source: "preconnectionConfig",
			servers: []
		})
		Vitest.assert.strictEqual(catalog.source, "preconnectionConfig")
		Vitest.assert.strictEqual(catalog.servers.length, 0)
	})
})

Vitest.describe("McpServerStatus", () => {
	Vitest.it("decodes a live connected server", () => {
		const status = decodeStatus({
			name: "github",
			status: "connected",
			error: null,
			tools: [
				{
					name: "search_issues",
					description: "Search issues"
				}
			]
		})
		Vitest.assert.strictEqual(status.status, "connected")
	})
})
