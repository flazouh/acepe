import * as Vitest from "@effect/vitest"
import { CursorHistory } from "./CursorHistory.ts"

Vitest.describe("CursorHistory", () => {
	Vitest.it("is keyed as the Cursor history importer service", () => {
		Vitest.assert.strictEqual(CursorHistory.key, "@acepe/server/history/Services/CursorHistory")
	})
})
