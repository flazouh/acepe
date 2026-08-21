import * as Vitest from "@effect/vitest"
import * as Schema from "effect/Schema"
import { ConfigOptionData } from "./configOptions.ts"

const decodeOption = Schema.decodeUnknownSync(ConfigOptionData)

Vitest.describe("ConfigOptionData", () => {
	Vitest.it("decodes the compact reasoning option", () => {
		const option = decodeOption({
			id: "reasoning_effort",
			name: "Reasoning Effort",
			category: "reasoning_effort",
			type: "select",
			description: "Controls Claude reasoning depth.",
			currentValue: "auto",
			options: [{ name: "Auto", value: "auto" }],
			presentation: "compactReasoning"
		})
		Vitest.assert.strictEqual(option.presentation, "compactReasoning")
		Vitest.assert.strictEqual(option.currentValue, "auto")
	})
})
