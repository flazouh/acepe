import {
	loadFixture,
	referenceFixturePath,
	tracerBulletFixturePath
} from "@acepe/harness"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import {
	classifyChunkAggregationHint,
	emptyCodexMapState,
	mapCodexServerMessage
} from "./Map.ts"

type Json = typeof Schema.Json.Type

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const mapOne = (message: Json, sessionId = "session-1") =>
	mapCodexServerMessage(emptyCodexMapState, sessionId, message)

Vitest.describe("mapCodexServerMessage", () => {
	Vitest.it("maps agent message deltas into text_delta facts", () => {
		const mapped = mapOne({
			jsonrpc: "2.0",
			method: "item/agentMessage/delta",
			params: {
				threadId: "thread-1",
				turnId: "turn-1",
				itemId: "msg-1",
				delta: "working"
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, [
			{
				contractKind: "text_delta",
				token: "working"
			}
		])
	})

	Vitest.it("preserves leading whitespace in text deltas", () => {
		const mapped = mapOne({
			jsonrpc: "2.0",
			method: "item/agentMessage/delta",
			params: {
				itemId: "msg-1",
				delta: " world"
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, [
			{
				contractKind: "text_delta",
				token: " world"
			}
		])
	})

	Vitest.it("preserves whitespace-only deltas", () => {
		const mapped = mapOne({
			jsonrpc: "2.0",
			method: "item/agentMessage/delta",
			params: {
				itemId: "msg-1",
				delta: "\n"
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, [
			{
				contractKind: "text_delta",
				token: "\n"
			}
		])
	})

	Vitest.it("maps reasoning deltas into thought_delta facts", () => {
		const mapped = mapOne({
			jsonrpc: "2.0",
			method: "item/reasoning/textDelta",
			params: {
				itemId: "reason-1",
				delta: "Thinking"
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, [
			{
				contractKind: "thought_delta",
				token: "Thinking"
			}
		])
	})

	Vitest.it("maps reasoning summary deltas into thought_delta facts", () => {
		const mapped = mapOne({
			jsonrpc: "2.0",
			method: "item/reasoning/summaryTextDelta",
			params: {
				itemId: "reason-1",
				delta: "Summary"
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, [
			{
				contractKind: "thought_delta",
				token: "Summary"
			}
		])
	})

	Vitest.it("maps file-read permission requests with jsonrpc ids", () => {
		const mapped = mapOne({
			jsonrpc: "2.0",
			id: 42,
			method: "item/fileRead/requestApproval",
			params: {
				itemId: "tool-1",
				path: "src/lib.rs"
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, [
			{
				contractKind: "permission_request",
				id: "42",
				sessionId: "session-1",
				permission: "Read src/lib.rs",
				toolCallId: "tool-1",
				always: ["allow_always"]
			}
		])
	})

	Vitest.it("maps user input requests into questions", () => {
		const mapped = mapOne({
			jsonrpc: "2.0",
			id: 7,
			method: "item/tool/requestUserInput",
			params: {
				itemId: "tool-question-1",
				questions: [
					{
						id: "scope",
						header: "Scope",
						question: "Apply to?",
						multiSelect: true,
						options: [
							{ label: "File", description: "This file only" },
							{ label: "Project", description: "Whole project" }
						]
					}
				]
			}
		})
		Vitest.assert.strictEqual(mapped.facts[0]?.contractKind, "question_request")
		if (mapped.facts[0]?.contractKind === "question_request") {
			Vitest.assert.strictEqual(mapped.facts[0].id, "7")
			Vitest.assert.strictEqual(mapped.facts[0].questions[0]?.header, "Scope")
			Vitest.assert.strictEqual(mapped.facts[0].questions[0]?.multiSelect, true)
			Vitest.assert.strictEqual(mapped.facts[0].toolCallId, "tool-question-1")
		}
	})

	Vitest.it("maps completed turns into turn_complete", () => {
		const mapped = mapOne({
			jsonrpc: "2.0",
			method: "turn/completed",
			params: {
				turn: { id: "turn-1", status: "completed" }
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, [
			{
				contractKind: "turn_complete",
				turnId: "turn-1"
			}
		])
	})

	Vitest.it("maps failed turns into turn_error", () => {
		const mapped = mapOne({
			jsonrpc: "2.0",
			method: "turn/completed",
			params: {
				turn: {
					id: "turn-1",
					status: "failed",
					error: { message: "Boom" }
				}
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, [
			{
				contractKind: "turn_error",
				detail: "Boom",
				turnId: "turn-1"
			}
		])
	})

	Vitest.it("maps wrapper plan chunks into text plus plan_proposal", () => {
		const mapped = mapCodexServerMessage(emptyCodexMapState, "session-plan-1", {
			jsonrpc: "2.0",
			method: "item/agentMessage/delta",
			params: {
				itemId: "msg-plan-1",
				delta: "<proposed_plan># Plan\n\n- step\n</proposed_plan>"
			}
		})
		Vitest.assert.strictEqual(mapped.facts.length, 2)
		Vitest.assert.strictEqual(mapped.facts[0]?.contractKind, "text_delta")
		Vitest.assert.deepStrictEqual(mapped.facts[1], {
			contractKind: "plan_proposal",
			planMarkdown: "# Plan\n\n- step\n",
			streaming: false
		})
	})

	Vitest.it("flushes a partial wrapper plan on turn complete", () => {
		const streamed = mapCodexServerMessage(emptyCodexMapState, "session-plan-turn-complete", {
			jsonrpc: "2.0",
			method: "item/agentMessage/delta",
			params: {
				itemId: "msg-plan-2",
				delta: "<proposed_plan># Partial"
			}
		})
		Vitest.assert.strictEqual(streamed.facts[1]?.contractKind, "plan_proposal")
		if (streamed.facts[1]?.contractKind === "plan_proposal") {
			Vitest.assert.strictEqual(streamed.facts[1].streaming, true)
		}
		const finalized = mapCodexServerMessage(streamed.state, "session-plan-turn-complete", {
			jsonrpc: "2.0",
			method: "turn/completed",
			params: {
				turn: { id: "turn-1", status: "completed" }
			}
		})
		Vitest.assert.strictEqual(finalized.facts.length, 2)
		Vitest.assert.deepStrictEqual(finalized.facts[1], {
			contractKind: "plan_proposal",
			planMarkdown: "# Partial",
			streaming: false
		})
	})

	Vitest.it("ignores retryable transport errors", () => {
		const mapped = mapOne({
			jsonrpc: "2.0",
			method: "error",
			params: {
				willRetry: true,
				error: { message: "temporary" }
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, Arr.empty())
	})

	Vitest.it("maps non-retryable transport errors into turn_error", () => {
		const mapped = mapOne({
			jsonrpc: "2.0",
			method: "error",
			params: {
				willRetry: false,
				error: { message: "broken pipe" }
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, [
			{
				contractKind: "turn_error",
				detail: "broken pipe"
			}
		])
	})

	Vitest.it("returns empty for unknown methods and jsonrpc replies", () => {
		Vitest.assert.deepStrictEqual(
			mapOne({
				jsonrpc: "2.0",
				method: "item/someFutureEvent/delta",
				params: { data: "test" }
			}).facts,
			Arr.empty()
		)
		Vitest.assert.deepStrictEqual(
			mapOne({
				id: 1,
				result: { thread: { id: "thread-1" } }
			}).facts,
			Arr.empty()
		)
	})

	Vitest.it("maps thread token usage into usage facts", () => {
		const mapped = mapOne({
			jsonrpc: "2.0",
			method: "thread/tokenUsage/updated",
			params: {
				threadId: "thread-1",
				turnId: "turn-1",
				tokenUsage: {
					lastTokenUsage: {
						inputTokens: 1200,
						cachedInputTokens: 300,
						outputTokens: 80,
						reasoningOutputTokens: 20,
						totalTokens: 1300
					},
					modelContextWindow: 258400
				}
			}
		})
		Vitest.assert.strictEqual(mapped.facts[0]?.contractKind, "usage")
		if (mapped.facts[0]?.contractKind === "usage") {
			Vitest.assert.strictEqual(mapped.facts[0].totalTokens, 1300)
			Vitest.assert.strictEqual(mapped.facts[0].inputTokens, 1200)
			Vitest.assert.strictEqual(mapped.facts[0].cacheReadTokens, 300)
			Vitest.assert.strictEqual(mapped.facts[0].reasoningTokens, 20)
			Vitest.assert.strictEqual(mapped.facts[0].contextWindowSize, 258400)
			Vitest.assert.isTrue(
				Option.isSome(Option.fromNullishOr(mapped.facts[0].eventId)) &&
					(mapped.facts[0].eventId ?? "").includes("turn-1")
			)
		}
	})

	Vitest.it("maps snake_case thread token usage into usage facts", () => {
		const mapped = mapOne({
			jsonrpc: "2.0",
			method: "thread/tokenUsage/updated",
			params: {
				thread_id: "thread-1",
				turn_id: "turn-1",
				token_usage: {
					last_token_usage: {
						input_tokens: 10,
						cached_input_tokens: 4,
						output_tokens: 3,
						reasoning_output_tokens: 2,
						total_tokens: 13
					},
					model_context_window: 200000
				}
			}
		})
		Vitest.assert.strictEqual(mapped.facts[0]?.contractKind, "usage")
		if (mapped.facts[0]?.contractKind === "usage") {
			Vitest.assert.strictEqual(mapped.facts[0].totalTokens, 13)
			Vitest.assert.strictEqual(mapped.facts[0].inputTokens, 10)
			Vitest.assert.strictEqual(mapped.facts[0].cacheReadTokens, 4)
			Vitest.assert.strictEqual(mapped.facts[0].contextWindowSize, 200000)
			Vitest.assert.isTrue((mapped.facts[0].eventId ?? "").includes("turn-1"))
		}
	})

	Vitest.it("prefers last token counts on app-server v2 payloads", () => {
		const mapped = mapOne({
			jsonrpc: "2.0",
			method: "thread/tokenUsage/updated",
			params: {
				threadId: "thread-1",
				turnId: "turn-1",
				tokenUsage: {
					total: {
						inputTokens: 9000,
						totalTokens: 9130
					},
					last: {
						inputTokens: 2100,
						cachedInputTokens: 1600,
						outputTokens: 70,
						reasoningOutputTokens: 20,
						totalTokens: 2170
					},
					modelContextWindow: 258400
				}
			}
		})
		if (mapped.facts[0]?.contractKind === "usage") {
			Vitest.assert.strictEqual(mapped.facts[0].totalTokens, 2170)
			Vitest.assert.strictEqual(mapped.facts[0].inputTokens, 2100)
			Vitest.assert.isTrue((mapped.facts[0].eventId ?? "").includes("total=2170"))
		}
	})

	Vitest.it("ignores account rate limit updates", () => {
		const mapped = mapOne({
			jsonrpc: "2.0",
			method: "account/rateLimits/updated",
			params: {
				rateLimits: { planType: "pro" }
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, Arr.empty())
	})

	Vitest.it("tags punctuation-only text deltas as boundary carryover", () => {
		Vitest.assert.deepStrictEqual(
			classifyChunkAggregationHint("."),
			Option.some("boundary_carryover")
		)
		const mapped = mapOne({
			jsonrpc: "2.0",
			method: "item/agentMessage/delta",
			params: {
				itemId: "msg-1",
				delta: "."
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, [
			{
				contractKind: "text_delta",
				token: ".",
				aggregationHint: "boundary_carryover"
			}
		])
	})
})

const notificationMentionsCodexMethod = (notification: Json): boolean => {
	const encoded = Schema.encodeUnknownExit(Schema.fromJsonString(Schema.Json))(notification)
	if (Exit.isFailure(encoded)) {
		return false
	}
	return encoded.value.includes("item/agentMessage/delta")
}

Vitest.layer(Platform)("harness fixtures", (it) => {
	it.effect("finds no recorded Codex fixture in packages/harness/fixtures", () =>
		Effect.gen(function*() {
			const claudePath = yield* referenceFixturePath()
			const tracerPath = yield* tracerBulletFixturePath()
			const claude = yield* loadFixture(claudePath)
			const tracer = yield* loadFixture(tracerPath)
			const claudeHasCodex = Arr.some(claude, (exchange) =>
				Arr.some(exchange.notifications, notificationMentionsCodexMethod)
			)
			const tracerHasCodex = Arr.some(tracer, (exchange) =>
				Arr.some(exchange.notifications, notificationMentionsCodexMethod)
			)
			Vitest.assert.strictEqual(claudeHasCodex, false)
			Vitest.assert.strictEqual(tracerHasCodex, false)
			Vitest.assert.isTrue(claude.length > 0)
			Vitest.assert.isTrue(tracer.length > 0)
		})
	)
})
