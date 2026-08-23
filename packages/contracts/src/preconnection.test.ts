import { describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { ProjectId } from "./ids.ts"
import {
	ConfigOptionData,
	emptyProjectedPreconnectionOptions,
	ProjectedPreconnectionOptions,
} from "./preconnection.ts"

const decodeOption = Schema.decodeUnknownEffect(ConfigOptionData)
const decodeProjected = Schema.decodeUnknownEffect(ProjectedPreconnectionOptions)

const projectId = ProjectId.make("project-1")

describe("ConfigOptionData", () => {
	it("decodes compact reasoning preconnection options", () => {
		const option = Effect.runSync(
			decodeOption({
				id: "reasoning_effort",
				name: "Reasoning Effort",
				category: "reasoning_effort",
				type: "select",
				description: "Controls Claude reasoning depth.",
				currentValue: "auto",
				options: [
					{ name: "Auto", value: "auto" },
					{ name: "Low", value: "low" },
				],
				presentation: "compactReasoning",
			}),
		)
		expect(option.id).toBe("reasoning_effort")
		expect(option.presentation).toBe("compactReasoning")
		expect(option.currentValue).toBe("auto")
	})
})

describe("ProjectedPreconnectionOptions", () => {
	it("decodes a projected option list", () => {
		const projected = Effect.runSync(
			decodeProjected({
				sequence: 2,
				projectId,
				providerId: "claude-code",
				options: [],
			}),
		)
		expect(projected.providerId).toBe("claude-code")
		expect(projected.options).toEqual([])
	})

	it("builds an empty projected list", () => {
		const projected = emptyProjectedPreconnectionOptions(projectId, 0, "claude-code")
		expect(projected.options).toEqual([])
	})
})
