import { describe, expect, it } from "bun:test";

import type { SessionEntry } from "$lib/acp/application/dto/session-entry.js";
import type { ToolCall } from "$lib/acp/types/tool-call.js";

import {
	projectActivityEntry,
	projectActivityEntryFromSessionEntries,
} from "../activity-entry-projection.js";

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

function createToolEntry(toolCall: ToolCall, isStreaming = false): SessionEntry {
	return {
		id: `entry-${toolCall.id}`,
		type: "tool_call",
		message: toolCall,
		isStreaming,
		timestamp: new Date("2026-04-12T03:00:00.000Z"),
	};
}

describe("projectActivityEntry", () => {
	it("prefers nested todo children over trailing reads in task projections", () => {
		const taskTool = createTaskToolCall([
			createTodoToolCall("child-todo", "in_progress"),
			createReadToolCall("child-read", "completed"),
		]);

		const projection = projectActivityEntry({
			activityKind: "streaming",
			currentStreamingToolCall: taskTool,
			currentToolKind: "task",
			lastToolCall: null,
			lastToolKind: null,
			todoProgress: null,
		});

		expect(projection.taskDescription).toBe("Keep todo active");
		expect(projection.latestTaskSubagentTool).toEqual({
			id: "child-todo",
			kind: "other",
			title: "Keep todo active",
			filePath: undefined,
			status: "running",
		});
	});

	it("surfaces compact file display details for read tools", () => {
		const readTool = createReadToolCall("alpha", "completed");

		const projection = projectActivityEntry({
			activityKind: "idle",
			currentStreamingToolCall: null,
			currentToolKind: null,
			lastToolCall: readTool,
			lastToolKind: "read",
			todoProgress: null,
		});

		expect(projection.fileToolDisplayText).toContain("alpha.ts");
		expect(projection.latestToolEntry?.title).toBe("Read");
		expect(projection.latestToolEntry?.filePath).toBe("/repo/alpha.ts");
		expect(projection.latestTool?.filePath).toBe("/repo/alpha.ts");
	});
});

describe("projectActivityEntryFromSessionEntries", () => {
	it("suppresses last completed tools while thinking", () => {
		const readTool = createReadToolCall("finished-read", "completed");

		const projection = projectActivityEntryFromSessionEntries({
			entries: [createToolEntry(readTool)],
			activityKind: "thinking",
			todoProgress: null,
			includeLastCompletedTool: true,
		});

		expect(projection.selectedTool).toBeNull();
		expect(projection.toolContent).toBeNull();
	});

	it("keeps a live task tool visible while thinking", () => {
		const liveTask = createTaskToolCall([createTodoToolCall("child-todo", "in_progress")]);

		const projection = projectActivityEntryFromSessionEntries({
			entries: [createToolEntry(liveTask, true)],
			activityKind: "thinking",
			todoProgress: null,
			includeLastCompletedTool: true,
		});

		expect(projection.selectedTool?.toolKind).toBe("task");
		expect(projection.showTaskSubagentList).toBe(true);
	});
});
