import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import {
	decodeContractFact,
	encodeContractFact,
	mapAcpPermissionRequest,
	mapAcpSessionNotification,
	mapCursorExtensionMethod,
	selectPermissionOptionId
} from "./CursorAcpMap.ts"

Vitest.describe("mapAcpSessionNotification", () => {
	Vitest.it("maps an agent_message_chunk text payload to a text_delta", () => {
		const fact = mapAcpSessionNotification({
			sessionId: "sess-1",
			update: {
				sessionUpdate: "agent_message_chunk",
				content: {
					type: "text",
					text: "Hello"
				}
			}
		})
		Vitest.assert.deepStrictEqual(fact, Option.some({ contractKind: "text_delta", token: "Hello" }))
	})

	Vitest.it("maps an agent_thought_chunk text payload to a thought_delta", () => {
		const fact = mapAcpSessionNotification({
			sessionId: "sess-1",
			update: {
				sessionUpdate: "agent_thought_chunk",
				content: {
					type: "text",
					text: "Reasoning"
				}
			}
		})
		Vitest.assert.deepStrictEqual(fact, Option.some({
			contractKind: "thought_delta",
			token: "Reasoning"
		}))
	})

	Vitest.it("maps a tool_call with ACP kind read", () => {
		const fact = mapAcpSessionNotification({
			sessionId: "sess-1",
			update: {
				sessionUpdate: "tool_call",
				toolCallId: "call_1",
				title: "Read file",
				kind: "read",
				status: "pending",
				rawInput: {
					path: "/tmp/a.ts"
				}
			}
		})
		Vitest.assert.deepStrictEqual(
			fact,
			Option.some({
				contractKind: "tool_call",
				toolCallId: "call_1",
				title: "Read file",
				kind: "read",
				status: "pending",
				rawInput: {
					path: "/tmp/a.ts"
				}
			})
		)
	})

	Vitest.it("maps a tool_call_update status", () => {
		const fact = mapAcpSessionNotification({
			sessionId: "sess-1",
			update: {
				sessionUpdate: "tool_call_update",
				toolCallId: "call_1",
				status: "completed"
			}
		})
		Vitest.assert.deepStrictEqual(
			fact,
			Option.some({
				contractKind: "tool_call_update",
				toolCallId: "call_1",
				status: "completed"
			})
		)
	})

	Vitest.it("maps a plan update to plan_proposal markdown", () => {
		const fact = mapAcpSessionNotification({
			sessionId: "sess-1",
			update: {
				sessionUpdate: "plan",
				entries: [
					{ content: "Inspect the registry", status: "completed", priority: "high" },
					{ content: "Spawn cursor-agent", status: "pending", priority: "medium" }
				]
			}
		})
		Vitest.assert.deepStrictEqual(
			fact,
			Option.some({
				contractKind: "plan_proposal",
				planMarkdown: "Inspect the registry\nSpawn cursor-agent"
			})
		)
	})

	Vitest.it("skips session updates ACP cannot turn into contract facts", () => {
		const fact = mapAcpSessionNotification({
			sessionId: "sess-1",
			update: {
				sessionUpdate: "available_commands_update",
				availableCommands: []
			}
		})
		Vitest.assert.deepStrictEqual(fact, Option.none())
	})
})

Vitest.describe("mapAcpPermissionRequest", () => {
	Vitest.it("maps an ACP permission request onto a permission_request fact", () => {
		const fact = mapAcpPermissionRequest({
			sessionId: "sess-1",
			toolCall: {
				toolCallId: "call_9",
				title: "Run tests",
				kind: "execute",
				status: "pending"
			},
			options: [
				{ optionId: "allow-once", name: "Allow once", kind: "allow_once" },
				{ optionId: "reject", name: "Reject", kind: "reject_once" }
			]
		})
		Vitest.assert.deepStrictEqual(
			fact,
			Option.some({
				contractKind: "permission_request",
				id: "perm-call_9",
				sessionId: "sess-1",
				permission: "execute",
				toolCallId: "call_9"
			})
		)
	})

	Vitest.it("selects allow_once for allow and reject_once for deny", () => {
		const request = {
			sessionId: "sess-1",
			toolCall: {
				toolCallId: "call_9",
				title: "Run tests",
				kind: "execute",
				status: "pending"
			},
			options: [
				{ optionId: "allow-once", name: "Allow once", kind: "allow_once" },
				{ optionId: "reject", name: "Reject", kind: "reject_once" }
			]
		}
		Vitest.assert.deepStrictEqual(selectPermissionOptionId(request, "allow"), Option.some("allow-once"))
		Vitest.assert.deepStrictEqual(selectPermissionOptionId(request, "deny"), Option.some("reject"))
	})
})

Vitest.describe("mapCursorExtensionMethod", () => {
	Vitest.it("does not map Cursor-only ACP extension methods", () => {
		Vitest.assert.deepStrictEqual(mapCursorExtensionMethod("cursor/ask_question"), Option.none())
		Vitest.assert.deepStrictEqual(mapCursorExtensionMethod("cursor/create_plan"), Option.none())
		Vitest.assert.deepStrictEqual(mapCursorExtensionMethod("cursor/update_todos"), Option.none())
		Vitest.assert.deepStrictEqual(mapCursorExtensionMethod("cursor/task"), Option.none())
		Vitest.assert.deepStrictEqual(mapCursorExtensionMethod("_cursor/generate_image"), Option.none())
	})
})

Vitest.describe("contract fact codec", () => {
	Vitest.it("round-trips a text_delta fact", () => {
		const fact = {
			contractKind: "text_delta" as const,
			token: "Hello"
		}
		const encoded = encodeContractFact(fact)
		Vitest.assert.isTrue(Option.isSome(encoded))
		if (Option.isSome(encoded)) {
			Vitest.assert.deepStrictEqual(decodeContractFact(encoded.value), Option.some(fact))
		}
	})
})
