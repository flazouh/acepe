import type { TurnState } from "../../store/types.js";
import type { ToolCall } from "../../types/tool-call.js";
import type { ToolKind } from "../../types/tool-kind.js";
import {
	getTaskSubagentSummaries as getProjectedTaskSubagentSummaries,
	projectTaskActivity,
	selectActivityTool,
	type ActivityTaskProjection,
	type ActivityToolSelection,
	type ActivityToolSelectionInput,
} from "../activity-entry/activity-entry-projection.js";

export type QueueItemToolDisplayInput = ActivityToolSelectionInput;

export type QueueItemToolDisplay = ActivityToolSelection;

export type QueueItemTaskDisplay = ActivityTaskProjection;

export function getQueueItemToolDisplay(
	input: QueueItemToolDisplayInput
): QueueItemToolDisplay | null {
	return selectActivityTool(input);
}

export function getTaskSubagentSummaries(toolCall: ToolCall): string[] {
	return getProjectedTaskSubagentSummaries(toolCall);
}

export function getQueueItemTaskDisplay(
	toolCall: ToolCall | null,
	toolKind: ToolKind | null,
	turnState?: TurnState
): QueueItemTaskDisplay {
	return projectTaskActivity(toolCall, toolKind, turnState);
}
