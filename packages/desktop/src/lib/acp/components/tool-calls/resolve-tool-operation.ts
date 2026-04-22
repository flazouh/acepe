import type { OperationStore } from "../../store/operation-store.svelte.js";
import { normalizeToolResult } from "../../store/services/tool-result-normalizer.js";
import type { Operation } from "../../types/operation.js";
import type { PermissionRequest } from "../../types/permission.js";
import type { ToolCall } from "../../types/tool-call.js";
import type { ToolKind } from "../../types/tool-kind.js";

export type ToolRouteKey = ToolKind | "read_lints";

export interface ResolvedToolOperation {
	resolvedKind: ToolKind;
	routeKey: ToolRouteKey;
	toolCall: ToolCall;
	shouldShowInlinePermissionActionBar: boolean;
}

type OperationLookup = Pick<OperationStore, "getById" | "getByToolCallId">;

export function resolveToolOperation(
	toolCall: ToolCall,
	pendingPermission: PermissionRequest | null | undefined
): ResolvedToolOperation {
	const resolvedKind = toolCall.kind ?? "other";
	const routeKey = resolveToolRouteKey(toolCall, resolvedKind);

	return {
		resolvedKind,
		routeKey,
		toolCall,
		shouldShowInlinePermissionActionBar:
			pendingPermission !== null &&
			pendingPermission !== undefined &&
			resolvedKind !== "exit_plan_mode",
	};
}

export function resolveToolRouteKey(toolCall: ToolCall, resolvedKind: ToolKind): ToolRouteKey {
	if (toolCall.title?.trim() === "Read Lints" || toolCall.name === "read_lints") {
		return "read_lints";
	}

	return resolvedKind;
}

export function createRenderableToolCall(
	toolCall: ToolCall,
	operation: Operation | null | undefined,
	operationStore: OperationLookup | null | undefined
): ToolCall {
	if (!operation || !operationStore) {
		return toolCall;
	}

	return buildToolCallFromOperation(operation, operationStore, new Set<string>());
}

function buildToolCallFromOperation(
	operation: Operation,
	operationStore: OperationLookup,
	visitedOperationIds: Set<string>
): ToolCall {
	if (visitedOperationIds.has(operation.id)) {
		return createToolCallFromOperation(operation, null);
	}

	const nextVisitedOperationIds = new Set(visitedOperationIds);
	nextVisitedOperationIds.add(operation.id);
	const taskChildren = operation.childOperationIds
		.map((childOperationId) => operationStore.getById(childOperationId))
		.filter((childOperation): childOperation is Operation => childOperation !== undefined)
		.map((childOperation) =>
			buildToolCallFromOperation(childOperation, operationStore, nextVisitedOperationIds)
		);

	if (taskChildren.length > 0) {
		return createToolCallFromOperation(operation, taskChildren);
	}

	const fallbackChildren = operation.childToolCallIds
		.map((childToolCallId) => operationStore.getByToolCallId(operation.sessionId, childToolCallId))
		.filter((childOperation): childOperation is Operation => childOperation !== undefined)
		.map((childOperation) =>
			buildToolCallFromOperation(childOperation, operationStore, nextVisitedOperationIds)
		);

	return createToolCallFromOperation(
		operation,
		fallbackChildren.length > 0 ? fallbackChildren : null
	);
}

function createToolCallFromOperation(
	operation: Operation,
	taskChildren: ToolCall[] | null
): ToolCall {
	const toolCall: ToolCall = {
		id: operation.toolCallId,
		name: operation.name,
		arguments: operation.arguments,
		progressiveArguments: operation.progressiveArguments,
		status: operation.status,
		result: operation.result,
		normalizedResult: normalizeToolResult({
			kind: operation.kind,
			arguments: operation.arguments,
			result: operation.result,
		}),
		kind: operation.kind,
		title: operation.title,
		locations: operation.locations,
		skillMeta: operation.skillMeta,
		normalizedQuestions: operation.normalizedQuestions,
		normalizedTodos: operation.normalizedTodos,
		parentToolUseId: operation.parentToolCallId,
		taskChildren,
		questionAnswer: operation.questionAnswer,
		awaitingPlanApproval: operation.awaitingPlanApproval,
		planApprovalRequestId: operation.planApprovalRequestId,
		startedAtMs: operation.startedAtMs,
		completedAtMs: operation.completedAtMs,
	};

	return toolCall;
}
