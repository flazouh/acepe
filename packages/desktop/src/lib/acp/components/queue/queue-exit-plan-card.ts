import type { SessionPlanResponse } from "../../../services/converted-session-types.js";
import type { PermissionRequest } from "../../types/permission.js";
import type { ToolCall } from "../../types/tool-call.js";
import {
	type ExitPlanRawInput,
	readExitPlanRawInput,
	readExitPlanPermissionInput,
} from "../../utils/exit-plan-permission.js";
import { parsePlanMarkdown } from "../../utils/plan-parser.js";

export interface QueueExitPlanCard {
	readonly title: string;
	readonly content: string;
}

function normalized(value: string | null | undefined): string | null {
	if (value === null || value === undefined) {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function preferredPath(input: ExitPlanRawInput): string | null {
	return input.planFilePath ?? input.planPath ?? input.filePath;
}

function slugFromPath(filePath: string | null): string {
	if (filePath === null) {
		return "plan";
	}

	const segments = filePath.split("/");
	const fileName = segments.length > 0 ? segments[segments.length - 1] : filePath;
	return fileName.endsWith(".md") ? fileName.slice(0, -3) : fileName;
}

function planFromInput(input: ExitPlanRawInput | null): SessionPlanResponse | null {
	const content = normalized(input?.plan);
	if (input === null || content === null) {
		return null;
	}

	const parsedPlan = parsePlanMarkdown(content);
	const filePath = preferredPath(input);
	const parsedTitle = normalized(parsedPlan.title);

	return {
		slug: slugFromPath(filePath),
		content,
		title: parsedTitle ?? "Plan",
		summary: parsedPlan.summary,
		filePath,
	};
}

function planFromToolCall(toolCall: ToolCall | null): SessionPlanResponse | null {
	if (toolCall === null) {
		return null;
	}

	const rawInputPlan = planFromInput(readExitPlanRawInput(toolCall.rawInput ?? undefined));
	if (rawInputPlan !== null) {
		return rawInputPlan;
	}

	if (toolCall.arguments.kind !== "other") {
		return null;
	}

	return planFromInput(readExitPlanRawInput(toolCall.arguments.raw));
}

export function buildQueueExitPlanCard(
	toolCall: ToolCall | null,
	permission: PermissionRequest | null
): QueueExitPlanCard | null {
	const permissionPlan = planFromInput(
		permission !== null ? readExitPlanPermissionInput(permission) : null
	);
	const toolPlan = planFromToolCall(toolCall);
	const plan = permissionPlan ?? toolPlan;

	if (plan === null) {
		return null;
	}

	return {
		title: plan.title,
		content: plan.content,
	};
}
