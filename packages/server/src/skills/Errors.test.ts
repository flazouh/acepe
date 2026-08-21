import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import {
	PluginNotFoundError,
	PluginSkillInvalidIdError,
	PluginSkillNotFoundError,
	SkillInvalidIdError,
	SkillNotFoundError,
	SkillParseError,
	SkillUnknownAgentError
} from "./Errors.ts"

Vitest.describe("SkillParseError", () => {
	Vitest.it.effect("is a tagged yieldable error with the parse reason", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new SkillParseError({
					reason: "Required field 'name' not found in frontmatter"
				})
			)
			Vitest.assert.strictEqual(error._tag, "SkillParseError")
			Vitest.assert.strictEqual(
				error.message,
				"Required field 'name' not found in frontmatter"
			)
		})
	)
})

Vitest.describe("SkillUnknownAgentError", () => {
	Vitest.it.effect("names the unknown agent", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(new SkillUnknownAgentError({ agentId: "forge" }))
			Vitest.assert.strictEqual(error._tag, "SkillUnknownAgentError")
			Vitest.assert.strictEqual(error.message, "Unknown agent: forge")
		})
	)
})

Vitest.describe("SkillInvalidIdError", () => {
	Vitest.it.effect("names the malformed skill id", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(new SkillInvalidIdError({ skillId: "bad" }))
			Vitest.assert.strictEqual(error.message, "Invalid skill ID format: bad")
		})
	)
})

Vitest.describe("SkillNotFoundError", () => {
	Vitest.it.effect("names the missing skill id", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new SkillNotFoundError({ skillId: "claude-code::missing" })
			)
			Vitest.assert.strictEqual(error.message, "Skill not found: claude-code::missing")
		})
	)
})

Vitest.describe("PluginNotFoundError", () => {
	Vitest.it.effect("names the missing plugin id", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new PluginNotFoundError({ pluginId: "shop::missing" })
			)
			Vitest.assert.strictEqual(error.message, "Plugin not found: shop::missing")
		})
	)
})

Vitest.describe("PluginSkillInvalidIdError", () => {
	Vitest.it.effect("names the malformed plugin skill id", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(new PluginSkillInvalidIdError({ skillId: "a::b" }))
			Vitest.assert.strictEqual(error.message, "Invalid plugin skill ID format: a::b")
		})
	)
})

Vitest.describe("PluginSkillNotFoundError", () => {
	Vitest.it.effect("names the missing plugin skill id", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new PluginSkillNotFoundError({ skillId: "shop::plug::gone" })
			)
			Vitest.assert.strictEqual(error.message, "Plugin skill not found: shop::plug::gone")
		})
	)
})
