import { describe, expect, it } from "bun:test";
import type { ToolCallData } from "$lib/services/converted-session-types.js";

import {
	getToolCompactDisplayText,
	getToolKindSubtitle,
	getToolKindTitle,
} from "../tool-kind-ui-registry.js";

describe("getToolKindTitle", () => {
	it("formats 'other' tool names with PascalCase splitting", () => {
		const toolCall: ToolCallData = {
			id: "test-1",
			name: "ToggleSidebar",
			arguments: { kind: "other", raw: {} },
			status: "pending",
			kind: "other",
			awaitingPlanApproval: false,
		};

		const title = getToolKindTitle("other", toolCall, "streaming");
		expect(title).toBe("Toggle Sidebar");
	});

	it("formats complex PascalCase tool names", () => {
		const toolCall: ToolCallData = {
			id: "test-2",
			name: "AddRepository",
			arguments: { kind: "other", raw: {} },
			status: "pending",
			kind: "other",
			awaitingPlanApproval: false,
		};

		const title = getToolKindTitle("other", toolCall, "streaming");
		expect(title).toBe("Add Repository");
	});

	it("formats MCP-style tool names with double underscore", () => {
		const toolCall: ToolCallData = {
			id: "test-3",
			name: "mcp__server__CommandPalette",
			arguments: { kind: "other", raw: {} },
			status: "pending",
			kind: "other",
			awaitingPlanApproval: false,
		};

		const title = getToolKindTitle("other", toolCall, "streaming");
		expect(title).toBe("Command Palette");
	});

	it("handles snake_case tool names by capitalizing", () => {
		const toolCall: ToolCallData = {
			id: "test-4",
			name: "sql_studio",
			arguments: { kind: "other", raw: {} },
			status: "pending",
			kind: "other",
			awaitingPlanApproval: false,
		};

		const title = getToolKindTitle("other", toolCall, "streaming");
		expect(title).toBe("Sql Studio");
	});

	it("handles already-formatted names gracefully", () => {
		const toolCall: ToolCallData = {
			id: "test-5",
			name: "Settings",
			arguments: { kind: "other", raw: {} },
			status: "pending",
			kind: "other",
			awaitingPlanApproval: false,
		};

		const title = getToolKindTitle("other", toolCall, "streaming");
		expect(title).toBe("Settings");
	});
});

describe("getToolKindSubtitle", () => {
	it("extracts query from search tool arguments", () => {
		const toolCall: ToolCallData = {
			id: "test-6",
			name: "Grep",
			arguments: { kind: "search", query: "getFilePanel|filePanels|FilePanel" },
			status: "pending",
			kind: "search",
			awaitingPlanApproval: false,
		};

		const subtitle = getToolKindSubtitle("search", toolCall);
		expect(subtitle).toBe("getFilePanel|filePanels|FilePanel");
	});

	it("truncates long queries in subtitle", () => {
		const toolCall: ToolCallData = {
			id: "test-7",
			name: "Grep",
			arguments: {
				kind: "search",
				query: "this is a very long query that should be truncated because it exceeds the limit",
			},
			status: "pending",
			kind: "search",
			awaitingPlanApproval: false,
		};

		const subtitle = getToolKindSubtitle("search", toolCall);
		expect(subtitle?.length).toBeLessThanOrEqual(43); // 40 + "..."
		expect(subtitle).toContain("...");
	});

	it("returns empty string for search without query", () => {
		const toolCall: ToolCallData = {
			id: "test-8",
			name: "Grep",
			arguments: { kind: "search" },
			status: "pending",
			kind: "search",
			awaitingPlanApproval: false,
		};

		const subtitle = getToolKindSubtitle("search", toolCall);
		expect(subtitle).toBe("");
	});

	it("returns formatted tool name as subtitle when title differs", () => {
		const toolCall: ToolCallData = {
			id: "test-9",
			name: "CustomTool",
			arguments: { kind: "other", raw: {} },
			status: "pending",
			kind: "other",
			awaitingPlanApproval: false,
			title: "Custom tool subtitle",
		};

		const subtitle = getToolKindSubtitle("other", toolCall);
		expect(subtitle).toBe("Custom Tool");
	});
});

describe("getToolCompactDisplayText", () => {
	it("returns task description for task kind (subtitle path)", () => {
		const toolCall: ToolCallData = {
			id: "test-10",
			name: "Task",
			arguments: {
				kind: "think",
				description: "Explore Acepe codebase structure",
				subagent_type: "Explore",
			},
			status: "pending",
			kind: "task",
			awaitingPlanApproval: false,
		};

		const text = getToolCompactDisplayText("task", toolCall, "streaming");
		expect(text).toBe("Explore Acepe codebase structure");
	});

	it("returns basename for read tool", () => {
		const toolCall: ToolCallData = {
			id: "test-11",
			name: "Read",
			arguments: { kind: "read", file_path: "/path/to/file.ts" },
			status: "pending",
			kind: "read",
			awaitingPlanApproval: false,
		};

		const text = getToolCompactDisplayText("read", toolCall);
		expect(text).toBe("file.ts");
	});

	it("falls back to title when subtitle is empty", () => {
		const toolCall: ToolCallData = {
			id: "test-12",
			name: "CustomTool",
			arguments: { kind: "other", raw: {} },
			status: "pending",
			kind: "other",
			awaitingPlanApproval: false,
		};

		const text = getToolCompactDisplayText("other", toolCall, "completed");
		expect(text).toBe("Custom Tool");
	});
});
