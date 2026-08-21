import {
	gradeExchanges,
	loadFixture,
	makeReport,
	referenceFixturePath,
	type CompletedExchange
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
	acpSessionUpdateToFact,
	contractFactToAcpSessionUpdate,
	decodeContractFact,
	detectClaudeToolKind,
	emptyClaudeStreamState,
	encodeContractFact,
	mapSdkMessage,
	permissionIdForToolCall,
	permissionRequestFact,
	planProposalFact,
	roundTripAcpSessionUpdate
} from "./ClaudeSdkMap.ts"

type Json = typeof Schema.Json.Type
type JsonObject = typeof Schema.JsonObject.Type

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const AcpSessionUpdateNotification = Schema.Struct({
	jsonrpc: Schema.String,
	method: Schema.String,
	params: Schema.Struct({
		sessionId: Schema.String,
		seq: Schema.Number,
		payload: Schema.Json
	})
})
const decodeNotification = Schema.decodeUnknownExit(AcpSessionUpdateNotification)

const jsonObject = (value: JsonObject): JsonObject => value

const remapNotification = (notification: Json): Json => {
	const decoded = decodeNotification(notification)
	if (Exit.isFailure(decoded) || decoded.value.method !== "acp-session-update") {
		return notification
	}
	const remapped = roundTripAcpSessionUpdate(decoded.value.params.payload)
	Vitest.assert.isTrue(Option.isSome(remapped))
	if (Option.isNone(remapped)) {
		return notification
	}
	return {
		jsonrpc: decoded.value.jsonrpc,
		method: decoded.value.method,
		params: {
			sessionId: decoded.value.params.sessionId,
			seq: decoded.value.params.seq,
			payload: remapped.value
		}
	}
}

Vitest.describe("detectClaudeToolKind", () => {
	Vitest.it("maps Read and Bash to ACP kinds used by the reference fixture", () => {
		Vitest.assert.strictEqual(detectClaudeToolKind("Read"), "read")
		Vitest.assert.strictEqual(detectClaudeToolKind("Bash"), "execute")
		Vitest.assert.strictEqual(detectClaudeToolKind("ExitPlanMode"), "exit_plan_mode")
		Vitest.assert.strictEqual(detectClaudeToolKind("mcp__server__Read"), "read")
	})
})

Vitest.describe("mapSdkMessage", () => {
	Vitest.it("maps stream text deltas and promotes the first durable session id", () => {
		const mapped = mapSdkMessage(emptyClaudeStreamState, {
			type: "stream_event",
			session_id: "sdk-session-1",
			event: {
				type: "content_block_delta",
				delta: {
					type: "text_delta",
					text: "Hello"
				}
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, [
			{
				contractKind: "provider_session",
				providerSessionId: "sdk-session-1"
			},
			{
				contractKind: "text_delta",
				token: "Hello"
			}
		])
		Vitest.assert.strictEqual(mapped.state.sawTextDelta, true)
	})

	Vitest.it("skips assistant text when stream deltas were already seen", () => {
		const afterStream = mapSdkMessage(emptyClaudeStreamState, {
			type: "stream_event",
			event: {
				type: "content_block_delta",
				delta: {
					type: "text_delta",
					text: "Hi"
				}
			}
		})
		const afterAssistant = mapSdkMessage(afterStream.state, {
			type: "assistant",
			message: {
				content: [
					{
						type: "text",
						text: "Hi duplicated"
					}
				]
			}
		})
		Vitest.assert.deepStrictEqual(afterAssistant.facts, Arr.empty())
	})

	Vitest.it("maps stream tool_use start and input json deltas", () => {
		const started = mapSdkMessage(emptyClaudeStreamState, {
			type: "stream_event",
			event: {
				type: "content_block_start",
				index: 0,
				content_block: {
					type: "tool_use",
					id: "toolu_01ReadTool",
					name: "Read",
					input: {
						file_path: "/tmp/a.ts"
					}
				}
			}
		})
		Vitest.assert.deepStrictEqual(started.facts, [
			{
				contractKind: "tool_call",
				toolCallId: "toolu_01ReadTool",
				title: "Read",
				kind: "read",
				status: "in_progress",
				rawInput: jsonObject({ file_path: "/tmp/a.ts" })
			}
		])
		const updated = mapSdkMessage(started.state, {
			type: "stream_event",
			event: {
				type: "content_block_delta",
				index: 0,
				delta: {
					type: "input_json_delta",
					partial_json: "{\"file_path\""
				}
			}
		})
		Vitest.assert.deepStrictEqual(updated.facts, [
			{
				contractKind: "tool_call_update",
				toolCallId: "toolu_01ReadTool",
				partialJson: "{\"file_path\""
			}
		])
	})

	Vitest.it("maps compact_boundary to a completed compaction fact", () => {
		const mapped = mapSdkMessage(emptyClaudeStreamState, {
			type: "system",
			subtype: "compact_boundary",
			session_id: "sdk-session-1",
			compactMetadata: {
				eventId: "compact-1",
				trigger: "auto",
				preCompactionTokens: 100,
				postCompactionTokens: 40,
				durationMs: 12,
				preservedMessageCount: 3,
				cumulativeDroppedTokens: 60,
				timestampMs: 1786956901034
			},
			providerMetadata: {
				source: "compact_boundary"
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, [
			{
				contractKind: "provider_session",
				providerSessionId: "sdk-session-1"
			},
			{
				contractKind: "compaction",
				eventId: "compact-1",
				sessionId: "sdk-session-1",
				status: "completed",
				trigger: "auto",
				preCompactionTokens: 100,
				postCompactionTokens: 40,
				durationMs: 12,
				preservedMessageCount: 3,
				cumulativeDroppedTokens: 60,
				timestampMs: 1786956901034,
				providerMetadata: jsonObject({ source: "compact_boundary" })
			}
		])
	})

	Vitest.it("maps usage_update with compaction true to usage plus usage_reset", () => {
		const mapped = mapSdkMessage(emptyClaudeStreamState, {
			type: "system",
			subtype: "usage_update",
			session_id: "sdk-session-1",
			compaction: true,
			usage: {
				input_tokens: 10,
				output_tokens: 4
			}
		})
		Vitest.assert.strictEqual(mapped.facts[1]?.contractKind, "usage")
		Vitest.assert.strictEqual(mapped.facts[2]?.contractKind, "compaction")
		if (mapped.facts[2]?.contractKind === "compaction") {
			Vitest.assert.strictEqual(mapped.facts[2].status, "usage_reset")
		}
	})

	Vitest.it("maps ExitPlanMode input.plan to a plan proposal", () => {
		const mapped = mapSdkMessage(emptyClaudeStreamState, {
			type: "assistant",
			message: {
				content: [
					{
						type: "tool_use",
						id: "toolu_01Plan",
						name: "ExitPlanMode",
						input: {
							plan: "# Ship it"
						}
					}
				]
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, [
			planProposalFact({
				planMarkdown: "# Ship it",
				toolCallId: "toolu_01Plan"
			})
		])
	})

	Vitest.it("ignores hook system subtypes for durable session promotion", () => {
		const mapped = mapSdkMessage(emptyClaudeStreamState, {
			type: "system",
			subtype: "hook_started",
			session_id: "hook-session"
		})
		Vitest.assert.deepStrictEqual(mapped.facts, Arr.empty())
		Vitest.assert.strictEqual(Option.isNone(mapped.state.providerSessionId), true)
	})

	Vitest.it("maps a successful result to usage and turn_complete", () => {
		const mapped = mapSdkMessage(emptyClaudeStreamState, {
			type: "result",
			session_id: "sdk-session-1",
			is_error: false,
			usage: {
				input_tokens: 2,
				output_tokens: 3
			}
		})
		Vitest.assert.strictEqual(mapped.facts[0]?.contractKind, "provider_session")
		Vitest.assert.strictEqual(mapped.facts[1]?.contractKind, "usage")
		Vitest.assert.strictEqual(mapped.facts[2]?.contractKind, "turn_complete")
	})
})

Vitest.describe("permissionRequestFact", () => {
	Vitest.it("uses perm-${toolCallId} and execute for Bash", () => {
		const fact = permissionRequestFact({
			sessionId: "acepe-session",
			toolCallId: "toolu_019U69moXgmcywxcQwgzbmPZ",
			toolName: "Bash"
		})
		Vitest.assert.strictEqual(
			fact.id,
			permissionIdForToolCall("toolu_019U69moXgmcywxcQwgzbmPZ")
		)
		Vitest.assert.strictEqual(fact.permission, "execute")
		const encoded = encodeContractFact(fact)
		Vitest.assert.isTrue(Option.isSome(encoded))
		if (Option.isSome(encoded)) {
			Vitest.assert.deepStrictEqual(decodeContractFact(encoded.value), Option.some(fact))
		}
	})
})

Vitest.describe("ACP session-update codec", () => {
	Vitest.it("round-trips the reference compaction payload", () => {
		const payload = jsonObject({
			type: "compactionEvent",
			event: {
				eventId: "596f3dc8-3c16-4768-afe0-c87d75fd8cfa",
				sessionId: "81fde13c-1b27-4552-8b90-25b04c88aa50",
				status: "completed",
				trigger: "auto",
				preCompactionTokens: 999455,
				postCompactionTokens: 25288,
				durationMs: 117657,
				preservedMessageCount: 16,
				cumulativeDroppedTokens: 2917434,
				timestampMs: 1786956901034,
				providerMetadata: {
					source: "compact_boundary",
					uuid: "596f3dc8-3c16-4768-afe0-c87d75fd8cfa"
				}
			}
		})
		const fact = acpSessionUpdateToFact(payload)
		Vitest.assert.isTrue(Option.isSome(fact))
		if (Option.isSome(fact)) {
			Vitest.assert.deepStrictEqual(contractFactToAcpSessionUpdate(fact.value), payload)
		}
	})
})

Vitest.layer(Platform)("claude-session-reference fixture", (it) => {
	it.effect("grades reconstructed ACP session updates at 100 percent", () =>
		Effect.gen(function*() {
			const filePath = yield* referenceFixturePath()
			const exchanges = yield* loadFixture(filePath)
			const actuals = yield* Effect.forEach(exchanges, (exchange) =>
				Effect.gen(function*() {
					const notifications = Arr.map(exchange.notifications, remapNotification)
					const completed: CompletedExchange = {
						command: exchange.command,
						payload: exchange.payload,
						response: exchange.response,
						notifications
					}
					return Option.some(completed)
				})
			)
			const grades = gradeExchanges(exchanges, actuals, Arr.empty())
			const report = makeReport("claude-session-reference.ndjson", grades)
			Vitest.assert.strictEqual(report.fail, 0)
			Vitest.assert.strictEqual(report.pass, exchanges.length)
			Vitest.assert.strictEqual(report.skipped, 0)
		})
	)
})
