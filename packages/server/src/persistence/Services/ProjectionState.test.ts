import * as Vitest from "@effect/vitest"
import { ProjectionState } from "./ProjectionState.ts"

Vitest.describe("ProjectionState", () => {
	Vitest.it("is a service class", () => {
		Vitest.assert.strictEqual(
			ProjectionState.key,
			"@acepe/server/persistence/Services/ProjectionState"
		)
	})
})
