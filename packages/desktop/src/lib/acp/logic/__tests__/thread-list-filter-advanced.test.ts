import { describe, expect, it } from "bun:test";

import type { SessionDisplayItem } from "../../types/thread-display-item.js";
import { EMPTY_FILTER } from "../../types/thread-filter.js";
import {
	applyThreadFilter,
	filterThreadsByAgent,
	filterThreadsByDateRange,
	filterThreadsByProject,
} from "../thread-list-filter.js";

describe("thread-list-filter-advanced", () => {
	// Thread Identity: id IS the session ID (canonical)
	const mockThreads: SessionDisplayItem[] = [
		{
			id: "session-1", // id IS the sessionId
			title: "Fix bug in login",
			agentId: "claude-code",
			projectPath: "/path/to/project-a",
			projectName: "project-a",
			createdAt: new Date("2024-01-15"),
		},
		{
			id: "session-2",
			title: "Add feature X",
			agentId: "cursor",
			projectPath: "/path/to/project-b",
			projectName: "project-b",
			createdAt: new Date("2024-01-20"),
		},
		{
			id: "session-3",
			title: "Refactor code",
			agentId: "claude-code",
			projectPath: "/path/to/project-a",
			projectName: "project-a",
			createdAt: new Date("2024-02-01"),
		},
		{
			id: "session-4",
			title: "Update dependencies",
			agentId: "claude-code",
			projectPath: "/path/to/project-c",
			projectName: "project-c",
			createdAt: new Date("2024-02-15"),
		},
	];

	describe("applyThreadFilter", () => {
		it("should return all threads when filter is empty", () => {
			const result = applyThreadFilter(mockThreads, EMPTY_FILTER);
			expect(result).toEqual(mockThreads);
		});

		it("should filter by project paths", () => {
			const result = applyThreadFilter(mockThreads, {
				projectPaths: ["/path/to/project-a"],
			});
			expect(result.length).toBe(2);
			expect(result.every((t) => t.projectPath === "/path/to/project-a")).toBe(true);
		});

		it("should filter by multiple project paths", () => {
			const result = applyThreadFilter(mockThreads, {
				projectPaths: ["/path/to/project-a", "/path/to/project-b"],
			});
			expect(result.length).toBe(3);
			expect(
				result.every(
					(t) => t.projectPath === "/path/to/project-a" || t.projectPath === "/path/to/project-b"
				)
			).toBe(true);
		});

		it("should filter by agent IDs", () => {
			const result = applyThreadFilter(mockThreads, {
				agentIds: ["claude-code"],
			});
			expect(result.length).toBe(3);
			expect(result.every((t) => t.agentId === "claude-code")).toBe(true);
		});

		it("should filter by multiple agent IDs", () => {
			const result = applyThreadFilter(mockThreads, {
				agentIds: ["claude-code", "cursor"],
			});
			expect(result.length).toBe(4);
		});

		it("should filter by date range", () => {
			const result = applyThreadFilter(mockThreads, {
				dateRange: {
					start: new Date("2024-01-20"),
					end: new Date("2024-02-10"),
				},
			});
			expect(result.length).toBe(2);
			expect(
				result.every((t) => {
					const time = t.createdAt.getTime();
					return (
						time >= new Date("2024-01-20").getTime() && time <= new Date("2024-02-10").getTime()
					);
				})
			).toBe(true);
		});

		it("should filter by search query", () => {
			const result = applyThreadFilter(mockThreads, {
				searchQuery: "bug",
			});
			expect(result.length).toBe(1);
			expect(result[0].title).toBe("Fix bug in login");
		});

		it("should filter by session IDs (thread.id IS the session ID)", () => {
			const result = applyThreadFilter(mockThreads, {
				sessionIds: ["session-1", "session-3"],
			});
			expect(result.length).toBe(2);
			// id IS the session ID (canonical)
			expect(result.every((t) => t.id === "session-1" || t.id === "session-3")).toBe(true);
		});

		it("should combine multiple filters with AND logic", () => {
			const result = applyThreadFilter(mockThreads, {
				projectPaths: ["/path/to/project-a"],
				agentIds: ["claude-code"],
			});
			expect(result.length).toBe(2);
			expect(result.some((t) => t.id === "session-1")).toBe(true);
			expect(result.some((t) => t.id === "session-3")).toBe(true);
		});

		it("should return empty array when no threads match", () => {
			const result = applyThreadFilter(mockThreads, {
				projectPaths: ["/nonexistent/project"],
			});
			expect(result).toEqual([]);
		});

		it("should handle empty input array", () => {
			const result = applyThreadFilter([], EMPTY_FILTER);
			expect(result).toEqual([]);
		});
	});

	describe("filterThreadsByProject", () => {
		it("should filter threads by project path", () => {
			const result = filterThreadsByProject(mockThreads, "/path/to/project-a");
			expect(result.length).toBe(2);
			expect(result.every((t) => t.projectPath === "/path/to/project-a")).toBe(true);
		});

		it("should return empty array for nonexistent project", () => {
			const result = filterThreadsByProject(mockThreads, "/nonexistent/project");
			expect(result).toEqual([]);
		});
	});

	describe("filterThreadsByAgent", () => {
		it("should filter threads by agent ID", () => {
			const result = filterThreadsByAgent(mockThreads, "claude-code");
			expect(result.length).toBe(3);
			expect(result.every((t) => t.agentId === "claude-code")).toBe(true);
		});

		it("should return empty array for nonexistent agent", () => {
			const result = filterThreadsByAgent(mockThreads, "nonexistent-agent");
			expect(result).toEqual([]);
		});
	});

	describe("filterThreadsByDateRange", () => {
		it("should filter threads by date range", () => {
			const result = filterThreadsByDateRange(
				mockThreads,
				new Date("2024-01-20"),
				new Date("2024-02-10")
			);
			expect(result.length).toBe(2);
		});

		it("should include threads on boundary dates", () => {
			const result = filterThreadsByDateRange(
				mockThreads,
				new Date("2024-01-15"),
				new Date("2024-01-15")
			);
			expect(result.length).toBe(1);
			expect(result[0].id).toBe("session-1");
		});

		it("should return empty array when no threads in range", () => {
			const result = filterThreadsByDateRange(
				mockThreads,
				new Date("2025-01-01"),
				new Date("2025-01-31")
			);
			expect(result).toEqual([]);
		});
	});
});
