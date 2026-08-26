import * as Vitest from "@effect/vitest"
import { detectOpenCodeToolKind, resolveOpenCodeToolKind } from "./Tools.ts"

Vitest.describe("detectOpenCodeToolKind", () => {
	Vitest.it("maps OpenCode camelCase names to contract kinds", () => {
		Vitest.assert.strictEqual(detectOpenCodeToolKind("bash"), "execute")
		Vitest.assert.strictEqual(detectOpenCodeToolKind("ReadFile"), "read")
		Vitest.assert.strictEqual(detectOpenCodeToolKind("EditFile"), "edit")
		Vitest.assert.strictEqual(detectOpenCodeToolKind("apply_patch"), "edit")
		Vitest.assert.strictEqual(detectOpenCodeToolKind("find_files"), "glob")
		Vitest.assert.strictEqual(detectOpenCodeToolKind("http_fetch"), "fetch")
		Vitest.assert.strictEqual(detectOpenCodeToolKind("think"), "think")
		Vitest.assert.strictEqual(detectOpenCodeToolKind("UnknownTool"), "other")
	})

	Vitest.it("keeps a thinking step apart from a delegated task", () => {
		Vitest.assert.strictEqual(detectOpenCodeToolKind("think"), "think")
		Vitest.assert.strictEqual(detectOpenCodeToolKind("reason"), "think")
		Vitest.assert.strictEqual(detectOpenCodeToolKind("task"), "task")
		Vitest.assert.strictEqual(detectOpenCodeToolKind("spawn"), "task")
		Vitest.assert.strictEqual(detectOpenCodeToolKind("agent"), "task")
		Vitest.assert.strictEqual(detectOpenCodeToolKind("subagent"), "task")
		Vitest.assert.strictEqual(detectOpenCodeToolKind("delegate"), "task")
		Vitest.assert.strictEqual(detectOpenCodeToolKind("spawn_task"), "task")
	})

	Vitest.it("promotes webfetch search URLs to web_search", () => {
		Vitest.assert.strictEqual(
			resolveOpenCodeToolKind("webfetch", {
				url: "https://github.com/search?q=CLAUDE.md+boris&type=code"
			}),
			"web_search"
		)
		Vitest.assert.strictEqual(
			resolveOpenCodeToolKind("webfetch", {
				url: "https://example.com"
			}),
			"fetch"
		)
	})
})
