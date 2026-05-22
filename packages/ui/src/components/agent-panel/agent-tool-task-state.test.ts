import { describe, expect, it } from "bun:test";

import {
	createTaskPreview,
	getLastTaskToolCall,
	getTaskHeaderBorderClass,
	getTaskTitle,
	getTaskToolChildren,
	getTaskUiClasses,
	hasTaskPrompt,
	hasTaskResult,
	isTaskPending,
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

	it("filters child tool calls and finds the latest one", () => {
		const children = [nonToolEntry, toolEntry];
		const toolChildren = getTaskToolChildren(children);
		expect(toolChildren).toEqual([toolEntry]);
		expect(getLastTaskToolCall(toolChildren)).toBe(toolEntry);
		expect(getLastTaskToolCall([])).toBeNull();
	});

	it("computes prompt and result visibility", () => {
		expect(hasTaskPrompt("prompt")).toBe(true);
		expect(hasTaskPrompt(null)).toBe(false);
		expect(hasTaskResult({ status: "done", resultText: "result" })).toBe(true);
		expect(hasTaskResult({ status: "running", resultText: "result" })).toBe(false);
	});

	it("creates short text previews", () => {
		expect(createTaskPreview({ text: "abcdef", limit: 10 })).toBe("abcdef");
		expect(createTaskPreview({ text: "abcdefghijkl", limit: 5 })).toBe("abcde...");
	});

	it("returns compact and normal class sets", () => {
		expect(getTaskUiClasses(true).card).toContain("bg-accent");
		expect(getTaskUiClasses(false).header).toContain("h-7");
		expect(getTaskHeaderBorderClass({ compact: true, hasBorder: true })).toBe(
			"border-b border-border/60"
		);
		expect(getTaskHeaderBorderClass({ compact: false, hasBorder: false })).toBe("");
	});
});
