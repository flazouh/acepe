import { describe, expect, it } from "bun:test";

import type { SessionDisplayItem } from "../../types/thread-display-item.js";
import { EMPTY_FILTER } from "../../types/thread-filter.js";
import { aggregateThreads, validateFilter } from "../thread-list-aggregator.js";

describe("thread-list-aggregator", () => {
	// Thread Identity: id IS the session ID (canonical)
	const activeThreads: SessionDisplayItem[] = [
		{
			id: "session-1", // id IS the sessionId
			title: "Active Thread 1",
			agentId: "claude-code",
			projectPath: "/path/to/project-a",
			projectName: "project-a",
			createdAt: new Date("2024-01-15"),
		},
		{
			id: "session-2",
			title: "Active Thread 2",
			agentId: "cursor",
			projectPath: "/path/to/project-b",
			projectName: "project-b",
			createdAt: new Date("2024-01-20"),
		},
	];

	const historicalConversations: SessionDisplayItem[] = [
		{
			id: "session-3",
			title: "Historical Conversation 1",
			agentId: "claude-code",
			projectPath: "/path/to/project-a",
			projectName: "project-a",
			createdAt: new Date("2024-01-10"),
		},
		{
			id: "session-1", // Same as active thread - will be deduplicated
			title: "Historical Conversation (same session)",
			agentId: "claude-code",
			projectPath: "/path/to/project-a",
			projectName: "project-a",
			createdAt: new Date("2024-01-12"),
		},
	];

	describe("aggregateThreads", () => {
		it("should merge active threads and historical conversations", () => {
			const result = aggregateThreads(activeThreads, historicalConversations);
			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				// Should have 3 unique threads (session-1 is deduplicated, active takes precedence)
				expect(result.value.length).toBe(3);
			}
		});

		it("should prefer active threads over historical when id matches", () => {
			const result = aggregateThreads(activeThreads, historicalConversations);
			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				// id IS the session ID (canonical)
				const session1Thread = result.value.find((t) => t.id === "session-1");
				expect(session1Thread).toBeDefined();
				expect(session1Thread?.title).toBe("Active Thread 1");
			}
		});

		it("should sort threads by createdAt descending", () => {
			const result = aggregateThreads(activeThreads, historicalConversations);
			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				const sorted = result.value;
				for (let i = 0; i < sorted.length - 1; i++) {
					expect(sorted[i].createdAt.getTime() >= sorted[i + 1].createdAt.getTime()).toBe(true);
				}
			}
		});

		it("should apply filter when provided", () => {
			const result = aggregateThreads(activeThreads, historicalConversations, {
				projectPaths: ["/path/to/project-a"],
			});
			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				expect(result.value.length).toBe(2);
				expect(result.value.every((t) => t.projectPath === "/path/to/project-a")).toBe(true);
			}
		});

		it("should apply multiple filters", () => {
			const result = aggregateThreads(activeThreads, historicalConversations, {
				projectPaths: ["/path/to/project-a"],
				agentIds: ["claude-code"],
			});
			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				expect(result.value.length).toBe(2);
				expect(
					result.value.every(
						(t) => t.projectPath === "/path/to/project-a" && t.agentId === "claude-code"
					)
				).toBe(true);
			}
		});

		it("should handle empty active threads", () => {
			const result = aggregateThreads([], historicalConversations);
			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				expect(result.value.length).toBe(2);
			}
		});

		it("should handle empty historical conversations", () => {
			const result = aggregateThreads(activeThreads, []);
			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				expect(result.value.length).toBe(2);
			}
		});

		it("should handle both empty", () => {
			const result = aggregateThreads([], []);
			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				expect(result.value).toEqual([]);
			}
		});
	});

	describe("validateFilter", () => {
		it("should return ok for empty filter", () => {
			const result = validateFilter(EMPTY_FILTER);
			expect(result.isOk()).toBe(true);
		});

		it("should return ok for valid date range", () => {
			const result = validateFilter({
				dateRange: {
					start: new Date("2024-01-01"),
					end: new Date("2024-01-31"),
				},
			});
			expect(result.isOk()).toBe(true);
		});

		it("should return error for invalid date range (start after end)", () => {
			const result = validateFilter({
				dateRange: {
					start: new Date("2024-01-31"),
					end: new Date("2024-01-01"),
				},
			});
			expect(result.isErr()).toBe(true);
			if (result.isErr()) {
				expect(result.error.message).toContain("Date range start must be");
			}
		});

		it("should return error for empty projectPaths array", () => {
			const result = validateFilter({
				projectPaths: [],
			});
			expect(result.isErr()).toBe(true);
			if (result.isErr()) {
				expect(result.error.message).toContain("projectPaths");
			}
		});

		it("should return error for empty agentIds array", () => {
			const result = validateFilter({
				agentIds: [],
			});
			expect(result.isErr()).toBe(true);
			if (result.isErr()) {
				expect(result.error.message).toContain("agentIds");
			}
		});

		it("should return error for empty sessionIds array", () => {
			const result = validateFilter({
				sessionIds: [],
			});
			expect(result.isErr()).toBe(true);
			if (result.isErr()) {
				expect(result.error.message).toContain("sessionIds");
			}
		});

		it("should return ok for valid filter with non-empty arrays", () => {
			const result = validateFilter({
				projectPaths: ["/path/to/project"],
				agentIds: ["claude-code"],
				sessionIds: ["session-1"],
			});
			expect(result.isOk()).toBe(true);
		});
	});
});
