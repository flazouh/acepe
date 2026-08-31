import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import {
	grokModelsFromInitialize,
	mapAcpPermissionRequest,
	mapAcpSessionNotification
} from "./Map.ts"

const grokInitializeWithModels = {
	protocolVersion: 1,
	_meta: {
		modelState: {
			currentModelId: "grok-4.6",
			availableModels: [
				{
					modelId: "grok-4.6",
					name: "Grok 4.6",
					description: "SpaceXAI's latest frontier model"
				},
				{
					modelId: "grok-4.5",
					name: "Grok 4.5"
				}
			]
		}
	}
}

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
					{ content: "Spawn grok", status: "pending", priority: "medium" }
				]
			}
		})
		Vitest.assert.deepStrictEqual(
			fact,
			Option.some({
				contractKind: "plan_proposal",
				planMarkdown: "Inspect the registry\nSpawn grok"
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

Vitest.describe("grokModelsFromInitialize", () => {
	Vitest.it("reads the catalog Grok puts on initialize _meta.modelState", () => {
		const models = grokModelsFromInitialize(grokInitializeWithModels)
		Vitest.assert.deepStrictEqual(
			models,
			Option.some([
				{
					modelId: "grok-4.6",
					name: "Grok 4.6",
					description: "SpaceXAI's latest frontier model"
				},
				{
					modelId: "grok-4.5",
					name: "Grok 4.5",
					description: null
				}
			])
		)
	})

	Vitest.it("returns none when initialize carries no modelState", () => {
		Vitest.assert.deepStrictEqual(grokModelsFromInitialize({ protocolVersion: 1 }), Option.none())
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
})
