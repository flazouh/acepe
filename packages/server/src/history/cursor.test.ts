import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { cursorFactFromLine, CursorJsonlLine } from "./cursor.ts"

Vitest.describe("cursorFactFromLine", () => {
	Vitest.it("reads user text from message.content", () => {
		const fact = cursorFactFromLine({
			role: "user",
			message: {
				content: "Hello from Cursor"
			}
		})
		Vitest.assert.isTrue(Option.isSome(fact))
		if (Option.isSome(fact)) {
			Vitest.assert.strictEqual(fact.value.role, "user")
			Vitest.assert.strictEqual(fact.value.text, "Hello from Cursor")
		}
	})

	Vitest.it("reads assistant text from top-level content blocks", () => {
		const fact = cursorFactFromLine({
			role: "assistant",
			content: [{ type: "text", text: "Hi there" }]
		})
		Vitest.assert.isTrue(Option.isSome(fact))
		if (Option.isSome(fact)) {
			Vitest.assert.strictEqual(fact.value.role, "assistant")
			Vitest.assert.strictEqual(fact.value.text, "Hi there")
		}
	})

	Vitest.it("skips tool roles", () => {
		Vitest.assert.isTrue(
			Option.isNone(
				cursorFactFromLine({
					role: "tool",
					content: "result"
				})
			)
		)
	})
})

Vitest.describe("CursorJsonlLine schema", () => {
	Vitest.it("decodes a Cursor JSONL object", () => {
		const line = Schema.decodeUnknownSync(CursorJsonlLine)({
			role: "user",
			message: {
				content: "Hello"
			}
		})
		Vitest.assert.strictEqual(line.role, "user")
	})
})
