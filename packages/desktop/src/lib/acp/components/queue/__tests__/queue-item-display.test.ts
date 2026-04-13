import { describe, expect, it } from "bun:test";
import type { ToolCall } from "$lib/acp/types/tool-call.js";

import {
	getQueueItemTaskDisplay,
	getQueueItemToolDisplay,
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

function createTodoToolCall(id: string, status: ToolCall["status"]): ToolCall {
	return {
		id,
		name: "update_todos",
		kind: "todo",
		arguments: {
			kind: "other",
			raw: {
				todos: [
					{
						content: "Verify live rendering",
						activeForm: "Keep todo active",
						status: "in_progress",
					},
				],
			},
		},
		normalizedTodos: [
			{
				content: "Verify live rendering",
				activeForm: "Keep todo active",
				status: "in_progress",
				startedAt: null,
				completedAt: null,
				duration: null,
			},
		],
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
			taskSubagentTools: [
				{
					id: "child-1",
					type: "tool_call",
					kind: "task",
					title: "Task completed",
					subtitle: "Explore community board and email notification ...",
					filePath: undefined,
					status: "done",
				},
				{
					id: "child-2",
					type: "tool_call",
					kind: "task",
					title: "Task completed",
					subtitle: "Trace queue item rendering for task tools",
					filePath: undefined,
					status: "done",
				},
			],
			latestTaskSubagentTool: {
				id: "child-2",
				kind: "task",
				title: "Trace queue item rendering for task tools",
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
		expect(display.taskSubagentTools).toEqual([
			{
				id: "child-1",
				type: "tool_call",
				kind: "search",
				title: "Grep",
				subtitle: "taskChildren",
				filePath: undefined,
				status: "done",
			},
			{
				id: "child-2",
				type: "tool_call",
				kind: "read",
				title: "Reading",
				subtitle: "/repo/child-2.ts",
				filePath: "/repo/child-2.ts",
				status: "running",
			},
		]);
	});

	it("prefers todo-like child tools over trailing reads in compact task summaries", () => {
		const taskTool = createTaskToolCall([
			createTodoToolCall("child-todo", "in_progress"),
			createReadToolCall("child-read", "completed"),
		]);

		const display = getQueueItemTaskDisplay(taskTool, "task", "streaming");

		expect(display.taskDescription).toBe("Keep todo active");
		expect(display.latestTaskSubagentTool).toEqual({
			id: "child-todo",
			kind: "todo",
			title: "Keep todo active",
			filePath: undefined,
			status: "running",
		});
		expect(display.taskSubagentTools[display.taskSubagentTools.length - 1]).toMatchObject({
			id: "child-todo",
			title: "Updating todos",
			subtitle: "Keep todo active",
		});
	});

	it("falls back to the parent task description when no child subagents exist", () => {
		const taskTool = createTaskToolCall([]);

		const display = getQueueItemTaskDisplay(taskTool, "task", "completed");

		expect(display).toEqual({
			taskDescription: "Parent task",
			taskSubagentSummaries: [],
			latestTaskSubagentTool: null,
			taskSubagentTools: [],
			showTaskSubagentList: false,
		});
	});

	it("capitalizes a lowercase parent task description for the card title", () => {
		const taskTool: ToolCall = {
			id: "task-parent-lowercase",
			name: "Task",
			kind: "task",
			arguments: { kind: "think", description: "parent task" },
			status: "completed",
			taskChildren: [],
			awaitingPlanApproval: false,
		};

		const display = getQueueItemTaskDisplay(taskTool, "task", "completed");

		expect(display.taskDescription).toBe("Parent task");
	});
});

describe("getQueueItemToolDisplay", () => {
	it("prefers the live streaming tool over the previous completed tool", () => {
		const lastToolCall = createReadToolCall("last-tool", "completed");
		const liveToolCall = createSearchToolCall("live-tool", "in_progress");

		const display = getQueueItemToolDisplay(
			createToolDisplayInput({
				activityKind: "streaming",
				currentStreamingToolCall: liveToolCall,
				currentToolKind: "search",
				lastToolCall,
				lastToolKind: "read",
			})
		);

		expect(display).toEqual({
			toolCall: liveToolCall,
			toolKind: "search",
			isStreaming: true,
			turnState: "streaming",
		});
	});

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

	it("keeps the live task tool visible while thinking so subagent cards can render", () => {
		const liveTaskTool = createTaskToolCall([
			createSubagentChild("child-1", "Trace kanban mapping"),
		]);

		const display = getQueueItemToolDisplay(
			createToolDisplayInput({
				activityKind: "thinking",
				currentStreamingToolCall: liveTaskTool,
				currentToolKind: "task",
			})
		);

		expect(display).toEqual({
			toolCall: liveTaskTool,
			toolKind: "task",
			isStreaming: true,
			turnState: "streaming",
		});
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
