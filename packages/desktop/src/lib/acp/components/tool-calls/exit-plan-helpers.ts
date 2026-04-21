import type { SessionPlanResponse } from "../../../services/converted-session-types.js";
import type { OperationStore } from "../../store/operation-store.svelte.js";
import type { PermissionRequest } from "../../types/permission.js";
import type { ToolCall } from "../../types/tool-call.js";
import {
	type ExitPlanRawInput,
	isExitPlanPermission,
	readExitPlanRawInput,
} from "../../utils/exit-plan-permission.js";
import { parsePlanMarkdown } from "../../utils/plan-parser.js";

function normalizeString(value: string | null | undefined): string | null {
	if (value === null || value === undefined) {
		return null;
	}

	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return null;
	}

	return trimmed;
}

export function readExitPlanPermissionInput(
	permission: PermissionRequest
): ExitPlanRawInput | null {
	return readExitPlanRawInput(permission.metadata.rawInput);
}

export function readExitPlanToolInput(toolCall: ToolCall): ExitPlanRawInput | null {
	if (toolCall.arguments.kind !== "other") {
		return null;
	}

	return readExitPlanRawInput(toolCall.arguments.raw);
}

function getPreferredPlanFilePath(input: ExitPlanRawInput | null): string | null {
	if (input === null) {
		return null;
	}

	if (input.planFilePath !== null) {
		return input.planFilePath;
	}

	if (input.planPath !== null) {
		return input.planPath;
	}

	if (input.filePath !== null) {
		return input.filePath;
	}

	return null;
}

function extractSlug(filePath: string | null): string {
	if (filePath === null) {
		return "plan";
	}

	const segments = filePath.split("/");
	const fileName = segments.length > 0 ? segments[segments.length - 1] : filePath;
	if (fileName.endsWith(".md")) {
		return fileName.slice(0, -3);
	}

	return fileName;
}

function buildPlanFromInput(input: ExitPlanRawInput | null): SessionPlanResponse | null {
	if (input === null || input.plan === null) {
		return null;
	}

	const parsedPlan = parsePlanMarkdown(input.plan);
	const filePath = getPreferredPlanFilePath(input);
	const title = normalizeString(parsedPlan.title);

	return {
		slug: extractSlug(filePath),
		content: input.plan,
		title: title !== null ? title : "Plan",
		summary: parsedPlan.summary,
		filePath,
	};
}

function hasPlanContent(plan: SessionPlanResponse | null | undefined): plan is SessionPlanResponse {
	if (plan === null || plan === undefined) {
		return false;
	}

	return normalizeString(plan.content) !== null;
}

function permissionScore(toolCall: ToolCall, permission: PermissionRequest): number {
	if (!isExitPlanPermission(permission)) {
		return -1;
	}

	const toolReference = permission.tool;
	if (toolReference !== undefined && toolReference.callID === toolCall.id) {
		return 3;
	}

	const toolInput = readExitPlanToolInput(toolCall);
	const permissionInput = readExitPlanPermissionInput(permission);
	const toolFilePath = getPreferredPlanFilePath(toolInput);
	const permissionFilePath = getPreferredPlanFilePath(permissionInput);
	if (toolFilePath !== null && permissionFilePath !== null && toolFilePath === permissionFilePath) {
		return 2;
	}

	const toolPlan = toolInput !== null ? toolInput.plan : null;
	const permissionPlan = permissionInput !== null ? permissionInput.plan : null;
	if (toolPlan !== null && permissionPlan !== null && toolPlan === permissionPlan) {
		return 1;
	}

	return 0;
}

export function findExitPlanPermission(
	toolCall: ToolCall,
	permissions: ReadonlyArray<PermissionRequest>
): PermissionRequest | null {
	let bestPermission: PermissionRequest | null = null;
	let bestScore = -1;
	let bestRequestId = -1;

	for (const permission of permissions) {
		const score = permissionScore(toolCall, permission);
		if (score < 0) {
			continue;
		}

		const requestId = permission.jsonRpcRequestId !== undefined ? permission.jsonRpcRequestId : -1;
		const isBetterScore = score > bestScore;
		const isNewerAtSameScore = score === bestScore && requestId >= bestRequestId;
		if (isBetterScore || isNewerAtSameScore) {
			bestPermission = permission;
			bestScore = score;
			bestRequestId = requestId;
		}
	}

	return bestPermission;
}

export function getExitPlanDisplayPlan(
	toolCall: ToolCall,
	permission: PermissionRequest | null,
	sessionPlan: SessionPlanResponse | null | undefined
): SessionPlanResponse | null {
	if (hasPlanContent(sessionPlan)) {
		return sessionPlan;
	}

	const permissionPlan = buildPlanFromInput(
		permission !== null ? readExitPlanPermissionInput(permission) : null
	);
	if (permissionPlan !== null) {
		return permissionPlan;
	}

	return buildPlanFromInput(readExitPlanToolInput(toolCall));
}

export function shouldHidePermissionBarForExitPlan(
	permission: PermissionRequest,
	operationStore: OperationStore
): boolean {
	if (!isExitPlanPermission(permission)) {
		return false;
	}

	const toolReference = permission.tool;
	if (toolReference !== undefined) {
		const operation = operationStore.getByToolCallId(permission.sessionId, toolReference.callID);
		if (operation?.kind === "exit_plan_mode") {
			return true;
		}
	}

	for (const operation of operationStore.getSessionOperations(permission.sessionId)) {
		if (operation.kind === "exit_plan_mode") {
			return true;
		}
	}

	return false;
}
