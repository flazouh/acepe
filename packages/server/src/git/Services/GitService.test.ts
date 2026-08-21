import * as Vitest from "@effect/vitest"
import { GitService } from "./GitService.ts"

Vitest.describe("GitService", () => {
	Vitest.it("is a service class", () => {
		Vitest.assert.strictEqual(GitService.key, "@acepe/server/git/Services/GitService")
	})
})
