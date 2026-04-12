import {
	extractPermissionCommand,
	extractPermissionToolKind,
} from "../components/tool-calls/permission-display.js";
import type { PlanApprovalInteraction } from "../types/interaction.js";
import type { Operation, OperationIdentityProof } from "../types/operation.js";
import type { PermissionRequest } from "../types/permission.js";
import type { QuestionRequest } from "../types/question.js";
import type { ToolCall } from "../types/tool-call.js";
import type { InteractionStore } from "./interaction-store.svelte.js";
import type { OperationStore } from "./operation-store.svelte.js";
import {
	buildOperationIdentity,
	createExecuteCommandIdentityProof,
	extractToolOperationCommand,
} from "./operation-store.svelte.js";

function operationHasIdentityProof(
	operation: Operation,
	proof: OperationIdentityProof | null
): boolean {
	if (proof == null) {
		return false;
	}

	return operation.identity.aliases.some(
		(alias) =>
			alias.kind === proof.kind && alias.proof === proof.proof && alias.value === proof.value
	);
}

function createPermissionIdentityProofs(permission: PermissionRequest): OperationIdentityProof[] {
	const proofs: OperationIdentityProof[] = [];
	if (permission.tool?.callID) {
		proofs.push({
			kind: "tool-call-id",
			proof: "transport-tool-call-id",
			value: permission.tool.callID,
		});
	}

	if (extractPermissionToolKind(permission) === "execute") {
		const executeProof = createExecuteCommandIdentityProof(extractPermissionCommand(permission));
		if (executeProof != null) {
			proofs.push(executeProof);
		}
	}

	return proofs;
}

function createQuestionIdentityProofs(question: QuestionRequest): OperationIdentityProof[] {
	const toolCallId = question.tool?.callID ?? question.id;
	return toolCallId
		? [
				{
					kind: "tool-call-id",
					proof: "transport-tool-call-id",
					value: toolCallId,
				},
			]
		: [];
}

function createPlanApprovalIdentityProofs(
	approval: PlanApprovalInteraction
): OperationIdentityProof[] {
	return [
		{
			kind: "tool-call-id",
			proof: "transport-tool-call-id",
			value: approval.tool.callID,
		},
	];
}

export function permissionMatchesOperation(permission: PermissionRequest, operation: Operation): boolean {
	for (const proof of createPermissionIdentityProofs(permission)) {
		if (operationHasIdentityProof(operation, proof)) {
			return true;
		}
	}

	return false;
}

export function questionMatchesOperation(question: QuestionRequest, operation: Operation): boolean {
	for (const proof of createQuestionIdentityProofs(question)) {
		if (operationHasIdentityProof(operation, proof)) {
			return true;
		}
	}

	return false;
}

export function planApprovalMatchesOperation(
	approval: PlanApprovalInteraction,
	operation: Operation
): boolean {
	for (const proof of createPlanApprovalIdentityProofs(approval)) {
		if (operationHasIdentityProof(operation, proof)) {
			return true;
		}
	}

	return false;
}

export function createCompatibilityOperation(toolCall: ToolCall): Operation {
	const command = extractToolOperationCommand(toolCall);
	return {
		id: toolCall.id,
		sessionId: "",
		toolCallId: toolCall.id,
		sourceEntryId: null,
		identity: buildOperationIdentity({
			toolCallId: toolCall.id,
			sourceEntryId: null,
			command,
		}),
		name: toolCall.name,
		rawInput: toolCall.rawInput,
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
		command,
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
	for (const proof of createPermissionIdentityProofs(permission)) {
		const operation = operationStore.findByIdentity(permission.sessionId, proof);
		if (operation != null) {
			return operation;
		}
	}

	return null;
}

export function findOperationForQuestion(
	operationStore: OperationStore,
	question: QuestionRequest
): Operation | null {
	for (const proof of createQuestionIdentityProofs(question)) {
		const operation = operationStore.findByIdentity(question.sessionId, proof);
		if (operation != null) {
			return operation;
		}
	}

	return null;
}

export function findOperationForPlanApproval(
	operationStore: OperationStore,
	approval: PlanApprovalInteraction
): Operation | null {
	for (const proof of createPlanApprovalIdentityProofs(approval)) {
		const operation = operationStore.findByIdentity(approval.sessionId, proof);
		if (operation != null) {
			return operation;
		}
	}

	return null;
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
