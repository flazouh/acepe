import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { claudeFactFromLine, ClaudeJsonlLine, claudeSessionIdFromLine } from "./claude.ts"

const decodeLine = (value: unknown) => Schema.decodeUnknownSync(ClaudeJsonlLine)(value)

Vitest.describe("claudeFactFromLine", () => {
	Vitest.it("reads user and assistant text", () => {
		const user = claudeFactFromLine({
			type: "user",
			message: {
				role: "user",
				content: "Hello from Claude"
			}
		})
		const assistant = claudeFactFromLine({
			type: "assistant",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "Hi there" }]
			}
		})
		Vitest.assert.isTrue(Option.isSome(user))
		Vitest.assert.isTrue(Option.isSome(assistant))
		if (Option.isSome(user)) {
			Vitest.assert.strictEqual(user.value.role, "user")
			Vitest.assert.strictEqual(user.value.text, "Hello from Claude")
		}
		if (Option.isSome(assistant)) {
			Vitest.assert.strictEqual(assistant.value.role, "assistant")
			Vitest.assert.strictEqual(assistant.value.text, "Hi there")
		}
	})

	Vitest.it("skips meta, sidechain, snapshot, and tool-only rows", () => {
		Vitest.assert.isTrue(
			Option.isNone(
				claudeFactFromLine({
					type: "user",
					isMeta: true,
					message: { content: "tool result" }
				})
			)
		)
		Vitest.assert.isTrue(
			Option.isNone(
				claudeFactFromLine({
					type: "assistant",
					isSidechain: true,
					message: { content: "subagent" }
				})
			)
		)
		Vitest.assert.isTrue(
			Option.isNone(
				claudeFactFromLine({
					type: "file-history-snapshot",
					message: { content: "nope" }
				})
			)
		)
		Vitest.assert.isTrue(
			Option.isNone(
				claudeFactFromLine({
					type: "assistant",
					message: {
						content: [{ type: "tool_use" }]
					}
				})
			)
		)
	})

	Vitest.it("reads sessionId as provider metadata", () => {
		const sessionId = claudeSessionIdFromLine({
			type: "user",
			sessionId: "sess-claude-1",
			message: { content: "Hello" }
		})
		Vitest.assert.isTrue(Option.isSome(sessionId))
		if (Option.isSome(sessionId)) {
			Vitest.assert.strictEqual(sessionId.value, "sess-claude-1")
		}
	})
})

Vitest.describe("ClaudeJsonlLine schema", () => {
	Vitest.it("decodes a real Claude JSONL object", () => {
		const line = decodeLine({
			type: "user",
			uuid: "row-1",
			sessionId: "sess-1",
			timestamp: "2026-08-21T12:00:00.000Z",
			cwd: "/tmp/acepe",
			message: {
				role: "user",
				content: [{ type: "text", text: "Hello" }]
			}
		})
		Vitest.assert.strictEqual(line.type, "user")
		Vitest.assert.strictEqual(line.sessionId, "sess-1")
	})
})
