import * as Vitest from "@effect/vitest"
import * as Result from "effect/Result"
import { generateSkillContent, parseSkillContent } from "./parser.ts"

Vitest.describe("parseSkillContent", () => {
	Vitest.it("reads name, description, and body from YAML frontmatter", () => {
		const content = `---
name: "test-skill"
description: "A test skill"
---

# Test Skill

This is the body.`
		const parsed = parseSkillContent(content)
		Vitest.assert.strictEqual(Result.isSuccess(parsed), true)
		if (Result.isSuccess(parsed)) {
			Vitest.assert.strictEqual(parsed.success.metadata.name, "test-skill")
			Vitest.assert.strictEqual(parsed.success.metadata.description, "A test skill")
			Vitest.assert.strictEqual(parsed.success.body.includes("# Test Skill"), true)
		}
	})

	Vitest.it("fails when the file has no frontmatter", () => {
		const parsed = parseSkillContent("# Just markdown\nNo frontmatter here.")
		Vitest.assert.strictEqual(Result.isFailure(parsed), true)
		if (Result.isFailure(parsed)) {
			Vitest.assert.strictEqual(
				parsed.failure.reason,
				"No YAML frontmatter found. Skill files must start with ---"
			)
		}
	})

	Vitest.it("fails when the name field is missing", () => {
		const content = `---
description: "Only description"
---

Body content.`
		const parsed = parseSkillContent(content)
		Vitest.assert.strictEqual(Result.isFailure(parsed), true)
		if (Result.isFailure(parsed)) {
			Vitest.assert.strictEqual(parsed.failure.reason.includes("name"), true)
		}
	})
})

Vitest.describe("generateSkillContent", () => {
	Vitest.it("writes quoted name and description around the body", () => {
		const content = generateSkillContent("my-skill", "Does something", "# Content")
		Vitest.assert.strictEqual(content.includes('name: "my-skill"'), true)
		Vitest.assert.strictEqual(content.includes('description: "Does something"'), true)
		Vitest.assert.strictEqual(content.includes("# Content"), true)
	})
})
