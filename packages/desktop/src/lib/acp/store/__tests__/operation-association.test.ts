import { describe, expect, it } from "bun:test";

import type { InteractionSnapshot, OperationSnapshot } from "../../../services/acp-types.js";
import type {
	ComputerPermissionInteraction,
	PlanApprovalInteraction,
} from "../../types/interaction.js";
import { buildAcpPermissionId, type PermissionRequest } from "../../types/permission.js";
import type { QuestionRequest } from "../../types/question.js";
import { InteractionStore } from "../interaction-store.svelte.js";
import {
	buildSessionOperationInteractionSnapshot,
	findOperationForComputerPermission,
	findOperationForPermission,
	findOperationForPlanApproval,
	findOperationForQuestion,
} from "../operation-association.js";
import { OperationStore } from "../operation-store.svelte.js";

function createExecuteOperation(
	id: string,
	command: string,
	overrides?: Partial<OperationSnapshot>
): OperationSnapshot {
	return {
		id: overrides?.id ?? `op-${id}`,
		session_id: overrides?.session_id ?? "session-1",
		tool_call_id: overrides?.tool_call_id ?? id,
		operation_provenance_key: overrides?.operation_provenance_key ?? id,
		name: overrides?.name ?? "bash",
		arguments: overrides?.arguments ?? { kind: "execute", command },
		provider_status: overrides?.provider_status ?? "pending",
		operation_state: overrides?.operation_state ?? "pending",
		awaiting_plan_approval: false,
		source_link: overrides?.source_link ?? { kind: "transcript_linked", entry_id: id },
		result: overrides?.result ?? null,
		kind: overrides?.kind ?? "execute",
		title: overrides?.title ?? "Run command",
		progressive_arguments: overrides?.progressive_arguments ?? null,
		command: overrides?.command ?? command,
		normalized_todos: overrides?.normalized_todos ?? null,
		parent_tool_call_id: overrides?.parent_tool_call_id ?? null,
		parent_operation_id: overrides?.parent_operation_id ?? null,
		child_tool_call_ids: overrides?.child_tool_call_ids ?? [],
		child_operation_ids: overrides?.child_operation_ids ?? [],
	};
}

function createExecutePermission(
	sessionId: string,
	toolCallId: string,
	command: string
): PermissionRequest {
	return {
		id: buildAcpPermissionId(sessionId, toolCallId, 101),
		sessionId,
		jsonRpcRequestId: 101,
		permission: "Execute",
		patterns: [],
		metadata: {
			diagnosticRawInput: { command },
			parsedArguments: { kind: "execute", command },
			options: [],
		},
		always: [],
		tool: { messageID: "", callID: toolCallId },
	};
}

function createPendingPermissionInteraction(
	sessionId: string,
	toolCallId: string
): InteractionSnapshot {
	const id = buildAcpPermissionId(sessionId, toolCallId, 101);
	return {
		id,
		session_id: sessionId,
		kind: "Permission",
		state: "Pending",
		json_rpc_request_id: 101,
		reply_handler: null,
		tool_reference: {
			messageId: toolCallId,
			callId: toolCallId,
		},
		responded_at_event_seq: null,
		response: null,
		canonical_operation_id: `op-${toolCallId}`,
		payload: {
			Permission: {
				id,
				sessionId,
				jsonRpcRequestId: 101,
				replyHandler: null,
				permission: "Execute",
				patterns: [],
				metadata: {
					diagnosticRawInput: { command: "git status" },
					parsedArguments: { kind: "execute", command: "git status" },
					options: [],
				},
				always: [],
				autoAccepted: false,
				tool: {
					messageId: toolCallId,
					callId: toolCallId,
				},
			},
		},
	};
}

function createPendingQuestionInteraction(
	sessionId: string,
	toolCallId: string
): InteractionSnapshot {
	return {
		id: "question-1",
		session_id: sessionId,
		kind: "Question",
		state: "Pending",
		json_rpc_request_id: 102,
		reply_handler: null,
		tool_reference: {
			messageId: toolCallId,
			callId: toolCallId,
		},
		responded_at_event_seq: null,
		response: null,
		canonical_operation_id: `op-${toolCallId}`,
		payload: {
			Question: {
				id: "question-1",
				sessionId,
				jsonRpcRequestId: 102,
				replyHandler: null,
				questions: [],
				tool: {
					messageId: toolCallId,
					callId: toolCallId,
				},
			},
		},
	};
}

function createPendingPlanApprovalInteraction(
	sessionId: string,
	toolCallId: string
): InteractionSnapshot {
	return {
		id: "approval-1",
		session_id: sessionId,
		kind: "PlanApproval",
		state: "Pending",
		json_rpc_request_id: 103,
		reply_handler: null,
		tool_reference: {
			messageId: toolCallId,
			callId: toolCallId,
		},
		responded_at_event_seq: null,
		response: null,
		canonical_operation_id: `op-${toolCallId}`,
		payload: {
			PlanApproval: {
				source: "CreatePlan",
			},
		},
	};
}

function createPendingComputerPermissionInteraction(
	sessionId: string,
	toolCallId: string,
	canonicalOperationId?: string | null
): InteractionSnapshot {
	return {
		id: `computer-permission-${sessionId}-${toolCallId}`,
		session_id: sessionId,
		kind: "ComputerPermission",
		state: "Pending",
		json_rpc_request_id: null,
		reply_handler: null,
		tool_reference: {
			messageId: toolCallId,
			callId: toolCallId,
		},
		responded_at_event_seq: null,
		response: null,
		canonical_operation_id:
			canonicalOperationId === undefined ? `op-${toolCallId}` : canonicalOperationId,
		payload: {
			ComputerPermission: {
				id: `computer-permission-${sessionId}-${toolCallId}`,
				session_id: sessionId,
				permission_kind: "accessibility",
				reason: "Accessibility permission is required to operate the desktop.",
				tool: {
					messageId: toolCallId,
					callId: toolCallId,
				},
			},
		},
	};
}

describe("operation association", () => {
	it("prefers explicit tool references over semantic fallback", () => {
		const operationStore = new OperationStore();
		operationStore.replaceSessionOperations("session-1", [
			createExecuteOperation("tool-1", "git status"),
		]);

		const permission = createExecutePermission("session-1", "tool-1", "different command");
		const operation = findOperationForPermission(operationStore, permission);

		expect(operation?.toolCallId).toBe("tool-1");
	});

	it("does not guess execute permissions by command when the transport anchor differs", () => {
		const operationStore = new OperationStore();
		operationStore.replaceSessionOperations("session-1", [
			createExecuteOperation("tool-1", "mkdir demo"),
		]);

		const permission = createExecutePermission("session-1", "shell-permission", "mkdir demo");
		const operation = findOperationForPermission(operationStore, permission);

		expect(operation).toBeNull();
	});

	it("fails closed when no operation command matches a fallback permission", () => {
		const operationStore = new OperationStore();
		operationStore.replaceSessionOperations("session-1", [
			createExecuteOperation("tool-1", "git status"),
			createExecuteOperation("tool-2", "git diff"),
		]);

		const permission = createExecutePermission("session-1", "shell-permission", "npm test");
		expect(findOperationForPermission(operationStore, permission)).toBeNull();
	});

	it("resolves question and plan approval interactions by explicit tool reference", () => {
		const operationStore = new OperationStore();
		operationStore.replaceSessionOperations("session-1", [
			createExecuteOperation("tool-1", "plan"),
		]);

		const question: QuestionRequest = {
			id: "question-1",
			sessionId: "session-1",
			questions: [],
			tool: { messageID: "", callID: "tool-1" },
		};
		const approval: PlanApprovalInteraction = {
			id: "approval-1",
			kind: "plan_approval",
			source: "create_plan",
			sessionId: "session-1",
			tool: { messageID: "", callID: "tool-1" },
			jsonRpcRequestId: 10,
			replyHandler: { kind: "json-rpc", requestId: 10 },
			status: "pending",
		};

		expect(findOperationForQuestion(operationStore, question)?.toolCallId).toBe("tool-1");
		expect(findOperationForPlanApproval(operationStore, approval)?.toolCallId).toBe("tool-1");
	});

	it("resolves computer permissions by canonical operation id before tool reference", () => {
		const operationStore = new OperationStore();
		operationStore.replaceSessionOperations("session-1", [
			createExecuteOperation("tool-1", "computer action"),
		]);
		const permission: ComputerPermissionInteraction = {
			id: "computer-permission-1",
			kind: "computer_permission",
			sessionId: "session-1",
			permissionKind: "accessibility",
			reason: "Accessibility permission is required.",
			tool: { messageID: "", callID: "stale-tool-ref" },
			status: "pending",
			canonicalOperationId: "op-tool-1",
		};

		expect(findOperationForComputerPermission(operationStore, permission)?.toolCallId).toBe(
			"tool-1"
		);
	});

	it("resolves interactions by operation provenance key when tool-call storage id differs", () => {
		const operationStore = new OperationStore();
		operationStore.replaceSessionOperations("session-1", [
			{
				id: "op-1",
				session_id: "session-1",
				tool_call_id: "stored-tool-1",
				operation_provenance_key: "provider-tool-1",
				name: "bash",
				kind: "execute",
				provider_status: "pending",
				operation_state: "pending",
				awaiting_plan_approval: false,
				source_link: { kind: "transcript_linked", entry_id: "stored-tool-1" },
				title: "Run command",
				arguments: { kind: "execute", command: "mkdir demo" },
				progressive_arguments: null,
				result: null,
				command: "mkdir demo",
				normalized_todos: null,
				parent_tool_call_id: null,
				parent_operation_id: null,
				child_tool_call_ids: [],
				child_operation_ids: [],
			},
		]);

		const permission = createExecutePermission("session-1", "provider-tool-1", "different command");
		expect(findOperationForPermission(operationStore, permission)?.toolCallId).toBe(
			"stored-tool-1"
		);
	});

	it("returns null for permission with no matching operation", () => {
		const operationStore = new OperationStore();
		const permission = createExecutePermission("session-1", "tool-nonexistent", "some command");
		const result = findOperationForPermission(operationStore, permission);
		expect(result).toBeNull();
	});

	it("does not choose the first pending question when no operation match exists", () => {
		const operationStore = new OperationStore();
		const interactions = new InteractionStore();
		interactions.applySessionInteractionPatches([
			createPendingQuestionInteraction("session-1", "missing-tool"),
		]);

		const snapshot = buildSessionOperationInteractionSnapshot(
			"session-1",
			operationStore,
			interactions
		);

		expect(snapshot.pendingQuestion).toBeNull();
		expect(snapshot.pendingQuestionOperation).toBeNull();
	});

	it("does not choose the first pending permission when no operation match exists", () => {
		const operationStore = new OperationStore();
		const interactions = new InteractionStore();
		interactions.applySessionInteractionPatches([
			createPendingPermissionInteraction("session-1", "missing-tool"),
		]);

		const snapshot = buildSessionOperationInteractionSnapshot(
			"session-1",
			operationStore,
			interactions
		);

		expect(snapshot.pendingPermission).toBeNull();
		expect(snapshot.pendingPermissionOperation).toBeNull();
	});

	it("does not choose the first pending computer permission when no operation match exists", () => {
		const operationStore = new OperationStore();
		const interactions = new InteractionStore();
		interactions.applySessionInteractionPatches([
			createPendingComputerPermissionInteraction("session-1", "missing-tool", null),
		]);

		const snapshot = buildSessionOperationInteractionSnapshot(
			"session-1",
			operationStore,
			interactions
		);

		expect(snapshot.pendingComputerPermission).toBeNull();
		expect(snapshot.pendingComputerPermissionOperation).toBeNull();
	});

	it("uses session-scoped pending permission indexes for operation snapshots", () => {
		const operationStore = new OperationStore();
		operationStore.replaceSessionOperations("session-1", [
			createExecuteOperation("tool-1", "git status"),
		]);
		const interactions = new InteractionStore();
		interactions.applySessionInteractionPatches([
			createPendingPermissionInteraction("other-session", "other-tool"),
			createPendingPermissionInteraction("session-1", "tool-1"),
		]);
		const values = interactions.permissionsPending.values.bind(interactions.permissionsPending);
		(
			interactions.permissionsPending as unknown as {
				values: () => IterableIterator<PermissionRequest>;
			}
		).values = () => {
			throw new Error("snapshot selector must not scan all pending permissions");
		};

		try {
			const snapshot = buildSessionOperationInteractionSnapshot(
				"session-1",
				operationStore,
				interactions
			);

			expect(snapshot.pendingPermission?.sessionId).toBe("session-1");
			expect(snapshot.pendingPermissionOperation?.toolCallId).toBe("tool-1");
		} finally {
			(interactions.permissionsPending as unknown as { values: typeof values }).values = values;
		}
	});

	it("uses session-scoped pending computer permission indexes for operation snapshots", () => {
		const operationStore = new OperationStore();
		operationStore.replaceSessionOperations("session-1", [
			createExecuteOperation("tool-1", "computer action"),
		]);
		const interactions = new InteractionStore();
		interactions.applySessionInteractionPatches([
			createPendingComputerPermissionInteraction("other-session", "other-tool"),
			createPendingComputerPermissionInteraction("session-1", "tool-1"),
		]);
		const values = interactions.computerPermissionsPending.values.bind(
			interactions.computerPermissionsPending
		);
		(
			interactions.computerPermissionsPending as unknown as {
				values: () => IterableIterator<ComputerPermissionInteraction>;
			}
		).values = () => {
			throw new Error("snapshot selector must not scan all pending computer permissions");
		};

		try {
			const snapshot = buildSessionOperationInteractionSnapshot(
				"session-1",
				operationStore,
				interactions
			);

			expect(snapshot.pendingComputerPermission?.sessionId).toBe("session-1");
			expect(snapshot.pendingComputerPermissionOperation?.toolCallId).toBe("tool-1");
		} finally {
			(interactions.computerPermissionsPending as unknown as { values: typeof values }).values =
				values;
		}
	});

	it("does not scan global pending interactions for sessions without pending input", () => {
		const interactions = new InteractionStore();
		interactions.applySessionInteractionPatches([
			createPendingQuestionInteraction("other-session", "other-tool"),
			createPendingPermissionInteraction("other-session", "other-tool"),
			createPendingComputerPermissionInteraction("other-session", "other-tool"),
			createPendingPlanApprovalInteraction("other-session", "other-tool"),
		]);
		const questionValues = interactions.questionsPending.values.bind(interactions.questionsPending);
		const permissionValues = interactions.permissionsPending.values.bind(
			interactions.permissionsPending
		);
		const approvalValues = interactions.planApprovalsPending.values.bind(
			interactions.planApprovalsPending
		);
		const computerPermissionValues = interactions.computerPermissionsPending.values.bind(
			interactions.computerPermissionsPending
		);
		(
			interactions.questionsPending as unknown as {
				values: () => IterableIterator<QuestionRequest>;
			}
		).values = () => {
			throw new Error("question selector must not scan all pending questions");
		};
		(
			interactions.permissionsPending as unknown as {
				values: () => IterableIterator<PermissionRequest>;
			}
		).values = () => {
			throw new Error("permission selector must not scan all pending permissions");
		};
		(
			interactions.planApprovalsPending as unknown as {
				values: () => IterableIterator<PlanApprovalInteraction>;
			}
		).values = () => {
			throw new Error("approval selector must not scan all pending approvals");
		};
		(
			interactions.computerPermissionsPending as unknown as {
				values: () => IterableIterator<ComputerPermissionInteraction>;
			}
		).values = () => {
			throw new Error(
				"computer permission selector must not scan all pending computer permissions"
			);
		};

		try {
			expect(interactions.getPendingQuestionsForSession("session-1")).toEqual([]);
			expect(interactions.getPendingPermissionsForSession("session-1")).toEqual([]);
			expect(interactions.getPendingComputerPermissionsForSession("session-1")).toEqual([]);
			expect(interactions.getPendingPlanApprovalsForSession("session-1")).toEqual([]);
		} finally {
			(interactions.questionsPending as unknown as { values: typeof questionValues }).values =
				questionValues;
			(interactions.permissionsPending as unknown as { values: typeof permissionValues }).values =
				permissionValues;
			(interactions.planApprovalsPending as unknown as { values: typeof approvalValues }).values =
				approvalValues;
			(
				interactions.computerPermissionsPending as unknown as {
					values: typeof computerPermissionValues;
				}
			).values = computerPermissionValues;
		}
	});

	it("does not choose the first pending plan approval when no operation match exists", () => {
		const operationStore = new OperationStore();
		const interactions = new InteractionStore();
		interactions.applySessionInteractionPatches([
			createPendingPlanApprovalInteraction("session-1", "missing-tool"),
		]);

		const snapshot = buildSessionOperationInteractionSnapshot(
			"session-1",
			operationStore,
			interactions
		);

		expect(snapshot.pendingPlanApproval).toBeNull();
		expect(snapshot.pendingPlanApprovalOperation).toBeNull();
	});
});
