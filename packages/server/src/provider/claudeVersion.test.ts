import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import { parseClaudeVersion } from "./claudeVersion.ts"

Vitest.describe("parseClaudeVersion", () => {
	Vitest.it("takes the first token and drops the trailing Claude Code suffix", () => {
		const parsed = parseClaudeVersion("2.1.186 (Claude Code)\n")
		Vitest.assert.deepStrictEqual(parsed, Option.some("2.1.186"))
	})

	Vitest.it("keeps a bare semver token", () => {
		Vitest.assert.deepStrictEqual(parseClaudeVersion("2.1.186"), Option.some("2.1.186"))
	})

	Vitest.it("returns none for empty output", () => {
		Vitest.assert.deepStrictEqual(parseClaudeVersion("   \n"), Option.none())
	})
})
