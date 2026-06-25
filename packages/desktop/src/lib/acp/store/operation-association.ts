import type {
	ComputerPermissionInteraction,
	PlanApprovalInteraction,
} from "../types/interaction.js";
import type { Operation } from "../types/operation.js";
import type { PermissionRequest } from "../types/permission.js";
import type { QuestionRequest } from "../types/question.js";
import type { InteractionStore } from "./interaction-store.svelte.js";
import type { OperationStore } from "./operation-store.svelte.js";

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

export function computerPermissionMatchesOperation(
	permission: ComputerPermissionInteraction,
	operation: Operation
): boolean {
	if (permission.canonicalOperationId === operation.id) {
		return true;
	}

	if (permission.tool == null) {
		return false;
	}

	return (
		permission.tool.callID === operation.operationProvenanceKey ||
		permission.tool.callID === operation.toolCallId
	);
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

export function findOperationForComputerPermission(
	operationStore: OperationStore,
	permission: ComputerPermissionInteraction
): Operation | null {
	if (permission.canonicalOperationId != null) {
		const operation = operationStore.getById(permission.canonicalOperationId);
		if (operation != null) {
			return operation;
		}
	}

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

export interface SessionOperationInteractionSnapshot {
	readonly pendingQuestion: QuestionRequest | null;
	readonly pendingQuestionOperation: Operation | null;
	readonly pendingPermission: PermissionRequest | null;
	readonly pendingPermissionOperation: Operation | null;
	readonly pendingComputerPermission: ComputerPermissionInteraction | null;
	readonly pendingComputerPermissionOperation: Operation | null;
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
	for (const question of interactions.getPendingQuestionsForSession(sessionId)) {
		const operation = findOperationForQuestion(operationStore, question);
		if (operation != null) {
			pendingQuestion = question;
			pendingQuestionOperation = operation;
			break;
		}
	}

	let pendingPermission: PermissionRequest | null = null;
	let pendingPermissionOperation: Operation | null = null;
	for (const permission of interactions.getPendingPermissionsForSession(sessionId)) {
		const operation = findOperationForPermission(operationStore, permission);
		if (operation != null) {
			pendingPermission = permission;
			pendingPermissionOperation = operation;
			break;
		}
	}

	let pendingComputerPermission: ComputerPermissionInteraction | null = null;
	let pendingComputerPermissionOperation: Operation | null = null;
	for (const permission of interactions.getPendingComputerPermissionsForSession(sessionId)) {
		const operation = findOperationForComputerPermission(operationStore, permission);
		if (operation != null) {
			pendingComputerPermission = permission;
			pendingComputerPermissionOperation = operation;
			break;
		}
	}

	let pendingPlanApproval: PlanApprovalInteraction | null = null;
	let pendingPlanApprovalOperation: Operation | null = null;
	for (const approval of interactions.getPendingPlanApprovalsForSession(sessionId)) {
		if (approval.status !== "pending") {
			continue;
		}

		const operation = findOperationForPlanApproval(operationStore, approval);
		if (operation != null) {
			pendingPlanApproval = approval;
			pendingPlanApprovalOperation = operation;
			break;
		}
	}

	return {
		pendingQuestion,
		pendingQuestionOperation,
		pendingPermission,
		pendingPermissionOperation,
		pendingComputerPermission,
		pendingComputerPermissionOperation,
		pendingPlanApproval,
		pendingPlanApprovalOperation,
	};
}
