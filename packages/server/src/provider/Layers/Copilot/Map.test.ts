import * as Vitest from "@effect/vitest"
import * as Schema from "effect/Schema"
import type { CopilotContractFact } from "./Facts.ts"
import { mapAcpUpdate, mapPromptResult } from "./Map.ts"
import { permissionIdForToolCall } from "./Tools.ts"

type JsonObject = typeof Schema.JsonObject.Type

const jsonObject = (value: JsonObject): JsonObject => value

// Returns a sentinel rather than skipping the assertion when the mapping
// produced something other than a usage fact, so the caller's assertion still
// runs and still fails on a wrong shape.
const usageEventId = (facts: ReadonlyArray<CopilotContractFact>): string => {
	const fact = facts[0]
	if (fact === undefined || fact.contractKind !== "usage") {
		return "no-usage-fact"
	}
	return fact.eventId ?? "no-event-id"
}

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
				eventId: "copilot-token-usage:acp-1:total=none:input=12:output=4:cost=0.02:context=none",
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
				eventId: "copilot-token-usage:acp-1:total=16:input=12:output=4:cost=none:context=none",
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
				eventId: "copilot-token-usage:acp-1:total=16:input=12:output=4:cost=none:context=none",
				inputTokens: 12,
				outputTokens: 4,
				totalTokens: 16
			}
		])
	})

	// `used` reports how full the context window is, so it is deliberately larger
	// than the tokens this turn spent. Reporting it as the total of a turn that spent
	// 16 tokens would make the fact contradict its own breakdown, so the total stays
	// absent here. `size` is still the window size and is still read.
	Vitest.it("never reports the context occupancy figure as the total of a breakdown", () => {
		const usage = mapAcpUpdate({
			type: "usage",
			sessionId: "acp-1",
			inputTokens: 12,
			outputTokens: 4,
			used: 41000,
			size: 128000
		})
		Vitest.assert.deepStrictEqual(usage, [
			{
				contractKind: "usage",
				sessionId: "acp-1",
				eventId:
					"copilot-token-usage:acp-1:total=none:input=12:output=4:cost=none:context=128000",
				inputTokens: 12,
				outputTokens: 4,
				contextWindowSize: 128000
			}
		])
	})

	Vitest.it("still reads the context occupancy figure when no breakdown ships with it", () => {
		const usage = mapAcpUpdate({
			type: "usage",
			sessionId: "acp-1",
			used: 41000,
			size: 128000
		})
		Vitest.assert.deepStrictEqual(usage, [
			{
				contractKind: "usage",
				sessionId: "acp-1",
				eventId:
					"copilot-token-usage:acp-1:total=41000:input=none:output=none:cost=none:context=128000",
				totalTokens: 41000,
				contextWindowSize: 128000
			}
		])
	})

	Vitest.it("prefers an explicit total over the context occupancy figure", () => {
		const usage = mapAcpUpdate({
			type: "usage",
			sessionId: "acp-1",
			totalTokens: 16,
			used: 41000
		})
		Vitest.assert.deepStrictEqual(usage, [
			{
				contractKind: "usage",
				sessionId: "acp-1",
				eventId:
					"copilot-token-usage:acp-1:total=16:input=none:output=none:cost=none:context=none",
				totalTokens: 16
			}
		])
		const withBreakdown = mapAcpUpdate({
			type: "usage",
			sessionId: "acp-1",
			inputTokens: 12,
			outputTokens: 4,
			totalTokens: 16,
			used: 41000
		})
		Vitest.assert.deepStrictEqual(withBreakdown, [
			{
				contractKind: "usage",
				sessionId: "acp-1",
				eventId: "copilot-token-usage:acp-1:total=16:input=12:output=4:cost=none:context=none",
				inputTokens: 12,
				outputTokens: 4,
				totalTokens: 16
			}
		])
	})

	// Claude accepts these spellings for the same two figures
	// (Claude/Map.ts:308-313). Reading a key that was previously ignored can only
	// recover a figure the provider sent, never invent one, so the aliases are safe
	// without a recorded Copilot payload to pin the spelling.
	Vitest.it("reads the snake_case cost and context-window keys its siblings accept", () => {
		const usage = mapAcpUpdate({
			type: "usage",
			sessionId: "acp-1",
			inputTokens: 12,
			outputTokens: 4,
			cost_usd: 0.02,
			context_window_size: 128000
		})
		Vitest.assert.deepStrictEqual(usage, [
			{
				contractKind: "usage",
				sessionId: "acp-1",
				eventId:
					"copilot-token-usage:acp-1:total=none:input=12:output=4:cost=0.02:context=128000",
				inputTokens: 12,
				outputTokens: 4,
				costUsd: 0.02,
				contextWindowSize: 128000
			}
		])
	})

	Vitest.it("prefers the nested cost amount over a flat cost key", () => {
		const usage = mapAcpUpdate({
			type: "usage",
			sessionId: "acp-1",
			cost: { amount: 0.02 },
			total_cost_usd: 0.99
		})
		Vitest.assert.deepStrictEqual(usage, [
			{
				contractKind: "usage",
				sessionId: "acp-1",
				eventId:
					"copilot-token-usage:acp-1:total=none:input=none:output=none:cost=0.02:context=none",
				costUsd: 0.02
			}
		])
	})

	// #274: the desktop dedups usage telemetry on lastTelemetryEventId. Codex
	// composes that key from its thread, its turn and every token figure (see
	// Codex/Map.ts). Copilot carries no turn id here, so the composite is the
	// session id plus every figure the fact carries. The literal is pinned
	// because a per-emission id — a uuid, a clock reading — reads as an eventId
	// while deduplicating nothing.
	Vitest.it("builds the usage eventId from the session and every figure", () => {
		const reading = jsonObject({
			type: "usage",
			sessionId: "acp-1",
			inputTokens: 12,
			outputTokens: 4,
			totalTokens: 16,
			cost: { amount: 0.02 },
			size: 128000
		})
		Vitest.assert.strictEqual(
			usageEventId(mapAcpUpdate(reading)),
			"copilot-token-usage:acp-1:total=16:input=12:output=4:cost=0.02:context=128000"
		)
		Vitest.assert.strictEqual(
			usageEventId(mapAcpUpdate(reading)),
			usageEventId(mapAcpUpdate(reading))
		)
	})

	Vitest.it("names an absent usage figure rather than dropping it from the eventId", () => {
		Vitest.assert.strictEqual(
			usageEventId(
				mapAcpUpdate({
					type: "usage",
					sessionId: "acp-1",
					used: 41000,
					size: 128000
				})
			),
			"copilot-token-usage:acp-1:total=41000:input=none:output=none:cost=none:context=128000"
		)
	})

	Vitest.it("gives two readings that differ by one figure two eventIds", () => {
		const base = usageEventId(
			mapAcpUpdate({
				type: "usage",
				sessionId: "acp-1",
				inputTokens: 12,
				outputTokens: 4,
				totalTokens: 16,
				cost: { amount: 0.02 },
				size: 128000
			})
		)
		const oneTokenMore = usageEventId(
			mapAcpUpdate({
				type: "usage",
				sessionId: "acp-1",
				inputTokens: 12,
				outputTokens: 5,
				totalTokens: 17,
				cost: { amount: 0.02 },
				size: 128000
			})
		)
		const oneCentMore = usageEventId(
			mapAcpUpdate({
				type: "usage",
				sessionId: "acp-1",
				inputTokens: 12,
				outputTokens: 4,
				totalTokens: 16,
				cost: { amount: 0.03 },
				size: 128000
			})
		)
		const otherSession = usageEventId(
			mapAcpUpdate({
				type: "usage",
				sessionId: "acp-2",
				inputTokens: 12,
				outputTokens: 4,
				totalTokens: 16,
				cost: { amount: 0.02 },
				size: 128000
			})
		)
		Vitest.assert.notStrictEqual(base, oneTokenMore)
		Vitest.assert.notStrictEqual(base, oneCentMore)
		Vitest.assert.notStrictEqual(base, otherSession)
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
