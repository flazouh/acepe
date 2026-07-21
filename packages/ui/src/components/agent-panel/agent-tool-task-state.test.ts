import { describe, expect, it } from "bun:test";

import {
	getTaskTitle,
	getTaskUiClasses,
	hasTaskPrompt,
	isTaskPending,
} from "./agent-tool-task-state.js";

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

	it("computes prompt visibility", () => {
		expect(hasTaskPrompt("prompt")).toBe(true);
		expect(hasTaskPrompt(null)).toBe(false);
	});

	it("returns compact and normal class sets", () => {
		expect(getTaskUiClasses(true).card).toContain("bg-accent");
		expect(getTaskUiClasses(false).header).toContain("h-6");
		expect(getTaskUiClasses(false).header).toContain("pl-2");
		expect(getTaskUiClasses(false).header).toContain("pr-0.5");
	});

	it("exposes a live-row class for the second (animated) tool row", () => {
		expect(getTaskUiClasses(false).liveRow).toContain("pl-2");
		expect(getTaskUiClasses(true).liveRow).toContain("px-1");
	});
});
