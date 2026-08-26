import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { encodeContractFact } from "./Codec.ts"
import { emptyOpenCodeStreamState, mapSseJson, mapSseText } from "./Map.ts"
import { consumeSseLine, emptySseLineFold } from "./Wire.ts"

type Json = typeof Schema.Json.Type

const mapOnce = (raw: Json) => mapSseJson(emptyOpenCodeStreamState, raw)

Vitest.describe("mapSseJson", () => {
	Vitest.it("maps text part deltas and multiplexed envelopes", () => {
		const mapped = mapOnce({
			directory: "/tmp/project",
			payload: {
				type: "message.part.updated",
				properties: {
					part: {
						id: "prt_123",
						sessionID: "ses_abc",
						messageID: "msg_456",
						type: "text",
						text: "Hello, how can I help?"
					},
					delta: "Hello"
				}
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, [
			{
				contractKind: "text_delta",
				token: "Hello"
			}
		])
	})

	Vitest.it("maps reasoning parts to thought deltas", () => {
		const mapped = mapOnce({
			type: "message.part.updated",
			properties: {
				part: {
					id: "prt_reason",
					sessionID: "ses_abc",
					messageID: "msg_456",
					type: "reasoning",
					text: "Let me analyze this problem..."
				},
				delta: "Let me analyze"
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, [
			{
				contractKind: "thought_delta",
				token: "Let me analyze"
			}
		])
	})

	Vitest.it("filters user text parts", () => {
		const mapped = mapOnce({
			type: "message.part.updated",
			properties: {
				part: {
					id: "prt_user",
					sessionID: "ses_abc",
					messageID: "msg_user",
					type: "text",
					text: "hi",
					role: "user"
				}
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, Arr.empty())
	})

	Vitest.it("maps tool-invocation and OpenCode tool parts", () => {
		const invocation = mapOnce({
			type: "message.part.updated",
			properties: {
				part: {
					id: "call_func_1",
					sessionID: "ses_abc",
					messageID: "msg_456",
					type: "tool-invocation",
					name: "bash",
					arguments: {
						command: "ls -la"
					}
				}
			}
		})
		Vitest.assert.strictEqual(invocation.facts[0]?.contractKind, "tool_call")
		if (invocation.facts[0]?.contractKind === "tool_call") {
			Vitest.assert.strictEqual(invocation.facts[0].toolCallId, "call_func_1")
			Vitest.assert.strictEqual(invocation.facts[0].kind, "execute")
		}
		const native = mapOnce({
			type: "message.part.updated",
			properties: {
				part: {
					id: "prt_abc123",
					sessionID: "ses_abc",
					messageID: "msg_456",
					type: "tool",
					callID: "call_webfetch_1",
					tool: "webfetch",
					state: {
						status: "pending",
						input: {
							url: "https://example.com"
						}
					}
				}
			}
		})
		Vitest.assert.strictEqual(native.facts[0]?.contractKind, "tool_call")
		if (native.facts[0]?.contractKind === "tool_call") {
			Vitest.assert.strictEqual(native.facts[0].toolCallId, "call_webfetch_1")
			Vitest.assert.strictEqual(native.facts[0].kind, "fetch")
		}
	})

	Vitest.it("maps completed tool-result parts", () => {
		const mapped = mapOnce({
			type: "message.part.updated",
			properties: {
				part: {
					id: "call_func_1",
					sessionID: "ses_abc",
					messageID: "msg_456",
					type: "tool-result",
					state: {
						status: "completed",
						output: "file1.txt file2.txt"
					}
				}
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, [
			{
				contractKind: "tool_call_update",
				toolCallId: "call_func_1",
				status: "completed",
				output: "file1.txt file2.txt"
			}
		])
	})

	// #273: state.error is the failed tool call's result, so it lands in the
	// same field as state.output rather than in one of its own.
	Vitest.it("maps a failed tool part's error as the tool call's output", () => {
		const mapped = mapOnce({
			type: "message.part.updated",
			properties: {
				part: {
					id: "call_bash_1",
					sessionID: "ses_abc",
					messageID: "msg_456",
					type: "tool",
					callID: "call_bash_1",
					tool: "bash",
					state: {
						status: "error",
						error: "command not found: nope"
					}
				}
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, [
			{
				contractKind: "tool_call_update",
				toolCallId: "call_bash_1",
				status: "failed",
				output: "command not found: nope"
			}
		])
	})

	Vitest.it("maps permission.asked and question.asked", () => {
		const permission = mapOnce({
			type: "permission.asked",
			properties: {
				id: "perm_123",
				sessionID: "ses_abc",
				permission: "Read",
				patterns: ["*.txt", "*.md"],
				metadata: {},
				always: []
			}
		})
		Vitest.assert.strictEqual(permission.facts[0]?.contractKind, "permission_request")
		if (permission.facts[0]?.contractKind === "permission_request") {
			Vitest.assert.strictEqual(permission.facts[0].id, "perm_123")
			Vitest.assert.deepStrictEqual(permission.facts[0].patterns, ["*.txt", "*.md"])
		}
		const encoded = Option.flatMap(
			Arr.head(permission.facts),
			(fact) => encodeContractFact(fact)
		)
		Vitest.assert.isTrue(Option.isSome(encoded))
		const question = mapOnce({
			type: "question.asked",
			properties: {
				id: "ques_123",
				sessionID: "ses_abc",
				questions: [
					{
						question: "What should I do?",
						header: "What should I do?",
						options: [{ label: "Yes", description: "Proceed" }],
						multiSelect: false
					}
				]
			}
		})
		Vitest.assert.strictEqual(question.facts[0]?.contractKind, "question_request")
	})

	Vitest.it("maps session.idle and session.error", () => {
		Vitest.assert.deepStrictEqual(
			mapOnce({
				type: "session.idle",
				properties: { sessionID: "ses_abc" }
			}).facts,
			[{ contractKind: "turn_complete" }]
		)
		const error = mapOnce({
			type: "session.error",
			properties: {
				sessionID: "ses_abc",
				error: { message: "Something went wrong" }
			}
		})
		Vitest.assert.deepStrictEqual(error.facts, [
			{
				contractKind: "turn_error",
				detail: "Something went wrong"
			}
		])
	})

	Vitest.it("maps step-finish parts to usage", () => {
		const mapped = mapOnce({
			type: "message.part.updated",
			properties: {
				part: {
					id: "prt_step_finish_1",
					sessionID: "ses_telemetry",
					messageID: "msg_789",
					type: "step-finish",
					cost: 0.0025,
					tokens: {
						total: 1500,
						input: 1000,
						output: 500,
						cacheRead: 0,
						cacheWrite: 0
					}
				}
			}
		})
		Vitest.assert.strictEqual(mapped.facts[0]?.contractKind, "usage")
		if (mapped.facts[0]?.contractKind === "usage") {
			Vitest.assert.strictEqual(mapped.facts[0].costUsd, 0.0025)
			Vitest.assert.strictEqual(mapped.facts[0].totalTokens, 1500)
		}
	})

	Vitest.it("ignores heartbeat events", () => {
		const mapped = mapOnce({
			type: "server.heartbeat",
			properties: {}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, Arr.empty())
	})

	Vitest.it("folds SSE data lines into one JSON event", () => {
		const first = consumeSseLine(emptySseLineFold, 'data: {"type":"session.idle","properties":{"sessionID":"ses_1"}}')
		Vitest.assert.strictEqual(Option.isNone(first.raw), true)
		const second = consumeSseLine(first.fold, "")
		Vitest.assert.isTrue(Option.isSome(second.raw))
		if (Option.isSome(second.raw)) {
			const mapped = mapSseText(emptyOpenCodeStreamState, second.raw.value)
			Vitest.assert.strictEqual(mapped.facts[0]?.contractKind, "turn_complete")
		}
	})
})
