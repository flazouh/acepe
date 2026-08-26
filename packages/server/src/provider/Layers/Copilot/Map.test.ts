import * as Vitest from "@effect/vitest"
import * as Schema from "effect/Schema"
import { mapAcpUpdate, mapPromptResult } from "./Map.ts"
import { permissionIdForToolCall } from "./Tools.ts"

type JsonObject = typeof Schema.JsonObject.Type

const jsonObject = (value: JsonObject): JsonObject => value

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

	Vitest.it("keeps a Copilot usage total that arrives beside the input and output breakdown", () => {
		const camelCase = mapAcpUpdate({
			type: "usage",
			sessionId: "acp-1",
			inputTokens: 12,
			outputTokens: 4,
			totalTokens: 16
		})
		Vitest.assert.deepStrictEqual(camelCase, [
			{
				contractKind: "usage",
				sessionId: "acp-1",
				inputTokens: 12,
				outputTokens: 4,
				totalTokens: 16
			}
		])
		const snakeCase = mapAcpUpdate({
			type: "usageTelemetryUpdate",
			sessionId: "acp-1",
			inputTokens: 12,
			outputTokens: 4,
			total_tokens: 16
		})
		Vitest.assert.deepStrictEqual(snakeCase, [
			{
				contractKind: "usage",
				sessionId: "acp-1",
				inputTokens: 12,
				outputTokens: 4,
				totalTokens: 16
			}
		])
	})

	Vitest.it("keeps the context occupancy total when the breakdown ships with it", () => {
		const usage = mapAcpUpdate({
			type: "usage",
			sessionId: "acp-1",
			inputTokens: 12,
			outputTokens: 4,
			used: 40,
			size: 128000
		})
		Vitest.assert.deepStrictEqual(usage, [
			{
				contractKind: "usage",
				sessionId: "acp-1",
				inputTokens: 12,
				outputTokens: 4,
				totalTokens: 40,
				contextWindowSize: 128000
			}
		])
	})

	Vitest.it("prefers an explicit total over the context occupancy figure", () => {
		const usage = mapAcpUpdate({
			type: "usage",
			sessionId: "acp-1",
			totalTokens: 16,
			used: 40
		})
		Vitest.assert.deepStrictEqual(usage, [
			{
				contractKind: "usage",
				sessionId: "acp-1",
				totalTokens: 16
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
