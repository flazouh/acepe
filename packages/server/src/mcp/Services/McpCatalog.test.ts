import * as Vitest from "@effect/vitest"
import { McpCatalog } from "./McpCatalog.ts"

Vitest.describe("McpCatalog", () => {
	Vitest.it("is keyed as the mcp catalog service", () => {
		Vitest.assert.strictEqual(McpCatalog.key, "@acepe/server/mcp/Services/McpCatalog")
	})
})
