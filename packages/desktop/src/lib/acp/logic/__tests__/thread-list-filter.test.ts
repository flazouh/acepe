import { describe, expect, it } from "bun:test";
import { TIME_GROUPS } from "../../constants/thread-list-constants.js";
import type { SessionDisplayItem } from "../../types/thread-display-item.js";
import { filterThreadsByQuery, groupThreadsByTime } from "../thread-list-filter.js";

describe("thread-list-filter", () => {
	// Thread Identity: id IS the session ID (canonical)
	const mockThreads: SessionDisplayItem[] = [
		{
			id: "session-1", // id IS the sessionId
			title: "React Component",
			agentId: "claude-code",
			projectPath: "/path/to/react-app",
			projectName: "react-app",
			createdAt: new Date(),
		},
		{
			id: "session-2",
			title: "TypeScript Types",
			agentId: "claude-code",
			projectPath: "/path/to/typescript-project",
			projectName: "typescript-project",
			createdAt: new Date(Date.now() - 86_400_000), // Yesterday
		},
		{
			id: "session-3",
			title: "Database Schema",
			agentId: "cursor",
			projectPath: "/path/to/db-project",
			projectName: "db-project",
			createdAt: new Date(Date.now() - 7 * 86_400_000), // 7 days ago
		},
	];

	describe("filterThreadsByQuery", () => {
		it("should return all threads when query is empty", () => {
			const result = filterThreadsByQuery(mockThreads, "");
			expect(result).toEqual(mockThreads);
		});

		it("should return all threads when query is whitespace only", () => {
			const result = filterThreadsByQuery(mockThreads, "   ");
			expect(result).toEqual(mockThreads);
		});

		it("should filter by title (case insensitive)", () => {
			const result = filterThreadsByQuery(mockThreads, "react");
			expect(result).toHaveLength(1);
			expect(result[0].title).toBe("React Component");
		});

		it("should filter by title (case insensitive - uppercase)", () => {
			const result = filterThreadsByQuery(mockThreads, "REACT");
			expect(result).toHaveLength(1);
			expect(result[0].title).toBe("React Component");
		});

		it("should filter by project name", () => {
			const result = filterThreadsByQuery(mockThreads, "typescript");
			expect(result).toHaveLength(1);
			expect(result[0].projectName).toBe("typescript-project");
		});

		it("should filter by project path", () => {
			const result = filterThreadsByQuery(mockThreads, "db-project");
			expect(result).toHaveLength(1);
			expect(result[0].projectPath).toBe("/path/to/db-project");
		});

		it("should return multiple results when query matches multiple threads", () => {
			const result = filterThreadsByQuery(mockThreads, "project");
			expect(result.length).toBeGreaterThan(1);
		});

		it("should return empty array when no matches found", () => {
			const result = filterThreadsByQuery(mockThreads, "nonexistent");
			expect(result).toEqual([]);
		});

		it("should handle partial matches", () => {
			const result = filterThreadsByQuery(mockThreads, "comp");
			expect(result).toHaveLength(1);
			expect(result[0].title).toBe("React Component");
		});

		it("should handle empty array input", () => {
			const result = filterThreadsByQuery([], "query");
			expect(result).toEqual([]);
		});
	});

	describe("groupThreadsByTime", () => {
		it("should group threads by time category", () => {
			// Thread Identity: id IS the session ID (canonical)
			const threads: SessionDisplayItem[] = [
				{
					id: "session-1",
					title: "Today",
					agentId: "claude-code",
					projectPath: "/path/1",
					projectName: "project1",
					createdAt: new Date(), // Today
				},
				{
					id: "session-2",
					title: "Yesterday",
					agentId: "claude-code",
					projectPath: "/path/2",
					projectName: "project2",
					createdAt: new Date(Date.now() - 86_400_000), // Yesterday
				},
				{
					id: "session-3",
					title: "This Week",
					agentId: "claude-code",
					projectPath: "/path/3",
					projectName: "project3",
					createdAt: new Date(Date.now() - 3 * 86_400_000), // 3 days ago
				},
				{
					id: "session-4",
					title: "This Month",
					agentId: "claude-code",
					projectPath: "/path/4",
					projectName: "project4",
					createdAt: new Date(Date.now() - 15 * 86_400_000), // 15 days ago
				},
				{
					id: "session-5",
					title: "Older",
					agentId: "claude-code",
					projectPath: "/path/5",
					projectName: "project5",
					createdAt: new Date(Date.now() - 35 * 86_400_000), // 35 days ago
				},
			];

			const result = groupThreadsByTime(threads);

			expect(result[TIME_GROUPS.TODAY]).toHaveLength(1);
			expect(result[TIME_GROUPS.YESTERDAY]).toHaveLength(1);
			expect(result[TIME_GROUPS.THIS_WEEK]).toHaveLength(1);
			expect(result[TIME_GROUPS.THIS_MONTH]).toHaveLength(1);
			expect(result[TIME_GROUPS.OLDER]).toHaveLength(1);
		});

		it("should handle empty array", () => {
			const result = groupThreadsByTime([]);
			expect(result).toEqual({});
		});

		it("should handle threads with invalid dates", () => {
			const threads: SessionDisplayItem[] = [
				{
					id: "session-1",
					title: "Invalid",
					agentId: "claude-code",
					projectPath: "/path/1",
					projectName: "project1",
					createdAt: new Date(Number.NaN),
				},
			];

			const result = groupThreadsByTime(threads);

			expect(result[TIME_GROUPS.OLDER]).toHaveLength(1);
		});

		it("should handle multiple threads in same group", () => {
			const threads: SessionDisplayItem[] = [
				{
					id: "session-1",
					title: "Today 1",
					agentId: "claude-code",
					projectPath: "/path/1",
					projectName: "project1",
					createdAt: new Date(),
				},
				{
					id: "session-2",
					title: "Today 2",
					agentId: "claude-code",
					projectPath: "/path/2",
					projectName: "project2",
					createdAt: new Date(),
				},
			];

			const result = groupThreadsByTime(threads);

			expect(result[TIME_GROUPS.TODAY]).toHaveLength(2);
		});
	});
});
