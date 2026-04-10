import type { JsonValue, ToolArguments } from "../../services/converted-session-types.js";
import type { PermissionRequest } from "../types/permission.js";

export interface ExitPlanRawInput {
	plan: string | null;
	planFilePath: string | null;
	planPath: string | null;
	filePath: string | null;
	allowedPrompts: string[];
}

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
	return (
		value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)
	);
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

function readStringField(record: Record<string, JsonValue>, key: string): string | null {
	const value = record[key];
	if (typeof value !== "string") {
		return null;
	}

	return normalizeString(value);
}

function readStringArrayField(record: Record<string, JsonValue>, key: string): string[] {
	const value = record[key];
	if (!Array.isArray(value)) {
		return [];
	}

	const items: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string") {
			continue;
		}

		const normalized = normalizeString(entry);
		if (normalized !== null) {
			items.push(normalized);
		}
	}

	return items;
}

function hasExitPlanFields(input: ExitPlanRawInput): boolean {
	return (
		input.plan !== null ||
		input.planFilePath !== null ||
		input.planPath !== null ||
		input.filePath !== null ||
		input.allowedPrompts.length > 0
	);
}

export function readExitPlanRawInput(value: JsonValue | undefined): ExitPlanRawInput | null {
	if (!isJsonObject(value)) {
		return null;
	}

	const input: ExitPlanRawInput = {
		plan: readStringField(value, "plan"),
		planFilePath: readStringField(value, "planFilePath"),
		planPath: readStringField(value, "planPath"),
		filePath: readStringField(value, "filePath"),
		allowedPrompts: readStringArrayField(value, "allowedPrompts"),
	};

	return hasExitPlanFields(input) ? input : null;
}

export function readExitPlanToolInput(argumentsValue: ToolArguments): ExitPlanRawInput | null {
	if (argumentsValue.kind !== "other") {
		return null;
	}

	return readExitPlanRawInput(argumentsValue.raw);
}

export function readExitPlanPermissionInput(
	permission: PermissionRequest
): ExitPlanRawInput | null {
	return readExitPlanRawInput(permission.metadata.rawInput);
}

function isPlanPermissionLabel(permission: PermissionRequest): boolean {
	return permission.permission === "ExitPlanMode" || permission.permission === "Plan";
}

export function isExitPlanPermission(permission: PermissionRequest): boolean {
	const rawInput = readExitPlanPermissionInput(permission);
	const hasPlanPayload = hasExitPlanFields(
		rawInput !== null
			? rawInput
			: {
					plan: null,
					planFilePath: null,
					planPath: null,
					filePath: null,
					allowedPrompts: [],
				}
	);
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
