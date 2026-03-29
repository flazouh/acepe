import { describe, expect, it } from "bun:test";

import type { SessionEntry } from "../../../application/dto/session.js";
import type { ToolCall } from "../../../types/tool-call.js";
import {
	buildSessionRows,
	createDisplayItems,
	createSessionGroups,
	extractActivityInfo,
	extractCurrentToolInfo,
	extractLastToolInfo,
	extractTodoProgress,
} from "../session-list-logic.js";
import type { SessionListItem } from "../session-list-types.js";

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
			new Set<string>(),
			() => []
		);

		expect(items).toHaveLength(1);
		expect(items[0]?.prNumber).toBe(314);
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
					createToolCallEntry("Edit", "edit", {
						edits: [{ filePath: "/repo/src/file.ts", oldString: "const a = 1;", newString: "const a = 2;\nconst b = 3;" }],
					}),
				],
			},
		];

		// No checkpoints → diff stats are 0 (entries are NOT read for perf)
		const items = createDisplayItems(
			sessions,
			new Map([["/repo", "repo"]]),
			new Map(),
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
					createToolCallEntry("Edit", "edit", {
						edits: [{ filePath: "/repo/src/file.ts", oldString: "const a = 1;", newString: "const a = 2;" }],
					}),
				],
			},
		];

		const items = createDisplayItems(
			sessions,
			new Map([["/repo", "repo"]]),
			new Map(),
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
	const mockItems: SessionListItem[] = [
		{
			id: "session-1",
			title: "Session 1",
			projectPath: "/path/1",
			projectName: "project1",
			projectColor: undefined,
			agentId: "claude-code",
			createdAt: new Date(),
			updatedAt: new Date(),
			isOpen: false,
			activity: null,
			parentId: null,
		},
		{
			id: "session-2",
			title: "Session 2",
			projectPath: "/path/1",
			projectName: "project1",
			projectColor: undefined,
			agentId: "cursor",
			createdAt: new Date(),
			updatedAt: new Date(),
			isOpen: false,
			activity: null,
			parentId: null,
		},
		{
			id: "session-3",
			title: "Session 3",
			projectPath: "/path/1",
			projectName: "project1",
			projectColor: undefined,
			agentId: "claude-code",
			createdAt: new Date(),
			updatedAt: new Date(),
			isOpen: false,
			activity: null,
			parentId: null,
		},
	];

	it("should group sessions by project", () => {
		const groups = createSessionGroups(mockItems);

		expect(groups).toHaveLength(1);
		const group = groups[0];
		expect(group.sessions).toHaveLength(3);
		expect(group.projectPath).toBe("/path/1");
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
				agentId: "claude-code",
				createdAt: new Date("2024-01-02T00:00:00.000Z"),
				updatedAt: new Date("2024-01-02T00:00:00.000Z"),
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
				agentId: "claude-code",
				createdAt: new Date("2024-01-01T00:00:00.000Z"),
				updatedAt: new Date("2024-01-01T00:00:00.000Z"),
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

// Helper to create mock tool call entries
function createToolCallEntry(
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

function createUserEntry(content: string): SessionEntry {
	return {
		type: "user",
		id: `entry-${Math.random()}`,
		message: {
			content: { type: "text", text: content },
			chunks: [{ type: "text", text: content }],
		},
	};
}

function createAssistantEntry(content: string): SessionEntry {
	return {
		type: "assistant",
		id: `entry-${Math.random()}`,
		message: {
			chunks: [{ type: "message", block: { type: "text", text: content } }],
		},
	};
}

describe("extractCurrentToolInfo", () => {
	it("should return null for empty entries", () => {
		const result = extractCurrentToolInfo([]);
		expect(result).toBeNull();
	});

	it("should return null when no streaming tool calls exist", () => {
		const entries: SessionEntry[] = [
			{ ...createToolCallEntry("Read", "read", { file_path: "/file.ts" }), isStreaming: false },
		];
		const result = extractCurrentToolInfo(entries);
		expect(result).toBeNull();
	});

	it("should find the most recent streaming tool call", () => {
		const entries: SessionEntry[] = [
			{ ...createToolCallEntry("Read", "read", { file_path: "/first.ts" }), isStreaming: false },
			createUserEntry("Working..."),
			{
				...createToolCallEntry("Edit", "edit", { edits: [{ filePath: "/second.ts" }] }),
				isStreaming: true,
			},
		];
		const result = extractCurrentToolInfo(entries);
		expect(result).toEqual({ name: "Edit", target: "second.ts", kind: "edit" });
	});

	it("should skip non-streaming tools even if they are more recent", () => {
		const entries: SessionEntry[] = [
			{
				...createToolCallEntry("Read", "read", { file_path: "/file.ts" }),
				isStreaming: true,
			},
			createUserEntry("Done"),
			{
				...createToolCallEntry("Edit", "edit", { edits: [{ filePath: "/file2.ts" }] }),
				isStreaming: false,
			},
		];
		const result = extractCurrentToolInfo(entries);
		expect(result).toEqual({ name: "Read", target: "file.ts", kind: "read" });
	});
});

describe("extractLastToolInfo", () => {
	it("should return null for empty entries", () => {
		const result = extractLastToolInfo([]);
		expect(result).toBeNull();
	});

	it("should return null when no tool calls exist", () => {
		const entries: SessionEntry[] = [createUserEntry("Hello"), createAssistantEntry("Hi there")];
		const result = extractLastToolInfo(entries);
		expect(result).toBeNull();
	});

	it("should extract Read tool with file basename", () => {
		const entries: SessionEntry[] = [
			createToolCallEntry("Read", "read", { file_path: "/path/to/file.ts" }),
		];
		const result = extractLastToolInfo(entries);
		expect(result).toEqual({ name: "Read", target: "file.ts", kind: "read" });
	});

	it("should extract Edit tool with file basename", () => {
		const entries: SessionEntry[] = [
			createToolCallEntry("Edit", "edit", { edits: [{ filePath: "/src/components/Button.svelte" }] }),
		];
		const result = extractLastToolInfo(entries);
		expect(result).toEqual({ name: "Edit", target: "Button.svelte", kind: "edit" });
	});

	it("should extract Bash/execute tool with command from registry", () => {
		const entries: SessionEntry[] = [
			createToolCallEntry("Bash", "execute", { command: "npm run build && npm test" }),
		];
		const result = extractLastToolInfo(entries);
		// Registry uses truncateText(50) - full command fits
		expect(result).toEqual({ name: "Bash", target: "npm run build && npm test", kind: "execute" });
	});

	it("should extract Search tool with query", () => {
		const entries: SessionEntry[] = [createToolCallEntry("Grep", "search", { query: "TODO" })];
		const result = extractLastToolInfo(entries);
		expect(result).toEqual({ name: "Grep", target: "TODO", kind: "search" });
	});

	it("should find the most recent tool call (last in array)", () => {
		const entries: SessionEntry[] = [
			createToolCallEntry("Read", "read", { file_path: "/first.ts" }),
			createUserEntry("Thanks"),
			createToolCallEntry("Edit", "edit", { edits: [{ filePath: "/second.ts" }] }),
		];
		const result = extractLastToolInfo(entries);
		expect(result).toEqual({ name: "Edit", target: "second.ts", kind: "edit" });
	});

	it("should fall back to title when think tool has no description", () => {
		const entries: SessionEntry[] = [
			createToolCallEntry("TodoWrite", "think", { raw: { todos: [] } }),
		];
		const result = extractLastToolInfo(entries);
		// Registry falls back to title (e.g. "Thinking") when subtitle is empty
		expect(result?.name).toBe("TodoWrite");
		expect(result?.kind).toBe("think");
		expect(result?.target).toBe(""); // No description or title available
	});

	it("should show task description for think tools (matches queue item display)", () => {
		const entries: SessionEntry[] = [
			createToolCallEntry("Task", "think", {
				description: "Explore Acepe codebase structure",
				subagent_type: "Explore",
			}),
		];
		const result = extractLastToolInfo(entries);
		expect(result).toEqual({
			name: "Task",
			target: "Explore Acepe codebase structure",
			kind: "think",
		});
	});

	it("should truncate long task description to 50 chars (matches registry)", () => {
		const longDescription = "Explore the entire codebase and understand the architecture".padEnd(
			60,
			"x"
		);
		const entries: SessionEntry[] = [
			createToolCallEntry("Task", "think", { description: longDescription }),
		];
		const result = extractLastToolInfo(entries);
		expect(result?.target).toHaveLength(50);
		expect(result?.target.endsWith("...")).toBe(true);
	});
});

describe("extractTodoProgress", () => {
	function createTodoWriteEntry(
		todos: Array<{ content: string; activeForm?: string; status: string }>
	): SessionEntry {
		const message: ToolCall = {
			id: `tool-${Math.random()}`,
			name: "TodoWrite",
			kind: "think",
			arguments: { kind: "think" } as unknown as ToolCall["arguments"],
			status: "completed",
			awaitingPlanApproval: false,
			// Use normalizedTodos (parsed by backend)
			normalizedTodos: todos.map((t) => ({
				content: t.content,
				activeForm: t.activeForm !== undefined ? t.activeForm : t.content,
				status: t.status as "pending" | "in_progress" | "completed",
			})),
		};
		return {
			type: "tool_call",
			id: `entry-${Math.random()}`,
			message,
		};
	}

	it("should return null for empty entries", () => {
		const result = extractTodoProgress([]);
		expect(result).toBeNull();
	});

	it("should return null when no TodoWrite exists", () => {
		const entries: SessionEntry[] = [
			createToolCallEntry("Read", "read", { file_path: "/file.ts" }),
		];
		const result = extractTodoProgress(entries);
		expect(result).toBeNull();
	});

	it("should extract in-progress task", () => {
		const entries: SessionEntry[] = [
			createTodoWriteEntry([
				{ content: "Task 1", activeForm: "Doing task 1", status: "completed" },
				{ content: "Task 2", activeForm: "Doing task 2", status: "in_progress" },
				{ content: "Task 3", activeForm: "Doing task 3", status: "pending" },
			]),
		];
		const result = extractTodoProgress(entries);
		expect(result).toEqual({
			current: 2,
			total: 3,
			label: "Doing task 2",
		});
	});

	it("should use content when activeForm is missing", () => {
		const entries: SessionEntry[] = [
			createTodoWriteEntry([
				{ content: "First task", status: "completed" },
				{ content: "Second task", status: "in_progress" },
			]),
		];
		const result = extractTodoProgress(entries);
		expect(result).toEqual({
			current: 2,
			total: 2,
			label: "Second task",
		});
	});

	it("should show completed count when all done", () => {
		const entries: SessionEntry[] = [
			createTodoWriteEntry([
				{ content: "Task 1", status: "completed" },
				{ content: "Task 2", status: "completed" },
			]),
		];
		const result = extractTodoProgress(entries);
		expect(result).toEqual({
			current: 2,
			total: 2,
			label: "Done",
		});
	});

	it("should show Waiting when no task in progress", () => {
		const entries: SessionEntry[] = [
			createTodoWriteEntry([
				{ content: "Task 1", status: "completed" },
				{ content: "Task 2", status: "pending" },
			]),
		];
		const result = extractTodoProgress(entries);
		expect(result).toEqual({
			current: 1,
			total: 2,
			label: "Waiting",
		});
	});

	it("should use the most recent TodoWrite", () => {
		const entries: SessionEntry[] = [
			createTodoWriteEntry([{ content: "Old task", activeForm: "Old", status: "in_progress" }]),
			createToolCallEntry("Read", "read", { file_path: "/file.ts" }),
			createTodoWriteEntry([
				{ content: "New task 1", activeForm: "New 1", status: "completed" },
				{ content: "New task 2", activeForm: "New 2", status: "in_progress" },
			]),
		];
		const result = extractTodoProgress(entries);
		expect(result).toEqual({
			current: 2,
			total: 2,
			label: "New 2",
		});
	});

	it("should truncate long labels", () => {
		const entries: SessionEntry[] = [
			createTodoWriteEntry([
				{
					content: "This is a very long task description that should be truncated",
					activeForm: "Doing something very long that exceeds the limit",
					status: "in_progress",
				},
			]),
		];
		const result = extractTodoProgress(entries);
		expect(result?.label.length).toBeLessThanOrEqual(25);
		expect(result?.label).toContain("...");
	});
});

describe("extractActivityInfo", () => {
	it("should return null for non-streaming session", () => {
		const session = {
			id: "s1",
			projectPath: "/path",
			agentId: "claude",
			title: null,
			status: "ready" as const,
			entryCount: 0,
			isConnected: true,
			isStreaming: false,
			createdAt: new Date(),
			updatedAt: new Date(),
			parentId: null,
		};
		const result = extractActivityInfo(session, []);
		expect(result).toBeNull();
	});

	it("should return activity info for streaming session", () => {
		const session = {
			id: "s1",
			projectPath: "/path",
			agentId: "claude",
			title: null,
			status: "streaming" as const,
			entryCount: 1,
			isConnected: true,
			isStreaming: true,
			createdAt: new Date(),
			updatedAt: new Date(),
			parentId: null,
		};
		const entries: SessionEntry[] = [
			createToolCallEntry("Read", "read", { file_path: "/test.ts" }),
		];
		const result = extractActivityInfo(session, entries);
		expect(result).toEqual({
			isStreaming: true,
			todoProgress: null,
			currentTool: null,
			lastTool: { name: "Read", target: "test.ts", kind: "read" },
		});
	});

	it("should include both todo progress and last tool", () => {
		const session = {
			id: "s1",
			projectPath: "/path",
			agentId: "claude",
			title: null,
			status: "streaming" as const,
			entryCount: 2,
			isConnected: true,
			isStreaming: true,
			createdAt: new Date(),
			updatedAt: new Date(),
			parentId: null,
		};
		const todoMessage: ToolCall = {
			id: "t1",
			name: "TodoWrite",
			kind: "think",
			arguments: { kind: "think" } as unknown as ToolCall["arguments"],
			status: "completed",
			awaitingPlanApproval: false,
			normalizedTodos: [{ content: "Task 1", activeForm: "Working on 1", status: "in_progress" }],
		};
		const entries: SessionEntry[] = [
			{
				type: "tool_call",
				id: "e1",
				message: todoMessage,
			},
			createToolCallEntry("Read", "read", { file_path: "/file.ts" }),
		];
		const result = extractActivityInfo(session, entries);
		expect(result).toEqual({
			isStreaming: true,
			todoProgress: { current: 1, total: 1, label: "Working on 1" },
			currentTool: null,
			lastTool: { name: "Read", target: "file.ts", kind: "read" },
		});
	});

	it("should return lastTool when tool completed but no current tool", () => {
		const session = {
			id: "s1",
			projectPath: "/path",
			agentId: "claude",
			title: null,
			status: "streaming" as const,
			entryCount: 3,
			isConnected: true,
			isStreaming: true,
			createdAt: new Date(),
			updatedAt: new Date(),
			parentId: null,
		};
		const entries: SessionEntry[] = [
			// Tool that completed (no longer streaming)
			{ ...createToolCallEntry("Read", "read", { file_path: "/file.ts" }), isStreaming: false },
			createUserEntry("Thanks"),
			// Agent thinking/planning (assistant message, no tool)
			createAssistantEntry("Now I'll check something else"),
		];
		const result = extractActivityInfo(session, entries);
		// Should show lastTool but NO currentTool - UI will fall back to showing lastTool
		expect(result).toEqual({
			isStreaming: true,
			todoProgress: null,
			currentTool: null,
			lastTool: { name: "Read", target: "file.ts", kind: "read" },
		});
	});
});
