import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { opencodeFactFromLine, OpenCodeJsonlLine } from "./opencode.ts"

Vitest.describe("opencodeFactFromLine", () => {
	Vitest.it("reads user and assistant text parts", () => {
		const user = opencodeFactFromLine({
			id: "msg-user-1",
			role: "user",
			parts: [{ type: "text", text: "Hello OpenCode" }]
		})
		const assistant = opencodeFactFromLine({
			id: "msg-assistant-1",
			role: "assistant",
			parts: [{ type: "text", text: "Hi there" }]
		})
		Vitest.assert.isTrue(Option.isSome(user))
		Vitest.assert.isTrue(Option.isSome(assistant))
		if (Option.isSome(user)) {
			Vitest.assert.strictEqual(user.value.text, "Hello OpenCode")
		}
		if (Option.isSome(assistant)) {
			Vitest.assert.strictEqual(assistant.value.role, "assistant")
			Vitest.assert.strictEqual(assistant.value.text, "Hi there")
		}
	})

	Vitest.it("reads the API wrapper line shape", () => {
		const fact = opencodeFactFromLine({
			info: {
				id: "msg-user-1",
				role: "user"
			},
			parts: [{ type: "text", text: "Inspect this" }]
		})
		Vitest.assert.isTrue(Option.isSome(fact))
		if (Option.isSome(fact)) {
			Vitest.assert.strictEqual(fact.value.text, "Inspect this")
		}
	})

	Vitest.it("skips tool-only parts", () => {
		Vitest.assert.isTrue(
			Option.isNone(
				opencodeFactFromLine({
					role: "assistant",
					parts: [{ type: "tool-invocation" }]
				})
			)
		)
	})
})

Vitest.describe("OpenCodeJsonlLine schema", () => {
	Vitest.it("decodes a message JSONL object", () => {
		const line = Schema.decodeUnknownSync(OpenCodeJsonlLine)({
			id: "msg-1",
			role: "user",
			parts: [{ type: "text", text: "Hello" }]
		})
		Vitest.assert.isTrue("role" in line)
	})
})
