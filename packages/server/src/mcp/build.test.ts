import * as Vitest from "@effect/vitest"
import { buildComposerMcpCatalog } from "./build.ts"

Vitest.describe("buildComposerMcpCatalog", () => {
	Vitest.it("groups mcp slash commands by server", () => {
		const catalog = buildComposerMcpCatalog({
			configuredServerNames: ["github"],
			availableCommands: [
				{
					name: "mcp:github",
					description: "GitHub MCP"
				},
				{
					name: "mcp:linear",
					description: "Linear MCP"
				}
			],
			liveServerStatuses: [],
			hadConfigServers: true,
			hadLiveStatuses: false,
			hadSessionCommands: true
		})
		Vitest.assert.strictEqual(catalog.servers.length, 2)
		Vitest.assert.strictEqual(catalog.servers[0]?.name, "github")
		Vitest.assert.strictEqual(catalog.servers[0]?.slashCommands.length, 1)
		Vitest.assert.strictEqual(catalog.servers[1]?.name, "linear")
		Vitest.assert.strictEqual(catalog.source, "mixed")
	})

	Vitest.it("maps live tools with insert text", () => {
		const catalog = buildComposerMcpCatalog({
			configuredServerNames: ["github"],
			availableCommands: [],
			liveServerStatuses: [
				{
					name: "github",
					status: "connected",
					error: null,
					tools: [
						{
							name: "search_issues",
							description: "Search issues"
						}
					]
				}
			],
			hadConfigServers: true,
			hadLiveStatuses: true,
			hadSessionCommands: false
		})
		Vitest.assert.strictEqual(catalog.source, "mixed")
		Vitest.assert.strictEqual(catalog.servers.length, 1)
		Vitest.assert.strictEqual(catalog.servers[0]?.status, "connected")
		Vitest.assert.strictEqual(catalog.servers[0]?.tools.length, 1)
		Vitest.assert.strictEqual(
			catalog.servers[0]?.tools[0]?.insertText,
			"@[command:/mcp:github/search_issues]"
		)
	})

	Vitest.it("uses preconnectionConfig when only on-disk names exist", () => {
		const catalog = buildComposerMcpCatalog({
			configuredServerNames: ["github"],
			availableCommands: [],
			liveServerStatuses: [],
			hadConfigServers: true,
			hadLiveStatuses: false,
			hadSessionCommands: false
		})
		Vitest.assert.strictEqual(catalog.source, "preconnectionConfig")
		Vitest.assert.strictEqual(catalog.servers[0]?.status, "unknown")
	})
})
