import { describe, expect, it } from "bun:test";
import type { ToolCall } from "$lib/acp/types/tool-call.js";

import {
	getQueueItemToolDisplay,
	getQueueItemTaskDisplay,
	getTaskSubagentSummaries,
	type QueueItemToolDisplayInput,
} from "../queue-item-display.js";

function createTaskToolCall(children: ToolCall[]): ToolCall {
	return {
		id: "task-parent",
		name: "Task",
		kind: "task",
		arguments: { kind: "think", description: "Parent task" },
		status: "in_progress",
		taskChildren: children,
		awaitingPlanApproval: false,
	};
}

function createSubagentChild(id: string, description: string): ToolCall {
	return {
		id,
		name: "Task",
		kind: "task",
		arguments: { kind: "think", description },
		status: "completed",
		awaitingPlanApproval: false,
	};
}

function createReadToolCall(id: string, status: ToolCall["status"]): ToolCall {
	return {
		id,
		name: "Read",
		kind: "read",
		arguments: {
			kind: "read",
			file_path: `/repo/${id}.ts`,
		},
		status,
		awaitingPlanApproval: false,
	};
}

function createSearchToolCall(id: string, status: ToolCall["status"]): ToolCall {
	return {
		id,
		name: "Search",
		kind: "search",
		arguments: {
			kind: "search",
			query: "taskChildren",
		},
		status,
		awaitingPlanApproval: false,
	};
}

function createToolDisplayInput(
	overrides: Partial<QueueItemToolDisplayInput> = {}
): QueueItemToolDisplayInput {
	return {
		activityKind: "idle",
		currentStreamingToolCall: null,
		currentToolKind: null,
		lastToolCall: null,
		lastToolKind: null,
		...overrides,
	};
}

describe("getTaskSubagentSummaries", () => {
	it("returns all child subagent descriptions for task tools", () => {
		const taskTool = createTaskToolCall([
			createSubagentChild("child-1", "Investigate message entry rendering"),
			createSubagentChild("child-2", "Investigate recent streaming changes"),
			createSubagentChild("child-3", "Investigate queue task item formatting"),
		]);

		const summaries = getTaskSubagentSummaries(taskTool);

		expect(summaries).toEqual([
			"Investigate message entry rendering",
			"Investigate recent streaming changes",
			"Investigate queue task item formatting",
		]);
	});

	it("returns an empty list when task has no children", () => {
		const taskTool = createTaskToolCall([]);

		expect(getTaskSubagentSummaries(taskTool)).toEqual([]);
	});
});

describe("getQueueItemTaskDisplay", () => {
	it("keeps the parent task label for the card header while showing child tool details", () => {
		const taskTool = createTaskToolCall([
			createSubagentChild("child-1", "Explore community board and email notification code"),
			createSubagentChild("child-2", "Trace queue item rendering for task tools"),
		]);

		const display = getQueueItemTaskDisplay(taskTool, "task", "completed");

		expect(display).toEqual({
			taskDescription: "Parent task",
			taskSubagentSummaries: [
				"Explore community board and email notification code",
				"Trace queue item rendering for task tools",
			],
			latestTaskSubagentTool: {
				id: "child-2",
				kind: "task",
				title: "Task completed",
				filePath: undefined,
				status: "done",
			},
			showTaskSubagentList: true,
		});
	});

	it("returns the latest child tool metadata for compact queue rendering", () => {
		const taskTool = createTaskToolCall([
			createSearchToolCall("child-1", "completed"),
			createReadToolCall("child-2", "in_progress"),
		]);

		const display = getQueueItemTaskDisplay(taskTool, "task", "streaming");

		expect(display.latestTaskSubagentTool).toEqual({
			id: "child-2",
			kind: "read",
			title: "Reading",
			filePath: "/repo/child-2.ts",
			status: "running",
		});
	});

	it("falls back to the parent task description when no child subagents exist", () => {
		const taskTool = createTaskToolCall([]);

		const display = getQueueItemTaskDisplay(taskTool, "task", "completed");

		expect(display).toEqual({
			taskDescription: "Parent task",
			taskSubagentSummaries: [],
			latestTaskSubagentTool: null,
			showTaskSubagentList: false,
		});
	});
});

describe("getQueueItemToolDisplay", () => {
	it("falls back to the last completed tool when no live tool is streaming", () => {
		const lastToolCall = createReadToolCall("last-tool", "completed");

		const display = getQueueItemToolDisplay(
			createToolDisplayInput({
				activityKind: "streaming",
				lastToolCall,
				lastToolKind: "read",
			})
		);

		expect(display).toEqual({
			toolCall: lastToolCall,
			toolKind: "read",
			isStreaming: false,
			turnState: "completed",
		});
	});

	it("suppresses tool display while the session is planning next moves", () => {
		const lastToolCall = createReadToolCall("last-tool", "completed");

		const display = getQueueItemToolDisplay(
			createToolDisplayInput({
				activityKind: "thinking",
				lastToolCall,
				lastToolKind: "read",
			})
		);

		expect(display).toBeNull();
	});

	it("marks the displayed tool as streaming when it matches the live tool", () => {
		const liveToolCall = createReadToolCall("live-tool", "in_progress");

		const display = getQueueItemToolDisplay(
			createToolDisplayInput({
				activityKind: "streaming",
				currentStreamingToolCall: liveToolCall,
				currentToolKind: "read",
				lastToolCall: liveToolCall,
				lastToolKind: "read",
			})
		);

		expect(display).toEqual({
			toolCall: liveToolCall,
			toolKind: "read",
			isStreaming: true,
			turnState: "streaming",
		});
	});
});
