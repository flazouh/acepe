import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ToolCall } from "../../../types/tool-call.js";

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(
		dirname(require.resolve("svelte/package.json")),
		"src/index-client.js"
	);

	return import(/* @vite-ignore */ svelteClientPath);
});

vi.mock("@acepe/ui/agent-panel", async () => {
	const AgentToolTask = (await import("./fixtures/agent-tool-task-stub.svelte")).default;

	return {
		AgentToolTask,
	};
});

const getStreamingArgumentsMock = vi.fn(() => null);

vi.mock("../../../store/index.js", () => ({
	getSessionStore: () => ({
		getStreamingArguments: getStreamingArgumentsMock,
	}),
}));

const { default: ToolCallTask } = await import("../tool-call-task.svelte");

function createChildToolCall(
	overrides: Partial<ToolCall> & Pick<ToolCall, "id" | "kind" | "status">
): ToolCall {
	return {
		id: overrides.id,
		name: overrides.name !== undefined ? overrides.name : "Read",
		kind: overrides.kind,
		status: overrides.status,
		title: overrides.title !== undefined ? overrides.title : "Read file",
		arguments:
			overrides.arguments !== undefined
				? overrides.arguments
				: { kind: "read", file_path: "/repo/src/task.ts" },
		locations: overrides.locations !== undefined ? overrides.locations : null,
		skillMeta: overrides.skillMeta !== undefined ? overrides.skillMeta : null,
		result: overrides.result !== undefined ? overrides.result : null,
		awaitingPlanApproval:
			overrides.awaitingPlanApproval !== undefined ? overrides.awaitingPlanApproval : false,
		taskChildren: overrides.taskChildren !== undefined ? overrides.taskChildren : null,
	};
}

function createTaskToolCall(children: ToolCall[]): ToolCall {
	return {
		id: "tool-task-1",
		name: "Task",
		kind: "task",
		status: "completed",
		title: "Task",
		arguments: {
			kind: "think",
			subagent_type: "reviewer",
			description: "Review the implementation",
			prompt: "Inspect the last child tool status",
		},
		locations: null,
		skillMeta: null,
		result: "Completed successfully",
		awaitingPlanApproval: false,
		taskChildren: children,
	};
}

describe("ToolCallTask", () => {
	afterEach(() => {
		cleanup();
		getStreamingArgumentsMock.mockReset();
		getStreamingArgumentsMock.mockReturnValue(null);
	});

	it("stops the final child shimmer and opts into the success icon when the task finishes", () => {
		const toolCall = createTaskToolCall([
			createChildToolCall({
				id: "child-1",
				kind: "read",
				status: "in_progress",
				result: null,
			}),
		]);

		const view = render(ToolCallTask, {
			toolCall,
			turnState: "completed",
		});

		const taskNode = view.getByTestId("agent-tool-task");
		const serializedChildren = taskNode.getAttribute("data-children");
		const children = JSON.parse(serializedChildren !== null ? serializedChildren : "[]") as Array<{
			status: string;
		}>;

		expect(taskNode.getAttribute("data-show-done-icon")).toBe("true");
		expect(children[0]?.status).toBe("done");
	});
});
