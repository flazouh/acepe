import type { ActivityEntryTodoProgress } from "@acepe/ui";
import type { AgentToolEntry } from "@acepe/ui/agent-panel";
import { capitalizeLeadingCharacter } from "@acepe/ui/utils";

import { getToolCompactDisplayText, getToolKindFilePath } from "../../registry/tool-kind-ui-registry.js";
import type { SessionRuntimeState } from "../../logic/session-ui-state.js";
import type { TurnState } from "../../store/types.js";
import type { SessionStatus } from "../../application/dto/session-status.js";
import type { ToolCall } from "../../types/tool-call.js";
import type { ToolKind } from "../../types/tool-kind.js";
import { convertTaskChildren } from "../tool-calls/tool-call-task/logic/convert-task-children.js";
import {
	compactAgentToolEntry,
	resolveCompactToolDisplay,
	resolveFullToolEntry,
	type CompactToolDisplay,
} from "../tool-calls/tool-definition-registry.js";

export type CompactActivityKind = "idle" | "thinking" | "streaming" | "paused";

export interface ActivityToolSelectionInput {
	readonly activityKind: CompactActivityKind;
	readonly currentStreamingToolCall: ToolCall | null;
	readonly currentToolKind: ToolKind | null;
	readonly lastToolCall: ToolCall | null;
	readonly lastToolKind: ToolKind | null;
}

export interface ActivityToolSelection {
	readonly toolCall: ToolCall;
	readonly toolKind: ToolKind;
	readonly isStreaming: boolean;
	readonly turnState: "streaming" | "completed";
}

export interface ActivityTaskProjection {
	readonly taskDescription: string | null;
	readonly taskSubagentSummaries: readonly string[];
	readonly taskSubagentTools: readonly AgentToolEntry[];
	readonly latestTaskSubagentTool: Pick<
		AgentToolEntry,
		"id" | "kind" | "title" | "filePath" | "status"
	> | null;
	readonly showTaskSubagentList: boolean;
}

export interface ActivityEntryProjectionInput extends ActivityToolSelectionInput {
	readonly todoProgress: ActivityEntryTodoProgress | null;
}

export interface ActivityEntryProjection extends ActivityTaskProjection {
	readonly selectedTool: ActivityToolSelection | null;
	readonly toolCall: ToolCall | null;
	readonly toolKind: ToolKind | null;
	readonly isStreaming: boolean;
	readonly isFileTool: boolean;
	readonly fileToolDisplayText: string | null;
	readonly toolContent: string | null;
	readonly showToolShimmer: boolean;
	readonly todoProgress: ActivityEntryTodoProgress | null;
	readonly latestToolEntry: Pick<
		AgentToolEntry,
		"id" | "kind" | "title" | "subtitle" | "detailsText" | "scriptText" | "filePath" | "status"
	> | null;
	readonly latestTool: CompactToolDisplay | null;
}

export function isActiveCompactActivityKind(activityKind: CompactActivityKind): boolean {
	return activityKind === "streaming" || activityKind === "thinking";
}

export function deriveCompactActivityKind(
	runtimeState: SessionRuntimeState | null,
	sessionStatus: SessionStatus | null
): CompactActivityKind {
	if (runtimeState?.showThinking) {
		return "thinking";
	}

	if (sessionStatus === "paused") {
		return "paused";
	}

	if (runtimeState?.activityPhase === "running") {
		return "streaming";
	}

	return "idle";
}

export function selectActivityTool(
	input: ActivityToolSelectionInput
): ActivityToolSelection | null {
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

function isTodoLikeChild(child: ToolCall): boolean {
	return child.kind === "todo" || (child.normalizedTodos?.length ?? 0) > 0;
}

function getPreferredTaskChildIndex(children: readonly ToolCall[]): number {
	for (let index = children.length - 1; index >= 0; index -= 1) {
		const child = children[index];
		if (child && isTodoLikeChild(child)) {
			return index;
		}
	}

	return children.length - 1;
}

export function getTaskSubagentSummaries(toolCall: ToolCall): string[] {
	const children = toolCall.taskChildren ?? [];
	if (children.length === 0) {
		return [];
	}

	return children.map(getChildSummary).filter((summary): summary is string => summary !== null);
}

export function projectTaskActivity(
	toolCall: ToolCall | null,
	toolKind: ToolKind | null,
	turnState?: TurnState
): ActivityTaskProjection {
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
	const rawChildren = toolCall.taskChildren ?? [];
	const convertedChildren = convertTaskChildren(rawChildren, turnState);
	const preferredChildIndex =
		rawChildren.length > 0 && convertedChildren.length === rawChildren.length
			? getPreferredTaskChildIndex(rawChildren)
			: -1;
	const orderedChildren =
		preferredChildIndex >= 0 && preferredChildIndex < convertedChildren.length
			? convertedChildren
					.filter((_, index) => index !== preferredChildIndex)
					.concat([convertedChildren[preferredChildIndex]])
			: convertedChildren;
	const preferredRawChild =
		preferredChildIndex >= 0 && preferredChildIndex < rawChildren.length
			? rawChildren[preferredChildIndex]
			: null;
	const preferredSummary = preferredRawChild ? getChildSummary(preferredRawChild) : null;
	const latestTaskSubagentTool =
		orderedChildren.length > 0 ? compactAgentToolEntry(orderedChildren[orderedChildren.length - 1]) : null;
	const taskDescription =
		preferredRawChild && isTodoLikeChild(preferredRawChild) && preferredSummary
			? preferredSummary
			: getTaskDescription(toolCall);

	if (taskSubagentSummaries.length > 0) {
		return {
			taskDescription,
			taskSubagentSummaries,
			taskSubagentTools: orderedChildren,
			latestTaskSubagentTool,
			showTaskSubagentList: true,
		};
	}

	return {
		taskDescription,
		taskSubagentSummaries: [],
		taskSubagentTools: [],
		latestTaskSubagentTool,
		showTaskSubagentList: false,
	};
}

function getFileToolDisplayText(
	toolKind: ToolKind | null,
	toolCall: ToolCall | null,
	isStreaming: boolean
): string | null {
	if (!toolCall || !toolKind) {
		return null;
	}

	if (toolKind !== "read" && toolKind !== "edit" && toolKind !== "delete") {
		return null;
	}

	const toolPath = getToolKindFilePath(toolKind, toolCall);
	if (!toolPath) {
		return null;
	}

	const fileName = toolPath.split("/").pop() ?? toolPath;
	const verb =
		toolKind === "read"
			? isStreaming
				? "Reading"
				: "Read"
			: toolKind === "edit"
				? isStreaming
					? "Editing"
					: "Edited"
				: isStreaming
					? "Deleting"
					: "Deleted";

	return `${verb} ${fileName}`;
}

export function projectActivityEntry(
	input: ActivityEntryProjectionInput
): ActivityEntryProjection {
	const selectedTool = selectActivityTool(input);
	const toolCall = selectedTool?.toolCall ?? null;
	const toolKind = selectedTool?.toolKind ?? null;
	const turnState = selectedTool?.turnState;
	const taskProjection = projectTaskActivity(toolCall, toolKind, turnState);
	const isStreaming = selectedTool?.isStreaming ?? false;
	const isFileTool = toolKind === "read" || toolKind === "edit" || toolKind === "delete";
	const fileToolDisplayText = getFileToolDisplayText(toolKind, toolCall, isStreaming);
	const toolContent =
		toolCall && toolKind && !isFileTool
			? getToolCompactDisplayText(toolKind, toolCall, turnState)
			: null;
	const showToolShimmer = (toolKind === "think" || toolKind === "task") && isStreaming;
	const hasTaskCard =
		taskProjection.showTaskSubagentList && taskProjection.taskSubagentTools.length > 0;
	const latestTool =
		toolCall && toolKind && !hasTaskCard && toolKind !== "think"
			? resolveCompactToolDisplay({
					toolCall,
					toolKind,
					turnState,
				})
			: null;
	const latestToolEntry =
		toolCall && toolKind && !hasTaskCard && toolKind !== "think"
			? resolveFullToolEntry({
					toolCall,
					toolKind,
					turnState,
				})
			: null;

	return {
		selectedTool,
		toolCall,
		toolKind,
		isStreaming,
		isFileTool,
		taskDescription: taskProjection.taskDescription,
		taskSubagentSummaries: taskProjection.taskSubagentSummaries,
		taskSubagentTools: taskProjection.taskSubagentTools,
		latestTaskSubagentTool: taskProjection.latestTaskSubagentTool,
		showTaskSubagentList: taskProjection.showTaskSubagentList,
		fileToolDisplayText,
		toolContent,
		showToolShimmer,
		todoProgress: input.todoProgress,
		latestToolEntry,
		latestTool,
	};
}

export function projectSessionPreviewActivity(
	input: ActivityEntryProjectionInput
): ActivityEntryProjection {
	const lastToolCall = isActiveCompactActivityKind(input.activityKind) ? null : input.lastToolCall;
	const lastToolKind = isActiveCompactActivityKind(input.activityKind) ? null : input.lastToolKind;

	return projectActivityEntry({
		activityKind: input.activityKind,
		currentStreamingToolCall: input.currentStreamingToolCall,
		currentToolKind: input.currentToolKind,
		lastToolCall,
		lastToolKind,
		todoProgress: input.todoProgress,
	});
}
