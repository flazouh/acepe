import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import { parseCodexToml } from "./Config.ts"

Vitest.describe("CodexConfig", () => {
	Vitest.it("parses only the Codex config.toml keys rust reads", () => {
		const patch = parseCodexToml(
			'model = "gpt-5.4"\nmodel_reasoning_effort = "medium"\nservice_tier = "fast"\n# comment\nignored = "nope"\n'
		)
		Vitest.assert.deepStrictEqual(patch.currentModelId, Option.some("gpt-5.4"))
		Vitest.assert.deepStrictEqual(patch.reasoningEffort, Option.some("medium"))
		Vitest.assert.deepStrictEqual(patch.fastMode, Option.some(true))
	})
})
