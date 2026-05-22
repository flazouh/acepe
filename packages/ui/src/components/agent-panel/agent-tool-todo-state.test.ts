import { describe, expect, test } from "bun:test";
import {
	formatTodoDuration,
	getTodoDisplayRows,
	getTodoProgressSummary,
} from "./agent-tool-todo-state.js";
import type { AgentTodoItem } from "./types.js";

const todos: AgentTodoItem[] = [
	{ content: "Plan work", status: "completed", duration: 1_200 },
	{
		content: "Build feature",
		activeForm: "Building feature",
		status: "in_progress",
		duration: 65_000,
	},
	{ content: "Verify feature", status: "pending", duration: null },
];

describe("agent tool todo state", () => {
	test("summarizes progress counts", () => {
		expect(getTodoProgressSummary(todos)).toEqual({
			totalTasks: 3,
			completedCount: 1,
			inProgressIndex: 1,
			progressPercent: 33,
		});
	});

	test("returns empty progress for no todos", () => {
		expect(getTodoProgressSummary([])).toEqual({
			totalTasks: 0,
			completedCount: 0,
			inProgressIndex: -1,
			progressPercent: 0,
		});
	});

	test("formats durations for rows", () => {
		expect(formatTodoDuration(null)).toBe("-");
		expect(formatTodoDuration(undefined)).toBe("-");
		expect(formatTodoDuration(42_000)).toBe("42s");
		expect(formatTodoDuration(125_000)).toBe("2m 5s");
		expect(formatTodoDuration(7_260_000)).toBe("2h 1m");
	});

	test("builds display rows with active form only for live current task", () => {
		const rows = getTodoDisplayRows({
			todos,
			isLive: true,
			inProgressIndex: 1,
		});

		expect(rows[0]?.displayText).toBe("Plan work");
		expect(rows[1]?.isCurrent).toBe(true);
		expect(rows[1]?.isCurrentAndLive).toBe(true);
		expect(rows[1]?.displayText).toBe("Building feature");
		expect(rows[1]?.durationText).toBe("1m 5s");
		expect(rows[2]?.durationText).toBe("-");
	});

	test("uses normal content when current task is not live", () => {
		const rows = getTodoDisplayRows({
			todos,
			isLive: false,
			inProgressIndex: 1,
		});

		expect(rows[1]?.isCurrent).toBe(true);
		expect(rows[1]?.isCurrentAndLive).toBe(false);
		expect(rows[1]?.displayText).toBe("Build feature");
	});
});
