import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import {
	contractFactToAcpSessionUpdate,
	decodeContractFact,
	detectCopilotToolKind,
	encodeContractFact,
	mapAcpUpdate,
	mapPromptResult,
	permissionIdForToolCall,
	roundTripAcpSessionUpdate
} from "./CopilotAcpMap.ts"

type Json = typeof Schema.Json.Type
type JsonObject = typeof Schema.JsonObject.Type

const jsonObject = (value: JsonObject): JsonObject => value

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

Vitest.describe("mapAcpUpdate", () => {
	Vitest.it("maps ACP agent_message_chunk wire and normalized shapes to text_delta", () => {
		const wire = mapAcpUpdate({
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: "Hello" }
		})
		Vitest.assert.deepStrictEqual(wire, [
			{ contractKind: "text_delta", token: "Hello" }
		])
		const normalized = mapAcpUpdate({
			type: "agent_message_chunk",
			token: "Hi"
		})
		Vitest.assert.deepStrictEqual(normalized, [{ contractKind: "text_delta", token: "Hi" }])
	})

	Vitest.it("unwraps session/update notifications", () => {
		const facts = mapAcpUpdate({
			jsonrpc: "2.0",
			method: "session/update",
			params: {
				sessionId: "acp-1",
				update: {
					sessionUpdate: "agent_thought_chunk",
					content: { type: "text", text: "Thinking" }
				}
			}
		})
		Vitest.assert.deepStrictEqual(facts, [{ contractKind: "thought_delta", token: "Thinking" }])
	})

	Vitest.it("maps Copilot tool_call, permission, and usage updates", () => {
		const tool = mapAcpUpdate({
			sessionUpdate: "tool_call",
			toolCallId: "call-1",
			title: "rg",
			status: "pending",
			rawInput: jsonObject({ pattern: "foo" })
		})
		Vitest.assert.deepStrictEqual(tool, [
			{
				contractKind: "tool_call",
				toolCallId: "call-1",
				title: "rg",
				kind: "search",
				status: "pending",
				rawInput: { pattern: "foo" }
			}
		])
		const permission = mapAcpUpdate({
			type: "permissionRequest",
			permissionRequest: {
				id: permissionIdForToolCall("call-1"),
				sessionId: "acp-1",
				permission: "execute",
				toolCallId: "call-1"
			}
		})
		Vitest.assert.deepStrictEqual(permission, [
			{
				contractKind: "permission_request",
				id: "perm-call-1",
				sessionId: "acp-1",
				permission: "execute",
				toolCallId: "call-1"
			}
		])
		const usage = mapAcpUpdate({
			type: "usage",
			sessionId: "acp-1",
			inputTokens: 12,
			outputTokens: 4,
			cost: { amount: 0.02 }
		})
		Vitest.assert.deepStrictEqual(usage, [
			{
				contractKind: "usage",
				sessionId: "acp-1",
				inputTokens: 12,
				outputTokens: 4,
				costUsd: 0.02
			}
		])
	})
})

Vitest.describe("mapPromptResult", () => {
	Vitest.it("completes a turn on end_turn and errors on refusal", () => {
		Vitest.assert.deepStrictEqual(mapPromptResult({ stopReason: "end_turn" }), {
			contractKind: "turn_complete"
		})
		Vitest.assert.deepStrictEqual(mapPromptResult({ stopReason: "cancelled" }), {
			contractKind: "turn_complete"
		})
		Vitest.assert.deepStrictEqual(mapPromptResult({ stopReason: "refusal" }), {
			contractKind: "turn_error",
			detail: "refusal"
		})
	})
})

Vitest.describe("contract fact round-trip", () => {
	Vitest.it("encodes Copilot facts as ACP session updates and decodes them back", () => {
		const fact = {
			contractKind: "tool_call" as const,
			toolCallId: "call-2",
			title: "apply_patch",
			kind: "edit" as const,
			status: "completed" as const,
			rawInput: jsonObject({ fileName: "README.md" })
		}
		const encoded = encodeContractFact(fact)
		Vitest.assert.isTrue(Option.isSome(encoded))
		if (Option.isSome(encoded)) {
			const decoded = decodeContractFact(encoded.value)
			Vitest.assert.deepStrictEqual(decoded, Option.some(fact))
			const remapped = roundTripAcpSessionUpdate(contractFactToAcpSessionUpdate(fact))
			Vitest.assert.deepStrictEqual(remapped, Option.some(contractFactToAcpSessionUpdate(fact)))
		}
	})
})
