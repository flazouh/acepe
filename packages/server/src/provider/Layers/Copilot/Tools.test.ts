import * as Vitest from "@effect/vitest"
import { detectCopilotToolKind } from "./Tools.ts"

Vitest.describe("detectCopilotToolKind", () => {
	Vitest.it("maps Copilot tool names the same way today's parser does", () => {
		Vitest.assert.strictEqual(detectCopilotToolKind("apply_patch"), "edit")
		Vitest.assert.strictEqual(detectCopilotToolKind("rg"), "search")
		Vitest.assert.strictEqual(detectCopilotToolKind("view"), "read")
		Vitest.assert.strictEqual(detectCopilotToolKind("bash"), "execute")
		Vitest.assert.strictEqual(detectCopilotToolKind("update_todos"), "todo")
		Vitest.assert.strictEqual(detectCopilotToolKind("subagent"), "task")
		Vitest.assert.strictEqual(detectCopilotToolKind("mcp__github__search"), "search")
	})
})
