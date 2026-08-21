import * as Vitest from "@effect/vitest"
import { OpenCodeHistory } from "./OpenCodeHistory.ts"

Vitest.describe("OpenCodeHistory", () => {
	Vitest.it("is keyed as the OpenCode history importer service", () => {
		Vitest.assert.strictEqual(
			OpenCodeHistory.key,
			"@acepe/server/history/Services/OpenCodeHistory"
		)
	})
})
