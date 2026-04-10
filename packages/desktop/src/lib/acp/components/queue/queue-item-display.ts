import type { AgentToolEntry } from "@acepe/ui/agent-panel";
import { capitalizeLeadingCharacter } from "@acepe/ui/utils";
import type { TurnState } from "../../store/types.js";
import type { ToolCall } from "../../types/tool-call.js";
import type { ToolKind } from "../../types/tool-kind.js";
import { convertTaskChildren } from "../tool-calls/tool-call-task/logic/convert-task-children.js";
import {
	compactAgentToolEntry,
	resolveFullToolEntry,
} from "../tool-calls/tool-definition-registry.js";

export interface QueueItemToolDisplayInput {
	readonly activityKind: "idle" | "thinking" | "streaming" | "paused";
	readonly currentStreamingToolCall: ToolCall | null;
	readonly currentToolKind: ToolKind | null;
	readonly lastToolCall: ToolCall | null;
	readonly lastToolKind: ToolKind | null;
}

export interface QueueItemToolDisplay {
	readonly toolCall: ToolCall;
	readonly toolKind: ToolKind;
	readonly isStreaming: boolean;
	readonly turnState: "streaming" | "completed";
}

export interface QueueItemTaskDisplay {
	readonly taskDescription: string | null;
	readonly taskSubagentSummaries: readonly string[];
	readonly taskSubagentTools: readonly AgentToolEntry[];
	readonly latestTaskSubagentTool: Pick<
		AgentToolEntry,
		"id" | "kind" | "title" | "filePath" | "status"
	> | null;
	readonly showTaskSubagentList: boolean;
}

export function getQueueItemToolDisplay(
	input: QueueItemToolDisplayInput
): QueueItemToolDisplay | null {
	if (input.activityKind === "thinking") {
		if (input.currentStreamingToolCall && input.currentToolKind === "task") {
			return {
				toolCall: input.currentStreamingToolCall,
				toolKind: input.currentToolKind,
				isStreaming: true,
				turnState: "streaming",
			};
		}

		return null;
	}

	if (
		input.activityKind === "streaming" &&
		input.currentStreamingToolCall &&
		input.currentToolKind
	) {
		return {
			toolCall: input.currentStreamingToolCall,
			toolKind: input.currentToolKind,
			isStreaming: true,
			turnState: "streaming",
		};
	}

	if (!input.lastToolCall || !input.lastToolKind) {
		return null;
	}

	const isStreaming =
		input.currentStreamingToolCall?.id === input.lastToolCall.id &&
		input.currentToolKind === input.lastToolKind;

	return {
		toolCall: input.lastToolCall,
		toolKind: input.lastToolKind,
		isStreaming,
		turnState: isStreaming ? "streaming" : "completed",
	};
}

function getTaskDescription(toolCall: ToolCall): string | null {
	if (toolCall.arguments.kind !== "think") {
		return null;
	}

	if (toolCall.arguments.description) {
		const trimmedDescription = toolCall.arguments.description.trim();
		if (trimmedDescription.length > 0) {
			return capitalizeLeadingCharacter(trimmedDescription);
		}
	}

	if (toolCall.arguments.subagent_type) {
		const trimmedSubagentType = toolCall.arguments.subagent_type.trim();
		return trimmedSubagentType.length > 0 ? capitalizeLeadingCharacter(trimmedSubagentType) : null;
	}

	return null;
}

function getChildSummary(child: ToolCall): string | null {
	if (child.arguments.kind === "think" && child.arguments.description) {
		const trimmedDescription = child.arguments.description.trim();
		if (trimmedDescription.length > 0) {
			return trimmedDescription;
		}
	}

	const entry = resolveFullToolEntry({ toolCall: child });
	const subtitle = entry.subtitle?.trim();
	if (subtitle && subtitle.length > 0) {
		return subtitle;
	}

	const title = entry.title.trim();
	return title.length > 0 ? title : null;
}

/**
 * Extract ordered sub-agent summaries from a Task tool call.
 * Returns one display string per child tool call.
 */
export function getTaskSubagentSummaries(toolCall: ToolCall): string[] {
	const children = toolCall.taskChildren ?? [];
	if (children.length === 0) {
		return [];
	}

	return children.map(getChildSummary).filter((summary): summary is string => summary !== null);
}

export function getQueueItemTaskDisplay(
	toolCall: ToolCall | null,
	toolKind: ToolKind | null,
	turnState?: TurnState
): QueueItemTaskDisplay {
	if (!toolCall || toolKind !== "task") {
		return {
			taskDescription: null,
			taskSubagentSummaries: [],
			taskSubagentTools: [],
			latestTaskSubagentTool: null,
			showTaskSubagentList: false,
		};
	}

	const taskSubagentSummaries = getTaskSubagentSummaries(toolCall);
	const convertedChildren = convertTaskChildren(toolCall.taskChildren, turnState);
	const latestTaskSubagentTool =
		convertedChildren.length > 0
			? compactAgentToolEntry(convertedChildren[convertedChildren.length - 1])
			: null;

	if (taskSubagentSummaries.length > 0) {
		return {
			taskDescription: getTaskDescription(toolCall),
			taskSubagentSummaries,
			taskSubagentTools: convertedChildren,
			latestTaskSubagentTool,
			showTaskSubagentList: true,
		};
	}

	return {
		taskDescription: getTaskDescription(toolCall),
		taskSubagentSummaries: [],
		taskSubagentTools: [],
		latestTaskSubagentTool,
		showTaskSubagentList: false,
	};
}
