import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import { detectGrokToolKind, permissionIdForToolCall, toolCallPathHint } from "./Tools.ts"

Vitest.describe("detectGrokToolKind", () => {
	Vitest.it("folds spaces, underscores and dashes out of the tool name", () => {
		Vitest.assert.strictEqual(detectGrokToolKind("Read file"), "read")
		Vitest.assert.strictEqual(detectGrokToolKind("write_file"), "edit")
		Vitest.assert.strictEqual(detectGrokToolKind("apply-patch"), "edit")
		Vitest.assert.strictEqual(detectGrokToolKind(" Terminal "), "execute")
		Vitest.assert.strictEqual(detectGrokToolKind("Switch mode"), "switch_mode")
	})

	Vitest.it("accepts an ACP tool kind sent verbatim", () => {
		Vitest.assert.strictEqual(detectGrokToolKind("search"), "search")
		Vitest.assert.strictEqual(detectGrokToolKind("think"), "think")
		Vitest.assert.strictEqual(detectGrokToolKind("switch_mode"), "switch_mode")
		Vitest.assert.strictEqual(detectGrokToolKind("other"), "other")
	})

	Vitest.it("falls back to other for a tool name Grok has not shipped yet", () => {
		Vitest.assert.strictEqual(detectGrokToolKind("mcp__acepe__inspect"), "other")
	})
})

Vitest.describe("toolCallPathHint", () => {
	Vitest.it("reads a path for a file operation kind", () => {
		Vitest.assert.deepStrictEqual(
			toolCallPathHint("read", { path: "/tmp/acepe/a.ts" }),
			Option.some("/tmp/acepe/a.ts")
		)
		Vitest.assert.deepStrictEqual(
			toolCallPathHint("edit", { file_path: "/tmp/acepe/b.ts" }),
			Option.some("/tmp/acepe/b.ts")
		)
	})

	Vitest.it("leaves every other kind without a path", () => {
		Vitest.assert.deepStrictEqual(toolCallPathHint("execute", { command: "bun test" }), Option.none())
		Vitest.assert.deepStrictEqual(toolCallPathHint("read", { command: "bun test" }), Option.none())
	})
})

Vitest.describe("permissionIdForToolCall", () => {
	Vitest.it("prefixes the tool call id", () => {
		Vitest.assert.strictEqual(permissionIdForToolCall("call_9"), "perm-call_9")
	})
})
