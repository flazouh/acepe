import * as Vitest from "@effect/vitest"
import { SkillsService } from "./SkillsService.ts"

Vitest.describe("SkillsService", () => {
	Vitest.it("is keyed as the skills service", () => {
		Vitest.assert.strictEqual(
			SkillsService.key,
			"@acepe/server/skills/Services/SkillsService"
		)
	})
})
