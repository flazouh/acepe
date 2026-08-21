import * as Vitest from "@effect/vitest"
import { ClaudeHistory } from "./ClaudeHistory.ts"

Vitest.describe("ClaudeHistory", () => {
	Vitest.it("is keyed as the Claude history importer service", () => {
		Vitest.assert.strictEqual(ClaudeHistory.key, "@acepe/server/history/Services/ClaudeHistory")
	})
})
