import type { PlanApprovalInteraction } from "../types/interaction.js";
import type { Operation } from "../types/operation.js";
import type { PermissionRequest } from "../types/permission.js";
import type { QuestionRequest } from "../types/question.js";
import type { ToolCall } from "../types/tool-call.js";
import type { InteractionStore } from "./interaction-store.svelte.js";
import type { OperationStore } from "./operation-store.svelte.js";
import { extractToolOperationCommand } from "./operation-store.svelte.js";

export function permissionMatchesOperation(
	permission: PermissionRequest,
	operation: Operation
): boolean {
	if (permission.tool?.callID == null) {
		return false;
	}

	return (
		permission.tool.callID === operation.operationProvenanceKey ||
		permission.tool.callID === operation.toolCallId
	);
}

export function questionMatchesOperation(question: QuestionRequest, operation: Operation): boolean {
	if (question.tool?.callID == null) {
		return false;
	}

	return (
		question.tool.callID === operation.operationProvenanceKey ||
		question.tool.callID === operation.toolCallId
	);
}

export function planApprovalMatchesOperation(
	approval: PlanApprovalInteraction,
	operation: Operation
): boolean {
	if (approval.tool.callID === operation.toolCallId) {
		return true;
	}

	if (approval.tool.callID === operation.operationProvenanceKey) {
		return true;
	}

	return false;
}

export function createCompatibilityOperation(toolCall: ToolCall): Operation {
	return {
		id: toolCall.id,
		sessionId: "",
		toolCallId: toolCall.id,
		operationProvenanceKey: toolCall.id,
		sourceEntryId: null,
		name: toolCall.name,
		kind: toolCall.kind,
		status: toolCall.status,
		operationState:
			toolCall.status === "pending"
				? "pending"
				: toolCall.status === "in_progress"
					? "running"
					: toolCall.status === "completed"
						? "completed"
						: "failed",
		title: toolCall.title,
		arguments: toolCall.arguments,
		progressiveArguments: toolCall.progressiveArguments,
		result: toolCall.result,
		locations: toolCall.locations,
		skillMeta: toolCall.skillMeta,
		normalizedQuestions: toolCall.normalizedQuestions,
		normalizedTodos: toolCall.normalizedTodos,
		questionAnswer: toolCall.questionAnswer,
		awaitingPlanApproval: toolCall.awaitingPlanApproval,
		planApprovalRequestId: toolCall.planApprovalRequestId,
		startedAtMs: toolCall.startedAtMs,
		completedAtMs: toolCall.completedAtMs,
		command: extractToolOperationCommand(toolCall),
		parentToolCallId: toolCall.parentToolUseId ?? null,
		parentOperationId: null,
		childToolCallIds: (toolCall.taskChildren ?? []).map((child) => child.id),
		childOperationIds: [],
	};
}

export function findOperationForPermission(
	operationStore: OperationStore,
	permission: PermissionRequest
): Operation | null {
	const toolCallId = permission.tool?.callID;
	if (toolCallId == null) {
		return null;
	}

	return (
		operationStore.getByProvenanceKey(permission.sessionId, toolCallId) ??
		operationStore.getByToolCallId(permission.sessionId, toolCallId) ??
		null
	);
}

export function findOperationForQuestion(
	operationStore: OperationStore,
	question: QuestionRequest
): Operation | null {
	const toolCallId = question.tool?.callID;
	if (toolCallId == null) {
		return null;
	}

	return (
		operationStore.getByProvenanceKey(question.sessionId, toolCallId) ??
		operationStore.getByToolCallId(question.sessionId, toolCallId) ??
		null
	);
}

export function findOperationForPlanApproval(
	operationStore: OperationStore,
	approval: PlanApprovalInteraction
): Operation | null {
	return (
		operationStore.getByProvenanceKey(approval.sessionId, approval.tool.callID) ??
		operationStore.getByToolCallId(approval.sessionId, approval.tool.callID) ??
		null
	);
}

export interface SessionOperationInteractionSnapshot {
	readonly pendingQuestion: QuestionRequest | null;
	readonly pendingQuestionOperation: Operation | null;
	readonly pendingPermission: PermissionRequest | null;
	readonly pendingPermissionOperation: Operation | null;
	readonly pendingPlanApproval: PlanApprovalInteraction | null;
	readonly pendingPlanApprovalOperation: Operation | null;
}

export function buildSessionOperationInteractionSnapshot(
	sessionId: string,
	operationStore: OperationStore,
	interactions: InteractionStore
): SessionOperationInteractionSnapshot {
	let pendingQuestion: QuestionRequest | null = null;
	let pendingQuestionOperation: Operation | null = null;
	let firstQuestion: QuestionRequest | null = null;
	for (const question of interactions.questionsPending.values()) {
		if (question.sessionId !== sessionId) {
			continue;
		}

		if (firstQuestion == null) {
			firstQuestion = question;
		}

		const operation = findOperationForQuestion(operationStore, question);
		if (operation != null) {
			pendingQuestion = question;
			pendingQuestionOperation = operation;
			break;
		}
	}
	if (pendingQuestion == null && firstQuestion != null) {
		pendingQuestion = firstQuestion;
		pendingQuestionOperation = findOperationForQuestion(operationStore, firstQuestion);
	}

	let pendingPermission: PermissionRequest | null = null;
	let pendingPermissionOperation: Operation | null = null;
	let firstPermission: PermissionRequest | null = null;
	for (const permission of interactions.permissionsPending.values()) {
		if (permission.sessionId !== sessionId) {
			continue;
		}

		if (firstPermission == null) {
			firstPermission = permission;
		}

		const operation = findOperationForPermission(operationStore, permission);
		if (operation != null) {
			pendingPermission = permission;
			pendingPermissionOperation = operation;
			break;
		}
	}
	if (pendingPermission == null && firstPermission != null) {
		pendingPermission = firstPermission;
		pendingPermissionOperation = findOperationForPermission(operationStore, firstPermission);
	}

	let pendingPlanApproval: PlanApprovalInteraction | null = null;
	let pendingPlanApprovalOperation: Operation | null = null;
	let firstPlanApproval: PlanApprovalInteraction | null = null;
	for (const approval of interactions.planApprovalsPending.values()) {
		if (approval.sessionId !== sessionId || approval.status !== "pending") {
			continue;
		}

		if (firstPlanApproval == null) {
			firstPlanApproval = approval;
		}

		const operation = findOperationForPlanApproval(operationStore, approval);
		if (operation != null) {
			pendingPlanApproval = approval;
			pendingPlanApprovalOperation = operation;
			break;
		}
	}
	if (pendingPlanApproval == null && firstPlanApproval != null) {
		pendingPlanApproval = firstPlanApproval;
		pendingPlanApprovalOperation = findOperationForPlanApproval(operationStore, firstPlanApproval);
	}

	return {
		pendingQuestion,
		pendingQuestionOperation,
		pendingPermission,
		pendingPermissionOperation,
		pendingPlanApproval,
		pendingPlanApprovalOperation,
	};
}
