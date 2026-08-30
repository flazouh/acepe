import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import type { JsonObject } from "../Json.ts"
import { decodeContractFact, encodeContractFact } from "./Codec.ts"
import { planProposalFact } from "./Facts.ts"
import { emptyClaudeStreamState, mapSdkMessage, permissionRequestFact } from "./Map.ts"
import { permissionIdForToolCall } from "./Tools.ts"

const jsonObject = (value: JsonObject): JsonObject => value

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
				title: "Read /tmp/a.ts",
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

	Vitest.it("falls back to the bare tool name when no input hint is available", () => {
		const started = mapSdkMessage(emptyClaudeStreamState, {
			type: "stream_event",
			event: {
				type: "content_block_start",
				index: 0,
				content_block: {
					type: "tool_use",
					id: "toolu_01Todo",
					name: "TodoWrite",
					input: {}
				}
			}
		})
		Vitest.assert.strictEqual(started.facts[0]?.contractKind, "tool_call")
		if (started.facts[0]?.contractKind === "tool_call") {
			Vitest.assert.strictEqual(started.facts[0].title, "TodoWrite")
		}
	})

	Vitest.it("titles an execute tool call with the bare command, no name prefix", () => {
		const mapped = mapSdkMessage(emptyClaudeStreamState, {
			type: "assistant",
			message: {
				content: [
					{
						type: "tool_use",
						id: "toolu_01Bash",
						name: "Bash",
						input: { command: "git status" }
					}
				]
			}
		})
		Vitest.assert.strictEqual(mapped.facts[0]?.contractKind, "tool_call")
		if (mapped.facts[0]?.contractKind === "tool_call") {
			Vitest.assert.strictEqual(mapped.facts[0].title, "git status")
		}
	})

	// Reproduces the second half of the live QA bug: a real Claude tool call's
	// RESULT arrives as a `user`-typed SDK message (Anthropic's own API shape
	// feeds tool_result back as a user turn), which mapSdkMessage never
	// parsed at all -- so the tool call's status never advanced past
	// "in_progress" no matter how Session.ts routed the fact.
	Vitest.it("maps a user message's tool_result block to a completed tool_call_update", () => {
		const mapped = mapSdkMessage(emptyClaudeStreamState, {
			type: "user",
			session_id: "sdk-session-1",
			message: {
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_01ReadTool",
						content: "file contents",
						is_error: false
					}
				]
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, [
			{
				contractKind: "provider_session",
				providerSessionId: "sdk-session-1"
			},
			{
				contractKind: "tool_call_update",
				toolCallId: "toolu_01ReadTool",
				status: "completed",
				output: "file contents"
			}
		])
	})

	// #273: the result a tool produced lives in the tool_result block's own
	// content, and the map used to read only tool_use_id and is_error out of
	// that block -- so a Bash row in the panel showed a title and nothing the
	// command actually printed.
	Vitest.it("carries a string tool_result content onto the update fact as output", () => {
		const mapped = mapSdkMessage(emptyClaudeStreamState, {
			type: "user",
			message: {
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_01BashTool",
						content: "acepe-map-probe\n",
						is_error: false
					}
				]
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, [
			{
				contractKind: "tool_call_update",
				toolCallId: "toolu_01BashTool",
				status: "completed",
				output: "acepe-map-probe"
			}
		])
	})

	// The SDK sends a tool result either as a bare string or as the Messages
	// API's own block array. Both are the same result.
	Vitest.it("joins the text blocks of an array tool_result content", () => {
		const mapped = mapSdkMessage(emptyClaudeStreamState, {
			type: "user",
			message: {
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_01BashTool",
						content: [
							{ type: "text", text: "first line" },
							{ type: "image", source: { type: "base64", data: "ignored" } },
							{ type: "text", text: "second line" }
						],
						is_error: false
					}
				]
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, [
			{
				contractKind: "tool_call_update",
				toolCallId: "toolu_01BashTool",
				status: "completed",
				output: "first line\nsecond line"
			}
		])
	})

	// A failure's text IS the result: "Command failed" with nothing under it
	// was the exact bug report.
	Vitest.it("carries a failing tool_result's content as the update fact's output", () => {
		const mapped = mapSdkMessage(emptyClaudeStreamState, {
			type: "user",
			message: {
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_01BashTool",
						content: "zsh: command not found: nope",
						is_error: true
					}
				]
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, [
			{
				contractKind: "tool_call_update",
				toolCallId: "toolu_01BashTool",
				status: "failed",
				output: "zsh: command not found: nope"
			}
		])
	})

	// An empty result is an absent one, not an empty string: the fact key
	// stays off so the observation travels output: null.
	Vitest.it("omits output when a tool_result carries no content", () => {
		const mapped = mapSdkMessage(emptyClaudeStreamState, {
			type: "user",
			message: {
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_01BashTool",
						is_error: false
					}
				]
			}
		})
		Vitest.assert.deepStrictEqual(mapped.facts, [
			{
				contractKind: "tool_call_update",
				toolCallId: "toolu_01BashTool",
				status: "completed"
			}
		])
	})

	// Half one of the same bug: the arguments the panel needs to show a Bash
	// command, or the content a Write proposes, ride on the tool_call fact.
	Vitest.it("carries a Bash tool call's command and a Write's content as rawInput", () => {
		const mapped = mapSdkMessage(emptyClaudeStreamState, {
			type: "assistant",
			message: {
				content: [
					{
						type: "tool_use",
						id: "toolu_01BashTool",
						name: "Bash",
						input: { command: "echo acepe-map-probe", description: "probe" }
					},
					{
						type: "tool_use",
						id: "toolu_01WriteTool",
						name: "Write",
						input: { file_path: "/tmp/acepe/probe.txt", content: "proposed body" }
					}
				]
			}
		})
		Vitest.assert.strictEqual(mapped.facts[0]?.contractKind, "tool_call")
		if (mapped.facts[0]?.contractKind === "tool_call") {
			Vitest.assert.deepStrictEqual(mapped.facts[0].rawInput, {
				command: "echo acepe-map-probe",
				description: "probe"
			})
		}
		Vitest.assert.strictEqual(mapped.facts[1]?.contractKind, "tool_call")
		if (mapped.facts[1]?.contractKind === "tool_call") {
			Vitest.assert.deepStrictEqual(mapped.facts[1].rawInput, {
				file_path: "/tmp/acepe/probe.txt",
				content: "proposed body"
			})
		}
	})

	Vitest.it("maps a user message's failing tool_result block to a failed tool_call_update", () => {
		const mapped = mapSdkMessage(emptyClaudeStreamState, {
			type: "user",
			message: {
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_01BashTool",
						content: "command not found",
						is_error: true
					}
				]
			}
		})
		Vitest.assert.strictEqual(mapped.facts[0]?.contractKind, "tool_call_update")
		if (mapped.facts[0]?.contractKind === "tool_call_update") {
			Vitest.assert.strictEqual(mapped.facts[0].status, "failed")
		}
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

	// The CLI reports a signed-out account as an ordinary reply on a turn
	// that then completes, so the auth state must be promoted to a typed
	// fact HERE, at the transport edge -- nothing downstream matches UI
	// strings. Found live: the whole turn was "Not logged in · Please run
	// /login" and the app rendered it as a normal answer.
	Vitest.it("promotes a not-logged-in result to an auth_required fact", () => {
		const mapped = mapSdkMessage(emptyClaudeStreamState, {
			type: "result",
			session_id: "sdk-session-1",
			is_error: false,
			result: "Not logged in · Please run /login"
		})
		Vitest.assert.deepStrictEqual(
			mapped.facts.map((fact) => fact.contractKind),
			["provider_session", "auth_required", "turn_complete"]
		)
	})

	Vitest.it("promotes a not-logged-in error result to auth_required before the turn_error", () => {
		const mapped = mapSdkMessage(emptyClaudeStreamState, {
			type: "result",
			session_id: "sdk-session-1",
			is_error: true,
			result: "Not logged in · Please run /login"
		})
		Vitest.assert.deepStrictEqual(
			mapped.facts.map((fact) => fact.contractKind),
			["provider_session", "auth_required", "turn_error"]
		)
	})

	Vitest.it("does not read an ordinary reply mentioning login as signed-out", () => {
		const mapped = mapSdkMessage(emptyClaudeStreamState, {
			type: "result",
			session_id: "sdk-session-1",
			is_error: false,
			result: "You can log in to the dashboard with your SSO account."
		})
		Vitest.assert.deepStrictEqual(
			mapped.facts.map((fact) => fact.contractKind),
			["provider_session", "turn_complete"]
		)
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
