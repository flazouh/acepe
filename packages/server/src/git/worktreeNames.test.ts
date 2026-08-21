import * as Vitest from "@effect/vitest"
import { isWorktreeName, WORKTREE_ADJECTIVES, WORKTREE_NOUNS } from "./worktreeNames.ts"

Vitest.describe("isWorktreeName", () => {
	Vitest.it("accepts adjective-noun pairs from the Acepe lists", () => {
		Vitest.assert.strictEqual(WORKTREE_ADJECTIVES.length > 0, true)
		Vitest.assert.strictEqual(WORKTREE_NOUNS.length > 0, true)
		Vitest.assert.strictEqual(isWorktreeName("clever-falcon"), true)
		Vitest.assert.strictEqual(isWorktreeName("not-a-name"), false)
		Vitest.assert.strictEqual(isWorktreeName("clever"), false)
	})
})
