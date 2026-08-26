import * as Vitest from "@effect/vitest"
import { detectClaudeToolKind } from "./Tools.ts"

Vitest.describe("detectClaudeToolKind", () => {
	Vitest.it("maps Read and Bash to ACP kinds used by the reference fixture", () => {
		Vitest.assert.strictEqual(detectClaudeToolKind("Read"), "read")
		Vitest.assert.strictEqual(detectClaudeToolKind("Bash"), "execute")
		Vitest.assert.strictEqual(detectClaudeToolKind("ExitPlanMode"), "exit_plan_mode")
		Vitest.assert.strictEqual(detectClaudeToolKind("mcp__server__Read"), "read")
	})
})
