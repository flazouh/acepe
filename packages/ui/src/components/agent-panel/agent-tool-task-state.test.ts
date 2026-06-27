import { describe, expect, it } from "bun:test";

import {
	getLastTaskToolCall,
	getTaskCurrentToolLabel,
	getTaskProgress,
	getTaskTitle,
	getTaskToolChildren,
	getTaskUiClasses,
	hasTaskPrompt,
	hasTaskResult,
	isTaskPending,
	shouldShowTaskProgress,
} from "./agent-tool-task-state.js";
import type { AnyAgentEntry, AgentToolEntry } from "./types.js";

const toolEntry: AgentToolEntry = {
	id: "tool-1",
	type: "tool_call",
	kind: "execute",
	title: "Run tests",
	status: "done",
};

const nonToolEntry: AnyAgentEntry = {
	id: "assistant-1",
	type: "assistant",
	markdown: "hello",
};

describe("agent tool task state", () => {
	it("detects pending task statuses", () => {
		expect(isTaskPending("pending")).toBe(true);
		expect(isTaskPending("running")).toBe(true);
		expect(isTaskPending("done")).toBe(false);
	});

	it("chooses task titles from status and fallbacks", () => {
		expect(
			getTaskTitle({
				description: null,
				status: "running",
				runningFallback: "Running task...",
				doneFallback: "Task",
			})
		).toBe("Running task...");
		expect(
			getTaskTitle({
				description: null,
				status: "blocked",
				runningFallback: "Running",
				doneFallback: "Task",
			})
		).toBe("Waiting for permission");
		expect(
			getTaskTitle({
				description: "Custom task",
				status: "error",
				runningFallback: "Running",
				doneFallback: "Task",
			})
		).toBe("Custom task");
	});

	it("counts completed tool calls for progress", () => {
		const runningTool: AgentToolEntry = {
			id: "tool-2",
			type: "tool_call",
			kind: "execute",
			title: "Next step",
			status: "running",
		};
		const toolChildren = [toolEntry, runningTool];
		expect(getTaskProgress({ toolCallChildren: toolChildren })).toEqual({
			filledCount: 1,
			totalCount: 2,
		});
		expect(shouldShowTaskProgress(0)).toBe(false);
		expect(shouldShowTaskProgress(2)).toBe(true);
	});

	it("filters child tool calls and finds the latest one", () => {
		const children = [nonToolEntry, toolEntry];
		const toolChildren = getTaskToolChildren(children);
		expect(toolChildren).toEqual([toolEntry]);
		expect(getLastTaskToolCall(toolChildren)).toBe(toolEntry);
		expect(getLastTaskToolCall([])).toBeNull();
	});

	it("returns the latest child tool title for the inline current-tool label", () => {
		const runningTool: AgentToolEntry = {
			id: "tool-2",
			type: "tool_call",
			kind: "read",
			title: "Reading",
			status: "running",
		};
		expect(getTaskCurrentToolLabel(runningTool)).toBe("Reading");
		expect(getTaskCurrentToolLabel(null)).toBeNull();
	});

	it("computes prompt and result visibility", () => {
		expect(hasTaskPrompt("prompt")).toBe(true);
		expect(hasTaskPrompt(null)).toBe(false);
		expect(hasTaskResult({ status: "done", resultText: "result" })).toBe(true);
		expect(hasTaskResult({ status: "running", resultText: "result" })).toBe(false);
	});

	it("returns compact and normal class sets", () => {
		expect(getTaskUiClasses(true).card).toContain("bg-accent");
		expect(getTaskUiClasses(false).header).toContain("h-7");
	});
});
