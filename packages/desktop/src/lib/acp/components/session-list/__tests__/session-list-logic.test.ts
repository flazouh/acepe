import { describe, expect, it } from "bun:test";

import type { SessionEntry } from "../../../application/dto/session-entry.js";
import type { Project } from "../../../logic/project-manager.svelte.js";
import type { ToolCall } from "../../../types/tool-call.js";
import {
	buildSessionRows,
	createDisplayItems,
	createLoadingSessionGroups,
	createSessionGroups,
	getNextSessionListVisibleCount,
	getSessionListVisibleCount,
	getSidebarSessions,
	isSessionListNearBottom,
} from "../session-list-logic.js";
import { extractProjectName } from "../../../utils/path-utils.js";
import { generateFallbackProjectColor } from "../../../utils/project-utils.js";
import type { SessionListItem } from "../session-list-types.js";

function isSessionListBadgeIdentityReady(
	item: Pick<SessionListItem, "sequenceId" | "projectName" | "projectColor">
): boolean {
	return item.sequenceId != null && item.projectName != null && item.projectColor != null;
}

describe("createDisplayItems", () => {
	it("maps prNumber from session summary to list item", () => {
		const now = new Date("2024-01-01T00:00:00.000Z");
		const sessions = [
			{
				id: "session-pr",
				title: "Session with PR",
				projectPath: "/repo",
				agentId: "claude-code",
				status: "ready" as const,
				entryCount: 0,
				isConnected: true,
				isStreaming: false,
				createdAt: now,
				updatedAt: now,
				parentId: null,
				prNumber: 314,
			},
		];

		const items = createDisplayItems(
			sessions,
			new Map([["/repo", "repo"]]),
			new Map(),
			new Map([["/repo", null]]),
			new Set<string>(),
			() => []
		);

		expect(items).toHaveLength(1);
		expect(items[0]?.isLive).toBe(false);
		expect(items[0]?.prNumber).toBe(314);
	});

	it("preserves unknown entry count instead of coercing it to zero", () => {
		const now = new Date("2024-01-01T00:00:00.000Z");
		const sessions = [
			{
				id: "session-unknown-count",
				title: "Session with unknown count",
				projectPath: "/repo",
				agentId: "claude-code",
				status: "error" as const,
				entryCount: null,
				isConnected: false,
				isStreaming: false,
				createdAt: now,
				updatedAt: now,
				parentId: null,
			},
		];

		const items = createDisplayItems(
			sessions,
			new Map([["/repo", "repo"]]),
			new Map(),
			new Map([["/repo", null]]),
			new Set<string>(),
			() => []
		);

		expect(items).toHaveLength(1);
		expect(items[0]?.entryCount).toBeNull();
	});

	it("falls back to path-derived project identity when color map lacks the project so pending badge can render", () => {
		const now = new Date("2024-01-01T00:00:00.000Z");
		const projectPath = "/Users/dev/acepe";
		const sessions = [
			{
				id: "pending-first-send",
				title: "New Thread",
				projectPath,
				agentId: "claude-code",
				status: "ready" as const,
				entryCount: 0,
				isConnected: false,
				isStreaming: false,
				createdAt: now,
				updatedAt: now,
				parentId: null,
				sequenceId: 7,
			},
		];

		const items = createDisplayItems(
			sessions,
			new Map(),
			new Map(),
			new Map(),
			new Set<string>(),
			() => []
		);

		expect(items).toHaveLength(1);
		expect(items[0]?.projectName).toBe(extractProjectName(projectPath));
		expect(items[0]?.projectColor).toBe(generateFallbackProjectColor(projectPath));
		expect(isSessionListBadgeIdentityReady(items[0]!)).toBe(true);
	});

	it("marks streaming and open sessions as live", () => {
		const now = new Date("2024-01-01T00:00:00.000Z");
		const sessions = [
			{
				id: "streaming-session",
				title: "Streaming",
				projectPath: "/repo",
				agentId: "claude-code",
				status: "ready" as const,
				entryCount: 0,
				isConnected: true,
				isStreaming: true,
				createdAt: now,
				updatedAt: now,
				parentId: null,
			},
			{
				id: "open-session",
				title: "Open",
				projectPath: "/repo",
				agentId: "claude-code",
				status: "ready" as const,
				entryCount: 0,
				isConnected: true,
				isStreaming: false,
				createdAt: now,
				updatedAt: now,
				parentId: null,
			},
		];

		const items = createDisplayItems(
			sessions,
			new Map([["/repo", "repo"]]),
			new Map(),
			new Map([["/repo", null]]),
			new Set(["open-session"]),
			() => []
		);

		expect(items.map((item) => item.isLive)).toEqual([true, true]);
	});

	it("uses checkpoint diff stats (not entries) for performance", () => {
		const now = new Date("2024-01-01T00:00:00.000Z");
		const sessions = [
			{
				id: "session-1",
				title: "Session 1",
				projectPath: "/repo",
				agentId: "claude-code",
				status: "ready" as const,
				entryCount: 1,
				isConnected: true,
				isStreaming: false,
				createdAt: now,
				updatedAt: now,
				parentId: null,
				entries: [
					createMockToolEntry("Edit", "edit", {
						edits: [
							{
								filePath: "/repo/src/file.ts",
								oldString: "const a = 1;",
								newString: "const a = 2;\nconst b = 3;",
							},
						],
					}),
				],
			},
		];

		// No checkpoints → diff stats are 0 (entries are NOT read for perf)
		const items = createDisplayItems(
			sessions,
			new Map([["/repo", "repo"]]),
			new Map(),
			new Map([["/repo", null]]),
			new Set<string>(),
			() => []
		);

		expect(items).toHaveLength(1);
		expect(items[0].insertions).toBe(0);
		expect(items[0].deletions).toBe(0);
	});

	it("uses checkpoint diff totals when available", () => {
		const now = new Date("2024-01-01T00:00:00.000Z");
		const sessions = [
			{
				id: "session-1",
				title: "Session 1",
				projectPath: "/repo",
				agentId: "claude-code",
				status: "ready" as const,
				entryCount: 1,
				isConnected: true,
				isStreaming: false,
				createdAt: now,
				updatedAt: now,
				parentId: null,
				entries: [
					createMockToolEntry("Edit", "edit", {
						edits: [
							{
								filePath: "/repo/src/file.ts",
								oldString: "const a = 1;",
								newString: "const a = 2;",
							},
						],
					}),
				],
			},
		];

		const items = createDisplayItems(
			sessions,
			new Map([["/repo", "repo"]]),
			new Map(),
			new Map([["/repo", null]]),
			new Set<string>(),
			() => [
				{
					id: "cp-1",
					sessionId: "session-1",
					checkpointNumber: 1,
					name: null,
					createdAt: Date.now(),
					toolCallId: null,
					isAuto: true,
					fileCount: 1,
					totalLinesAdded: 12,
					totalLinesRemoved: 4,
				},
			]
		);

		expect(items).toHaveLength(1);
		expect(items[0].insertions).toBe(12);
		expect(items[0].deletions).toBe(4);
	});
});

describe("createSessionGroups", () => {
	function createSessionListItem(
		id: string,
		projectPath: string,
		projectName: string
	): SessionListItem {
		const createdAt = new Date("2024-01-01T00:00:00.000Z");
		return {
			id,
			title: id,
			projectPath,
			projectName,
			projectColor: undefined,
			projectIconSrc: null,
			agentId: "claude-code",
			createdAt,
			updatedAt: createdAt,
			isLive: false,
			isOpen: false,
			activity: null,
			parentId: null,
		};
	}

	function createProject(
		path: string,
		name: string,
		createdAt: string,
		sortOrder?: number
	): Project {
		return {
			path,
			name,
			createdAt: new Date(createdAt),
			color: "#000000",
			sortOrder,
			iconPath: null,
		};
	}

	it("should group sessions by project", () => {
		const mockItems: SessionListItem[] = [
			createSessionListItem("session-1", "/path/1", "project1"),
			createSessionListItem("session-2", "/path/1", "project1"),
			createSessionListItem("session-3", "/path/1", "project1"),
		];
		const groups = createSessionGroups(mockItems);

		expect(groups).toHaveLength(1);
		const group = groups[0];
		expect(group.sessions).toHaveLength(3);
		expect(group.projectPath).toBe("/path/1");
	});

	it("sorts groups by persisted sortOrder ascending", () => {
		const items: SessionListItem[] = [
			createSessionListItem("session-a", "/project/a", "project-a"),
			createSessionListItem("session-b", "/project/b", "project-b"),
			createSessionListItem("session-c", "/project/c", "project-c"),
		];

		const projectCreatedAtMap = new Map<string, Date>([
			["/project/a", new Date("2024-01-01T00:00:00.000Z")],
			["/project/b", new Date("2024-03-01T00:00:00.000Z")],
			["/project/c", new Date("2024-02-01T00:00:00.000Z")],
		]);
		const projectSortOrderMap = new Map<string, number>([
			["/project/a", 2],
			["/project/b", 0],
			["/project/c", 1],
		]);

		const groups = createSessionGroups(items, projectCreatedAtMap, projectSortOrderMap);

		expect(groups.map((group) => group.projectPath)).toEqual([
			"/project/b",
			"/project/c",
			"/project/a",
		]);
	});

	it("sorts loading groups by persisted sortOrder instead of createdAt", () => {
		const projects: Project[] = [
			createProject("/project/a", "project-a", "2024-01-01T00:00:00.000Z", 2),
			createProject("/project/b", "project-b", "2024-03-01T00:00:00.000Z", 0),
			createProject("/project/c", "project-c", "2024-02-01T00:00:00.000Z", 1),
		];

		const groups = createLoadingSessionGroups(projects);

		expect(groups.map((group) => group.projectPath)).toEqual([
			"/project/b",
			"/project/c",
			"/project/a",
		]);
	});

	it("treats missing sortOrder as Infinity and falls back to createdAt desc", () => {
		const items: SessionListItem[] = [
			createSessionListItem("session-a", "/project/a", "project-a"),
			createSessionListItem("session-b", "/project/b", "project-b"),
			createSessionListItem("session-c", "/project/c", "project-c"),
		];

		const projectCreatedAtMap = new Map<string, Date>([
			["/project/a", new Date("2024-01-01T00:00:00.000Z")],
			["/project/b", new Date("2024-03-01T00:00:00.000Z")],
			["/project/c", new Date("2024-02-01T00:00:00.000Z")],
		]);
		const projectSortOrderMap = new Map<string, number>([["/project/a", 0]]);

		const groups = createSessionGroups(items, projectCreatedAtMap, projectSortOrderMap);

		expect(groups.map((group) => group.projectPath)).toEqual([
			"/project/a",
			"/project/b",
			"/project/c",
		]);
	});

	it("falls back to createdAt desc when sortOrder values match", () => {
		const items: SessionListItem[] = [
			createSessionListItem("session-a", "/project/a", "project-a"),
			createSessionListItem("session-b", "/project/b", "project-b"),
			createSessionListItem("session-c", "/project/c", "project-c"),
		];

		const projectCreatedAtMap = new Map<string, Date>([
			["/project/a", new Date("2024-01-01T00:00:00.000Z")],
			["/project/b", new Date("2024-03-01T00:00:00.000Z")],
			["/project/c", new Date("2024-02-01T00:00:00.000Z")],
		]);
		const projectSortOrderMap = new Map<string, number>([
			["/project/a", 0],
			["/project/b", 0],
			["/project/c", 0],
		]);

		const groups = createSessionGroups(items, projectCreatedAtMap, projectSortOrderMap);

		expect(groups.map((group) => group.projectPath)).toEqual([
			"/project/b",
			"/project/c",
			"/project/a",
		]);
	});
});

describe("buildSessionRows", () => {
	it("promotes orphaned children to roots", () => {
		const items: SessionListItem[] = [
			{
				id: "child-1",
				title: "Child 1",
				projectPath: "/path/1",
				projectName: "project1",
				projectColor: undefined,
				projectIconSrc: null,
				agentId: "claude-code",
				createdAt: new Date("2024-01-02T00:00:00.000Z"),
				updatedAt: new Date("2024-01-02T00:00:00.000Z"),
				isLive: false,
				isOpen: false,
				activity: null,
				parentId: "missing-parent",
			},
			{
				id: "root-1",
				title: "Root 1",
				projectPath: "/path/1",
				projectName: "project1",
				projectColor: undefined,
				projectIconSrc: null,
				agentId: "claude-code",
				createdAt: new Date("2024-01-01T00:00:00.000Z"),
				updatedAt: new Date("2024-01-01T00:00:00.000Z"),
				isLive: false,
				isOpen: false,
				activity: null,
				parentId: null,
			},
		];

		const rows = buildSessionRows(items, new Set());

		expect(rows).toHaveLength(2);
		expect(rows[0].item.id).toBe("child-1");
		expect(rows[0].depth).toBe(0);
		expect(rows[1].item.id).toBe("root-1");
		expect(rows[1].depth).toBe(0);
	});
});

describe("getSidebarSessions", () => {
	it("keeps historical sessions visible in the sidebar", () => {
		const items: SessionListItem[] = [
			{
				id: "live-session",
				title: "Live",
				projectPath: "/path/1",
				projectName: "project1",
				projectColor: undefined,
				projectIconSrc: null,
				agentId: "claude-code",
				createdAt: new Date(),
				updatedAt: new Date(),
				isLive: true,
				isOpen: false,
				activity: null,
				parentId: null,
			},
			{
				id: "historical-session",
				title: "Historical",
				projectPath: "/path/1",
				projectName: "project1",
				projectColor: undefined,
				projectIconSrc: null,
				agentId: "claude-code",
				createdAt: new Date(),
				updatedAt: new Date(),
				isLive: false,
				isOpen: false,
				activity: null,
				parentId: null,
			},
		];

		expect(getSidebarSessions(items).map((item) => item.id)).toEqual([
			"live-session",
			"historical-session",
		]);
	});
});

// Helper to create mock tool call entries
function createMockToolEntry(
	toolName: string,
	kind: string,
	args: Record<string, unknown>
): SessionEntry {
	const message: ToolCall = {
		id: `tool-${Math.random()}`,
		name: toolName,
		kind: kind as ToolCall["kind"],
		arguments: { kind, ...args } as unknown as ToolCall["arguments"],
		status: "completed",
		awaitingPlanApproval: false,
	};
	return {
		type: "tool_call",
		id: `entry-${Math.random()}`,
		message,
	};
}

describe("session list pagination helpers", () => {
	it("shows the first 10 sessions by default", () => {
		expect(getSessionListVisibleCount(25, undefined)).toBe(10);
		expect(getSessionListVisibleCount(6, undefined)).toBe(6);
	});

	it("reveals 10 more sessions at a time", () => {
		expect(getNextSessionListVisibleCount(25, undefined)).toBe(20);
		expect(getNextSessionListVisibleCount(25, 10)).toBe(20);
		expect(getNextSessionListVisibleCount(25, 20)).toBe(25);
	});

	it("detects when a session list is at the bottom", () => {
		expect(isSessionListNearBottom(180, 120, 320)).toBe(true);
		expect(isSessionListNearBottom(150, 120, 320)).toBe(false);
	});
});
