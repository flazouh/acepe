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

function createPendingPlanApprovalInteraction(
	overrides?: Partial<InteractionSnapshot>
): InteractionSnapshot {
	const id = overrides?.id ?? "plan-approval-1";
	const sessionId = overrides?.session_id ?? "session-1";
	return {
		id,
		session_id: sessionId,
		kind: "PlanApproval",
		state: "Pending",
		json_rpc_request_id: 43,
		reply_handler: { kind: "json_rpc", requestId: "43" },
		tool_reference: { messageId: "message-3", callId: "tool-3" },
		responded_at_event_seq: null,
		response: null,
		payload: {
			PlanApproval: {
				source: "CreatePlan",
			},
		},
		canonical_operation_id: "operation-3",
		...overrides,
	};
}

function createPendingComputerPermissionInteraction(
	overrides?: Partial<InteractionSnapshot>
): InteractionSnapshot {
	const id = overrides?.id ?? "computer-permission-1";
	const sessionId = overrides?.session_id ?? "session-1";
	return {
		id,
		session_id: sessionId,
		kind: overrides?.kind ?? "ComputerPermission",
		state: overrides?.state ?? "Pending",
		json_rpc_request_id: overrides?.json_rpc_request_id ?? null,
		reply_handler: overrides?.reply_handler ?? null,
		tool_reference: overrides?.tool_reference ?? {
			messageId: null,
			callId: "computer-tool-1",
		},
		responded_at_event_seq: overrides?.responded_at_event_seq ?? null,
		response: overrides?.response ?? null,
		payload: overrides?.payload ?? {
			ComputerPermission: {
				id,
				session_id: sessionId,
				permission_kind: "accessibility",
				reason: "Acepe needs macOS Accessibility permission.",
				tool: { messageId: null, callId: "computer-tool-1" },
			},
		},
		canonical_operation_id: overrides?.canonical_operation_id ?? "operation-computer-1",
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

	it("preserves the canonical operation id on pending plan approvals", () => {
		const store = new InteractionStore();

		store.applySessionInteractionPatches([createPendingPlanApprovalInteraction()]);

		const approval = store.getPendingPlanApprovalsForSession("session-1")[0];
		expect(approval?.canonicalOperationId).toBe("operation-3");
	});

	it("indexes pending computer permissions by session without treating them as provider permissions", () => {
		const store = new InteractionStore();

		store.applySessionInteractionPatches([createPendingComputerPermissionInteraction()]);

		expect(store.permissionsPending.size).toBe(0);
		const permission = store.getPendingComputerPermissionsForSession("session-1")[0];
		expect(permission).toEqual({
			id: "computer-permission-1",
			kind: "computer_permission",
			sessionId: "session-1",
			permissionKind: "accessibility",
			reason: "Acepe needs macOS Accessibility permission.",
			tool: { messageID: null, callID: "computer-tool-1" },
			status: "pending",
			canonicalOperationId: "operation-computer-1",
		});
	});

	it("keeps app/window scope on pending computer permissions", () => {
		const store = new InteractionStore();

		store.applySessionInteractionPatches([
			createPendingComputerPermissionInteraction({
				payload: {
					ComputerPermission: {
						id: "computer-scope-1",
						session_id: "session-1",
						permission_kind: "app_window_scope",
						reason: "Allow computer use for Safari / GitHub?",
						app: "Safari",
						window: "GitHub",
						tool: { messageId: null, callId: "computer-tool-1" },
					},
				},
			}),
		]);

		const permission = store.getPendingComputerPermissionsForSession("session-1")[0];
		expect(permission.permissionKind).toBe("app_window_scope");
		expect(permission.app).toBe("Safari");
		expect(permission.window).toBe("GitHub");
	});

	it("removes resolved computer permissions from the pending session index", () => {
		const store = new InteractionStore();

		store.applySessionInteractionPatches([createPendingComputerPermissionInteraction()]);
		store.applySessionInteractionPatches([
			createPendingComputerPermissionInteraction({
				state: "Approved",
				response: { kind: "computer_permission", accepted: true },
			}),
		]);

		expect(store.computerPermissionsPending.size).toBe(0);
		expect(store.getPendingComputerPermissionsForSession("session-1")).toHaveLength(0);
	});
});
