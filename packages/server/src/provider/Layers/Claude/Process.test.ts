import * as Vitest from "@effect/vitest"
import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk"
import { catalogFromModelInfos } from "./Process.ts"

// The exact catalog the claude CLI (2.1.237) answered supportedModels() with.
// The CLI names each alias with a bare family word ("Fable", "Sonnet") and
// puts its own versioned name for the model in the description's first
// " · " segment -- the same registry name its own picker shows ("Fable 5").
const CLI_MODELS: ModelInfo[] = [
	{
		value: "default",
		displayName: "Default (recommended)",
		description: "Opus 5 with 1M context · Best for everyday, complex tasks"
	},
	{
		value: "opus[1m]",
		displayName: "Opus (1M context)",
		description: "Opus 5 with 1M context · Best for everyday, complex tasks"
	},
	{
		value: "claude-fable-5[1m]",
		displayName: "Fable",
		description: "Fable 5 · Most capable for your hardest and longest-running tasks"
	},
	{
		value: "sonnet",
		displayName: "Sonnet",
		description: "Sonnet 5 · Efficient for routine tasks"
	},
	{
		value: "haiku",
		displayName: "Haiku",
		description: "Haiku 4.5 · Fastest for quick answers"
	}
]

Vitest.describe("catalogFromModelInfos", () => {
	Vitest.it("promotes the CLI's own versioned name over the bare family alias", () => {
		const catalog = catalogFromModelInfos(CLI_MODELS)

		Vitest.assert.deepStrictEqual(catalog.map((model) => model.name), [
			"Default (recommended)",
			"Opus 5 with 1M context",
			"Fable 5",
			"Sonnet 5",
			"Haiku 4.5"
		])
	})

	Vitest.it("keeps only the blurb as the description once the name absorbed the version", () => {
		const catalog = catalogFromModelInfos(CLI_MODELS)

		Vitest.assert.deepStrictEqual(catalog.map((model) => model.description), [
			// Default keeps the whole description: its name says nothing about
			// which model it resolves to, so the description must.
			"Opus 5 with 1M context · Best for everyday, complex tasks",
			"Best for everyday, complex tasks",
			"Most capable for your hardest and longest-running tasks",
			"Efficient for routine tasks",
			"Fastest for quick answers"
		])
	})

	Vitest.it("keeps the alias name when the description names a different family", () => {
		const catalog = catalogFromModelInfos([
			{
				value: "default",
				displayName: "Default (recommended)",
				description: "Opus 5 with 1M context · Best for everyday, complex tasks"
			}
		])

		Vitest.assert.strictEqual(catalog[0]?.name, "Default (recommended)")
	})

	Vitest.it("passes a descriptionless model through unchanged", () => {
		const catalog = catalogFromModelInfos([
			{ value: "haiku", displayName: "Haiku", description: "" }
		])

		Vitest.assert.deepStrictEqual(catalog, [{ modelId: "haiku", name: "Haiku", description: "" }])
	})

	Vitest.it("still drops entries whose id or name is blank", () => {
		const catalog = catalogFromModelInfos([
			{ value: " ", displayName: "Ghost", description: "" },
			{ value: "sonnet", displayName: " ", description: "" }
		])

		Vitest.assert.deepStrictEqual(catalog, [])
	})
})
