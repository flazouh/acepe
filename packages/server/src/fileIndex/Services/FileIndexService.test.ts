import * as Vitest from "@effect/vitest"
import { FileIndexService } from "./FileIndexService.ts"

Vitest.describe("FileIndexService", () => {
	Vitest.it("is keyed as the file index service", () => {
		Vitest.assert.strictEqual(
			FileIndexService.key,
			"@acepe/server/fileIndex/Services/FileIndexService"
		)
	})
})
