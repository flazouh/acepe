import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Schema from "effect/Schema"
import { emptyCodexMapState, mapCodexServerMessage } from "./Map.ts"

type Json = typeof Schema.Json.Type
type JsonObject = typeof Schema.JsonObject.Type

const jsonObject = (value: JsonObject): JsonObject => value

const mapOne = (message: Json, sessionId = "session-1") =>
	mapCodexServerMessage(emptyCodexMapState, sessionId, message)

Vitest.describe("Codex tool taxonomy", () => {
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
})
