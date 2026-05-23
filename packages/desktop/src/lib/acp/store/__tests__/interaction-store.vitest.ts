import { describe, expect, it } from "vitest";

import type { InteractionSnapshot } from "../../../services/acp-types.js";
import { InteractionStore } from "../interaction-store.svelte.js";

function createPendingPermissionInteraction(overrides?: Partial<InteractionSnapshot>): InteractionSnapshot {
	const id = overrides?.id ?? "permission-1";
	const sessionId = overrides?.session_id ?? "session-1";
	return {
		id,
		session_id: sessionId,
		kind: "Permission",
		state: "Pending",
		json_rpc_request_id: 41,
		reply_handler: { kind: "json_rpc", requestId: "41" },
		tool_reference: { messageId: "message-1", callId: "tool-1" },
		responded_at_event_seq: null,
		response: null,
		payload: {
			Permission: {
				id,
				sessionId,
				jsonRpcRequestId: 41,
				replyHandler: { kind: "json_rpc", requestId: "41" },
				permission: "Execute",
				patterns: ["git status"],
				metadata: {
					diagnosticRawInput: { command: "git status" },
					options: [],
				},
				always: [],
				autoAccepted: false,
				tool: { messageId: "message-1", callId: "tool-1" },
			},
		},
		canonical_operation_id: "operation-1",
		...overrides,
	};
}

function createPendingQuestionInteraction(overrides?: Partial<InteractionSnapshot>): InteractionSnapshot {
	const id = overrides?.id ?? "question-1";
	const sessionId = overrides?.session_id ?? "session-1";
	return {
		id,
		session_id: sessionId,
		kind: "Question",
		state: "Pending",
		json_rpc_request_id: 42,
		reply_handler: { kind: "json_rpc", requestId: "42" },
		tool_reference: { messageId: "message-2", callId: "tool-2" },
		responded_at_event_seq: null,
		response: null,
		payload: {
			Question: {
				id,
				sessionId,
				jsonRpcRequestId: 42,
				replyHandler: { kind: "json_rpc", requestId: "42" },
				questions: [
					{
						question: "Pick a target",
						header: "Target",
						options: [
							{ label: "Main", description: "Use the main target" },
							{ label: "Test", description: "Use the test target" },
						],
						multiSelect: false,
					},
				],
				tool: { messageId: "message-2", callId: "tool-2" },
			},
		},
		canonical_operation_id: "operation-2",
		...overrides,
	};
}

describe("InteractionStore", () => {
	it("preserves pending permission identity for duplicate patches", () => {
		const store = new InteractionStore();
		store.applySessionInteractionPatches([createPendingPermissionInteraction()]);

		const firstPermission = store.permissionsPending.get("permission-1");
		const firstSessionPermissions = store.getPendingPermissionsForSession("session-1");

		store.applySessionInteractionPatches([createPendingPermissionInteraction()]);

		expect(store.permissionsPending.get("permission-1")).toBe(firstPermission);
		expect(store.getPendingPermissionsForSession("session-1")).toBe(firstSessionPermissions);
	});

	it("preserves pending question identity for duplicate patches", () => {
		const store = new InteractionStore();
		store.applySessionInteractionPatches([createPendingQuestionInteraction()]);

		const firstQuestion = store.questionsPending.get("question-1");
		const firstSessionQuestions = store.getPendingQuestionsForSession("session-1");

		store.applySessionInteractionPatches([createPendingQuestionInteraction()]);

		expect(store.questionsPending.get("question-1")).toBe(firstQuestion);
		expect(store.getPendingQuestionsForSession("session-1")).toBe(firstSessionQuestions);
	});

	it("appends cached pending questions without rebuilding the session list", () => {
		const store = new InteractionStore();
		store.applySessionInteractionPatches([createPendingQuestionInteraction()]);
		const firstSessionQuestions = store.getPendingQuestionsForSession("session-1");
		const originalMapValues = Map.prototype.values;

		Map.prototype.values = function patchedValues() {
			throw new Error("must not rebuild pending interaction values");
		};

		try {
			store.applySessionInteractionPatches([
				createPendingQuestionInteraction({
					id: "question-2",
					json_rpc_request_id: 43,
					payload: {
						Question: {
							id: "question-2",
							sessionId: "session-1",
							jsonRpcRequestId: 43,
							replyHandler: { kind: "json_rpc", requestId: "43" },
							questions: [
								{
									question: "Pick another target",
									header: "Target",
									options: [{ label: "Docs", description: "Use docs" }],
									multiSelect: false,
								},
							],
							tool: { messageId: "message-3", callId: "tool-3" },
						},
					},
				}),
			]);

			const nextSessionQuestions = store.getPendingQuestionsForSession("session-1");
			expect(nextSessionQuestions).not.toBe(firstSessionQuestions);
			expect(nextSessionQuestions.map((question) => question.id)).toEqual([
				"question-1",
				"question-2",
			]);
			expect(nextSessionQuestions[0]).toBe(firstSessionQuestions[0]);
		} finally {
			Map.prototype.values = originalMapValues;
		}
	});
});
