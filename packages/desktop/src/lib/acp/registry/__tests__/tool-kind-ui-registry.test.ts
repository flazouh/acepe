import { describe, expect, it } from "bun:test";
import type { ToolCallData } from "$lib/services/converted-session-types.js";

import {
	getToolCompactDisplayText,
	getToolKindSubtitle,
	getToolKindTitle,
	getToolKindUI,
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

	it("truncates browser execute-js scripts for the subtitle preview", () => {
		const toolCall: ToolCallData = {
			id: "test-browser-1",
			name: "mcp__tauri__webview_execute_js",
			arguments: {
				kind: "browser",
				raw: {
					script:
						"(() => {\n  const elements = Array.from(document.querySelectorAll('[data-ref]'));\n  return elements.map((element) => element.textContent?.trim() ?? '');\n})()",
				},
			},
			status: "completed",
			kind: "browser",
			awaitingPlanApproval: false,
		};

		const subtitle = getToolKindSubtitle("browser", toolCall);
		expect(subtitle).toContain("(() => {");
		expect(subtitle.length).toBeLessThanOrEqual(43);
		expect(subtitle).toContain("...");
	});

	it("shows SQL descriptions as the subtitle", () => {
		const toolCall: ToolCallData = {
			id: "test-sql-1",
			name: "sql",
			arguments: {
				kind: "sql",
				description: "Mark all done",
				query: "UPDATE todos SET status='done'",
			},
			status: "completed",
			kind: "sql",
			awaitingPlanApproval: false,
			title: "Mark all done",
		};

		const subtitle = getToolKindSubtitle("sql", toolCall);
		expect(subtitle).toBe("Mark all done");
	});

	it("formats unclassified raw names instead of showing Unknown", () => {
		const toolCall: ToolCallData = {
			id: "test-unclassified-1",
			name: "",
			arguments: {
				kind: "unclassified",
				raw_name: "mcp__server__CommandPalette",
				raw_kind_hint: "other",
				signals_tried: ["provider-name", "kind-hint"],
			},
			status: "pending",
			kind: "unclassified",
			awaitingPlanApproval: false,
		};

		const title = getToolKindTitle("unclassified", toolCall, "streaming");
		expect(title).toBe("Command Palette");
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

// CHARACTERIZATION: remove when projected union is authoritative — pins registry routing and labels
// while some surfaces still collapse kinds (e.g. agent panel via `toAgentToolKind`).
describe("CHARACTERIZATION: sql / unclassified vs other registry routing (remove when projected union is authoritative)", () => {
	it("uses sql titles when kind is sql, not generic other formatting", () => {
		const sqlCall: ToolCallData = {
			id: "char-sql-1",
			name: "unknown",
			arguments: { kind: "sql", query: "SELECT 1" },
			status: "pending",
			kind: "sql",
			awaitingPlanApproval: false,
		};
		const otherCall: ToolCallData = {
			id: "char-other-1",
			name: "unknown",
			arguments: { kind: "other", raw: {} },
			status: "pending",
			kind: "other",
			awaitingPlanApproval: false,
		};

		expect(getToolKindTitle("sql", sqlCall, "streaming")).toBe("Running SQL");
		expect(getToolKindTitle("other", otherCall, "streaming")).toBe("Unknown");
	});

	it("routes unclassified through unclassified UI even when arguments discriminant mismatches", () => {
		const toolCall: ToolCallData = {
			id: "char-un-1",
			name: "mcp__srv__MyTool",
			arguments: { kind: "other", raw: {} },
			status: "pending",
			kind: "unclassified",
			awaitingPlanApproval: false,
		};

		expect(getToolKindTitle("unclassified", toolCall, "streaming")).toBe("Unclassified Tool");
		expect(getToolKindSubtitle("unclassified", toolCall)).toBe("");
	});

	it("exposes distinct ToolKindUI entries for sql and other", () => {
		const sqlUi = getToolKindUI("sql");
		const otherUi = getToolKindUI("other");
		const stub: ToolCallData = {
			id: "stub",
			name: "x",
			arguments: { kind: "sql", query: "SELECT 1" },
			status: "completed",
			kind: "sql",
			awaitingPlanApproval: false,
		};

		expect(sqlUi.title(stub)).not.toEqual(otherUi.title({ ...stub, kind: "other", arguments: { kind: "other", raw: {} } }));
	});

	it("compact display prefers sql argument subtitles over the generic other title path", () => {
		const sqlCall: ToolCallData = {
			id: "char-sql-2",
			name: "run_query",
			arguments: {
				kind: "sql",
				description: "Backfill rows",
				query: "INSERT INTO t VALUES (1)",
			},
			status: "completed",
			kind: "sql",
			awaitingPlanApproval: false,
		};

		expect(getToolCompactDisplayText("sql", sqlCall, "completed")).toBe("Backfill rows");
	});
});
