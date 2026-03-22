import { describe, expect, it } from "bun:test";
import type { ToolCall } from "$lib/acp/types/tool-call.js";

import { getTaskSubagentSummaries } from "../queue-item-display.js";

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
