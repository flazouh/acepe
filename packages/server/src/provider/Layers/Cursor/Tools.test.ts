import * as Vitest from "@effect/vitest"
import { detectCursorToolKind, permissionIdForToolCall } from "./Tools.ts"

Vitest.describe("detectCursorToolKind", () => {
	Vitest.it("folds spaces, underscores and dashes out of the tool name", () => {
		Vitest.assert.strictEqual(detectCursorToolKind("Read file"), "read")
		Vitest.assert.strictEqual(detectCursorToolKind("write_file"), "edit")
		Vitest.assert.strictEqual(detectCursorToolKind("apply-patch"), "edit")
		Vitest.assert.strictEqual(detectCursorToolKind(" Terminal "), "execute")
	})

	Vitest.it("accepts an ACP tool kind sent verbatim", () => {
		Vitest.assert.strictEqual(detectCursorToolKind("search"), "search")
		Vitest.assert.strictEqual(detectCursorToolKind("think"), "think")
		Vitest.assert.strictEqual(detectCursorToolKind("other"), "other")
	})

	Vitest.it("falls back to other for a tool name Cursor has not shipped yet", () => {
		Vitest.assert.strictEqual(detectCursorToolKind("mcp__acepe__inspect"), "other")
	})
})

Vitest.describe("permissionIdForToolCall", () => {
	Vitest.it("prefixes the tool call id", () => {
		Vitest.assert.strictEqual(permissionIdForToolCall("call_9"), "perm-call_9")
	})
})
