import { extractPermissionCommand, extractPermissionToolKind } from "../components/tool-calls/permission-display.js";
import type { Operation } from "../types/operation.js";
import type { PermissionRequest } from "../types/permission.js";
import type { PlanApprovalInteraction } from "../types/interaction.js";
import type { QuestionRequest } from "../types/question.js";
import type { ToolCall } from "../types/tool-call.js";
import type { InteractionStore } from "./interaction-store.svelte.js";
import { extractToolOperationCommand } from "./operation-store.svelte.js";
import type { OperationStore } from "./operation-store.svelte.js";

function normalizeCommand(value: string | null | undefined): string | null {
	if (value == null) {
		return null;
	}

	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return null;
	}

	return trimmed.replace(/\s+/g, " ");
}

export function permissionMatchesOperation(permission: PermissionRequest, operation: Operation): boolean {
	if (permission.tool?.callID === operation.toolCallId) {
		return true;
	}

	if (operation.kind !== "execute") {
		return false;
	}

	if (extractPermissionToolKind(permission) !== "execute") {
		return false;
	}

	const permissionCommand = normalizeCommand(extractPermissionCommand(permission));
	if (permissionCommand == null || operation.command == null) {
		return false;
	}

	return permissionCommand === operation.command;
}

export function questionMatchesOperation(question: QuestionRequest, operation: Operation): boolean {
	if (question.tool?.callID === operation.toolCallId) {
		return true;
	}

	return question.id === operation.toolCallId;
}

export function planApprovalMatchesOperation(
	approval: PlanApprovalInteraction,
	operation: Operation
): boolean {
	return approval.tool.callID === operation.toolCallId;
}

export function createCompatibilityOperation(toolCall: ToolCall): Operation {
	return {
		id: toolCall.id,
		sessionId: "",
		toolCallId: toolCall.id,
		sourceEntryId: null,
		name: toolCall.name,
		kind: toolCall.kind,
		status: toolCall.status,
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

function findUniqueExecuteCommandMatch(
	operationStore: OperationStore,
	sessionId: string,
	command: string
): Operation | null {
	let matched: Operation | null = null;
	for (const operation of operationStore.getSessionOperations(sessionId)) {
		if (operation.kind !== "execute") {
			continue;
		}

		if (operation.command !== command) {
			continue;
		}

		if (matched != null) {
			return null;
		}

		matched = operation;
	}

	return matched;
}

export function findOperationForPermission(
	operationStore: OperationStore,
	permission: PermissionRequest
): Operation | null {
	const toolCallId = permission.tool?.callID;
	if (toolCallId != null) {
		const directOperation = operationStore.getByToolCallId(permission.sessionId, toolCallId);
		if (directOperation != null) {
			return directOperation;
		}
	}

	if (extractPermissionToolKind(permission) !== "execute") {
		return null;
	}

	const permissionCommand = normalizeCommand(extractPermissionCommand(permission));
	if (permissionCommand == null) {
		return null;
	}

	return findUniqueExecuteCommandMatch(operationStore, permission.sessionId, permissionCommand);
}

export function findOperationForQuestion(
	operationStore: OperationStore,
	question: QuestionRequest
): Operation | null {
	const toolCallId = question.tool?.callID ?? question.id;
	return operationStore.getByToolCallId(question.sessionId, toolCallId) ?? null;
}

export function findOperationForPlanApproval(
	operationStore: OperationStore,
	approval: PlanApprovalInteraction
): Operation | null {
	return operationStore.getByToolCallId(approval.sessionId, approval.tool.callID) ?? null;
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
