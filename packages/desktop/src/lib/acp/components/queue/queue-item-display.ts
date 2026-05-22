import type { TurnState } from "../../store/types.js";
import type { ToolCall } from "../../types/tool-call.js";
import type { ToolKind } from "../../types/tool-kind.js";
import {
	type ActivityEntryProjection,
	type ActivityEntryProjectionInput,
	type ActivityTaskProjection,
	type ActivityToolSelection,
	type ActivityToolSelectionInput,
	getTaskSubagentSummaries as getProjectedTaskSubagentSummaries,
	isActiveCompactActivityKind,
	projectActivityEntry,
	projectTaskActivity,
} from "../activity-entry/activity-entry-projection.js";

export type QueueItemToolDisplayInput = ActivityToolSelectionInput;

export type QueueItemToolDisplay = ActivityToolSelection;

export type QueueItemTaskDisplay = ActivityTaskProjection;

export function getQueueItemToolDisplay(
	input: QueueItemToolDisplayInput
): QueueItemToolDisplay | null {
	return projectQueueItemActivity({
		activityKind: input.activityKind,
		currentStreamingToolCall: input.currentStreamingToolCall,
		currentToolKind: input.currentToolKind,
		lastToolCall: input.lastToolCall,
		lastToolKind: input.lastToolKind,
		todoProgress: null,
	}).selectedTool;
}

export function projectQueueItemActivity(
	input: ActivityEntryProjectionInput
): ActivityEntryProjection {
	const lastToolCall = isActiveCompactActivityKind(input.activityKind) ? input.lastToolCall : null;
	const lastToolKind = isActiveCompactActivityKind(input.activityKind) ? input.lastToolKind : null;

	return projectActivityEntry({
		activityKind: input.activityKind,
		currentStreamingToolCall: input.currentStreamingToolCall,
		currentToolKind: input.currentToolKind,
		lastToolCall,
		lastToolKind,
		todoProgress: input.todoProgress,
	});
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
