import type { TodoProgressInfo } from "../../components/session-list/session-list-types.js";
import type { PlanApprovalInteraction } from "../../types/interaction.js";
import type { PermissionRequest } from "../../types/permission.js";
import type { ToolCall } from "../../types/tool-call.js";
import { makeWorkspaceRelative } from "../../utils/path-utils.js";
import {
	extractPermissionCommand,
	extractPermissionFilePath,
} from "../tool-calls/permission-display.js";

export interface QueueItemTodoProgressDisplay {
	readonly current: number;
	readonly total: number;
	readonly label: string;
}

export interface QueuePermissionDisplay {
	readonly command: string | null;
	readonly filePath: string | null;
	readonly verb: string;
}

export function getQueueItemStatusText(input: {
	hasPendingQuestion: boolean;
	hasPendingPlanApproval: boolean;
	isThinking: boolean;
	pendingText: string | null;
	hasError: boolean;
	urgencyDetail: string | null;
}): string | null {
	if (input.hasPendingQuestion || input.hasPendingPlanApproval) return null;
	if (input.isThinking) return "Thinking";
	if (input.pendingText) return input.pendingText;
	if (input.hasError && input.urgencyDetail) return input.urgencyDetail;
	return null;
}

export function shouldShowQueueItemShimmer(input: {
	isThinking: boolean;
	hasPendingQuestion: boolean;
	hasPendingPlanApproval: boolean;
}): boolean {
	return input.isThinking && !input.hasPendingQuestion && !input.hasPendingPlanApproval;
}

export function getQueueItemTodoProgress(
	todoProgress: TodoProgressInfo | null
): QueueItemTodoProgressDisplay | null {
	if (!todoProgress) return null;

	return {
		current: todoProgress.current,
		total: todoProgress.total,
		label: todoProgress.label,
	};
}

export function getQueuePlanApprovalToolCall(input: {
	pendingPlanApproval: PlanApprovalInteraction | null;
	effectiveToolCall: ToolCall | null;
	currentStreamingToolCall: ToolCall | null;
	lastToolCall: ToolCall | null;
}): ToolCall | null {
	const { pendingPlanApproval } = input;
	if (!pendingPlanApproval) return null;

	const approvalToolCallId = pendingPlanApproval.tool.callID;

	if (input.effectiveToolCall?.id === approvalToolCallId) {
		return input.effectiveToolCall;
	}

	if (input.currentStreamingToolCall?.id === approvalToolCallId) {
		return input.currentStreamingToolCall;
	}

	if (input.lastToolCall?.id === approvalToolCallId) {
		return input.lastToolCall;
	}

	return null;
}

export function getQueuePlanApprovalPrompt(toolCall: ToolCall | null): string {
	return toolCall?.normalizedQuestions?.[0]?.question ?? "Creating plan";
}

export function getQueuePermissionDisplay(input: {
	readonly permission: PermissionRequest;
	readonly projectPath: string;
}): QueuePermissionDisplay {
	const command = extractPermissionCommand(input.permission);
	const rawFilePath = extractPermissionFilePath(input.permission);
	const filePath = rawFilePath ? makeWorkspaceRelative(rawFilePath, input.projectPath) : null;
	const verb =
		filePath || command
			? (input.permission.permission.split(" ")[0] ?? input.permission.permission)
			: input.permission.permission;

	return {
		command,
		filePath,
		verb,
	};
}
