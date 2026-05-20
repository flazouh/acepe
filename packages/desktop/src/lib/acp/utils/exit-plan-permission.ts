import type { ToolArguments } from "../../services/converted-session-types.js";
import type { PermissionRequest } from "../types/permission.js";

export interface ExitPlanInput {
	plan: string | null;
	planFilePath: string | null;
	planPath: string | null;
	filePath: string | null;
	allowedPrompts: string[];
}

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

function hasExitPlanFields(input: ExitPlanInput): boolean {
	return (
		input.plan !== null ||
		input.planFilePath !== null ||
		input.planPath !== null ||
		input.filePath !== null ||
		input.allowedPrompts.length > 0
	);
}

export function readExitPlanToolInput(argumentsValue: ToolArguments): ExitPlanInput | null {
	if (argumentsValue.kind !== "planMode") {
		return null;
	}

	const input: ExitPlanInput = {
		plan: normalizeString(argumentsValue.plan),
		planFilePath: normalizeString(argumentsValue.plan_file_path),
		planPath: null,
		filePath: null,
		allowedPrompts: [],
	};

	return hasExitPlanFields(input) ? input : null;
}

export function readExitPlanPermissionInput(permission: PermissionRequest): ExitPlanInput | null {
	const parsedArguments = permission.metadata.parsedArguments;
	if (parsedArguments === null || parsedArguments === undefined) {
		return null;
	}

	return readExitPlanToolInput(parsedArguments);
}

function isPlanPermissionLabel(permission: PermissionRequest): boolean {
	return permission.permission === "ExitPlanMode" || permission.permission === "Plan";
}

export function isExitPlanPermission(permission: PermissionRequest): boolean {
	const permissionInput = readExitPlanPermissionInput(permission);
	const hasPlanPayload = permissionInput !== null ? hasExitPlanFields(permissionInput) : false;
	const parsedArguments = permission.metadata.parsedArguments;
	const looksLikePlanMode =
		parsedArguments !== null && parsedArguments !== undefined
			? parsedArguments.kind === "planMode"
			: false;

	if (isPlanPermissionLabel(permission) && hasPlanPayload) {
		return true;
	}

	return looksLikePlanMode && hasPlanPayload;
}
