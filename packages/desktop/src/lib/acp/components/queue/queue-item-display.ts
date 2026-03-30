import { getToolKindSubtitle, getToolKindTitle } from "../../registry/tool-kind-ui-registry.js";
import type { ToolCall } from "../../types/tool-call.js";
import type { ToolKind } from "../../types/tool-kind.js";

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

export function getQueueItemToolDisplay(
	input: QueueItemToolDisplayInput
): QueueItemToolDisplay | null {
	if (input.activityKind === "thinking") {
		return null;
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

function getChildSummary(child: ToolCall): string | null {
	if (child.arguments.kind === "think" && child.arguments.description) {
		const trimmedDescription = child.arguments.description.trim();
		if (trimmedDescription.length > 0) {
			return trimmedDescription;
		}
	}

	const childKind = child.kind ?? "other";
	const subtitle = getToolKindSubtitle(childKind, child)?.trim();
	if (subtitle && subtitle.length > 0) {
		return subtitle;
	}

	const title = getToolKindTitle(childKind, child).trim();
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
