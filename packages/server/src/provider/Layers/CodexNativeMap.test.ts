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
	decodeContractFact,
	emptyCodexMapState,
	encodeContractFact,
	mapCodexServerMessage,
	providerSessionFact
} from "./CodexNativeMap.ts"

type Json = typeof Schema.Json.Type
type JsonObject = typeof Schema.JsonObject.Type

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const jsonObject = (value: JsonObject): JsonObject => value

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

	Vitest.it("maps commandExecution item/started into an execute tool_call", () => {
		const mapped = mapOne(
			{
				method: "item/started",
				params: {
					item: {
						id: "call_abc123",
						type: "commandExecution",
						command: "/bin/zsh -lc 'git status'",
						commandActions: [{ command: "git status", type: "unknown" }],
						cwd: "/tmp",
						status: "inProgress"
					}
				}
			},
			"session-codex-1"
		)
		Vitest.assert.deepStrictEqual(mapped.facts, [
			{
				contractKind: "tool_call",
				toolCallId: "call_abc123",
				title: "git status",
				kind: "execute",
				status: "in_progress",
				rawInput: jsonObject({ command: "git status" })
			}
		])
	})

	Vitest.it("maps commandExecution item/completed into a tool_call_update", () => {
		const mapped = mapOne({
			method: "item/completed",
			params: {
				item: {
					id: "call_abc123",
					type: "commandExecution",
					commandActions: [{ command: "git status" }],
					status: "completed",
					exitCode: 0,
					aggregatedOutput: "On branch main\nnothing to commit"
				}
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, [
			{
				contractKind: "tool_call_update",
				toolCallId: "call_abc123",
				status: "completed",
				title: "git status",
				result: "On branch main\nnothing to commit"
			}
		])
	})

	Vitest.it("maps failed command completion to failed status with exitCode fallback", () => {
		const mapped = mapOne({
			method: "item/completed",
			params: {
				item: {
					id: "call_fail1",
					type: "commandExecution",
					commandActions: [{ command: "false" }],
					status: "failed",
					exitCode: 1,
					aggregatedOutput: null
				}
			}
		})
		Vitest.assert.strictEqual(mapped.facts[0]?.contractKind, "tool_call_update")
		if (mapped.facts[0]?.contractKind === "tool_call_update") {
			Vitest.assert.strictEqual(mapped.facts[0].status, "failed")
			Vitest.assert.deepStrictEqual(mapped.facts[0].result, { exitCode: 1 })
		}
	})

	Vitest.it("maps fileRead and fileChange item types", () => {
		const read = mapOne({
			method: "item/started",
			params: {
				item: {
					id: "call_read1",
					type: "fileRead",
					filePath: "/tmp/example.rs",
					status: "inProgress"
				}
			}
		})
		Vitest.assert.deepStrictEqual(read.facts[0], {
			contractKind: "tool_call",
			toolCallId: "call_read1",
			title: "Read /tmp/example.rs",
			kind: "read",
			status: "in_progress",
			rawInput: jsonObject({ filePath: "/tmp/example.rs" })
		})
		const edit = mapOne({
			method: "item/started",
			params: {
				item: {
					id: "call_edit1",
					type: "fileChange",
					filePath: "/tmp/example.rs",
					status: "inProgress"
				}
			}
		})
		Vitest.assert.strictEqual(edit.facts[0]?.contractKind, "tool_call")
		if (edit.facts[0]?.contractKind === "tool_call") {
			Vitest.assert.strictEqual(edit.facts[0].kind, "edit")
			Vitest.assert.strictEqual(edit.facts[0].title, "Edit /tmp/example.rs")
		}
	})

	Vitest.it("maps other tool types and ignores non-tool item/started types", () => {
		const search = mapOne({
			method: "item/started",
			params: {
				item: {
					id: "call_search1",
					type: "fileSearch",
					title: "Searching for main",
					query: "main",
					status: "inProgress"
				}
			}
		})
		Vitest.assert.strictEqual(search.facts[0]?.contractKind, "tool_call")
		if (search.facts[0]?.contractKind === "tool_call") {
			Vitest.assert.strictEqual(search.facts[0].kind, "other")
			Vitest.assert.strictEqual(search.facts[0].title, "Searching for main")
		}
		for (const itemType of ["userMessage", "reasoning", "agentMessage"]) {
			const mapped = mapOne({
				method: "item/started",
				params: {
					item: {
						id: "msg-1",
						type: itemType
					}
				}
			})
			Vitest.assert.deepStrictEqual(mapped.facts, Arr.empty())
		}
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

Vitest.describe("Codex contract fact codec", () => {
	Vitest.it("round-trips a provider session fact", () => {
		const fact = providerSessionFact("thread-1")
		const encoded = encodeContractFact(fact)
		Vitest.assert.isTrue(Option.isSome(encoded))
		if (Option.isSome(encoded)) {
			Vitest.assert.deepStrictEqual(decodeContractFact(encoded.value), Option.some(fact))
		}
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
