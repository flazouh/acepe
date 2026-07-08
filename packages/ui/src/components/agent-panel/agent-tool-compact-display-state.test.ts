import { describe, expect, it } from "bun:test";

import { mapAgentToolEntryToCompactDisplay } from "./agent-tool-compact-display-state.js";
import type { AgentToolEntry } from "./types.js";

describe("agent tool compact display state", () => {
	it("maps read tools to a running label with file badge metadata", () => {
		const entry: AgentToolEntry = {
			id: "tool-read",
			type: "tool_call",
			kind: "read",
			title: "Read",
			filePath: "/repo/src/main.ts",
			status: "running",
		};

		expect(mapAgentToolEntryToCompactDisplay(entry)).toEqual({
			id: "tool-read",
			kind: "read",
			title: "Reading",
			subtitle: undefined,
			filePath: "/repo/src/main.ts",
			status: "running",
		});
	});

	it("maps search tools to a running label with query subtitle", () => {
		const entry: AgentToolEntry = {
			id: "tool-search",
			type: "tool_call",
			kind: "search",
			title: "Search",
			query: "taskChildren",
			status: "running",
		};

		expect(mapAgentToolEntryToCompactDisplay(entry)).toEqual({
			id: "tool-search",
			kind: "search",
			title: "Grepping",
			subtitle: "taskChildren",
			filePath: undefined,
			status: "running",
		});
	});

	it("maps execute tools to a running label with a file chip when the command targets a file", () => {
		const entry: AgentToolEntry = {
			id: "tool-execute",
			type: "tool_call",
			kind: "execute",
			title: "Run",
			command: "bun test src/components/agent-panel/agent-tool-compact-display-state.test.ts",
			status: "running",
		};

		expect(mapAgentToolEntryToCompactDisplay(entry)).toEqual({
			id: "tool-execute",
			kind: "execute",
			title: "Executing…",
			subtitle: undefined,
			filePath: "src/components/agent-panel/agent-tool-compact-display-state.test.ts",
			status: "running",
		});
	});

	it("maps execute tools without file targets to a command subtitle", () => {
		const entry: AgentToolEntry = {
			id: "tool-execute",
			type: "tool_call",
			kind: "execute",
			title: "Run",
			command: "cargo check -p acepe-desktop",
			status: "running",
		};

		expect(mapAgentToolEntryToCompactDisplay(entry)).toEqual({
			id: "tool-execute",
			kind: "execute",
			title: "Executing…",
			subtitle: "cargo check -p acepe-desktop",
			filePath: undefined,
			status: "running",
		});
	});

	it("does not show raw execute provider names as command subtitles", () => {
		const entry: AgentToolEntry = {
			id: "tool-execute",
			type: "tool_call",
			kind: "execute",
			title: "Tool",
			command: "exec_command",
			status: "done",
		};

		expect(mapAgentToolEntryToCompactDisplay(entry)).toEqual({
			id: "tool-execute",
			kind: "execute",
			title: "Executed",
			subtitle: undefined,
			filePath: undefined,
			status: "done",
		});
	});

	it("does not show namespaced raw execute provider names as command subtitles", () => {
		const entry: AgentToolEntry = {
			id: "tool-execute",
			type: "tool_call",
			kind: "execute",
			title: "Tool",
			command: "functions.exec_command",
			status: "done",
		};

		expect(mapAgentToolEntryToCompactDisplay(entry)).toEqual({
			id: "tool-execute",
			kind: "execute",
			title: "Executed",
			subtitle: undefined,
			filePath: undefined,
			status: "done",
		});
	});

	it("maps edit tools to a running label and resolves file path from diffs", () => {
		const entry: AgentToolEntry = {
			id: "tool-edit",
			type: "tool_call",
			kind: "edit",
			title: "Edit",
			status: "running",
			editDiffs: [
				{
					filePath: "/repo/src/app.ts",
					newString: "updated",
				},
			],
		};

		expect(mapAgentToolEntryToCompactDisplay(entry)).toEqual({
			id: "tool-edit",
			kind: "edit",
			title: "Editing",
			subtitle: undefined,
			filePath: "/repo/src/app.ts",
			status: "running",
		});
	});

	it("maps fetch tools to a running label with target subtitle", () => {
		const entry: AgentToolEntry = {
			id: "tool-fetch",
			type: "tool_call",
			kind: "fetch",
			title: "Fetch",
			url: "https://example.com/docs",
			subtitle: "example.com",
			status: "running",
		};

		expect(mapAgentToolEntryToCompactDisplay(entry)).toEqual({
			id: "tool-fetch",
			kind: "fetch",
			title: "Fetching",
			subtitle: "example.com",
			filePath: undefined,
			status: "running",
		});
	});

	it("maps skill tools to a running label with skill name subtitle", () => {
		const entry: AgentToolEntry = {
			id: "tool-skill",
			type: "tool_call",
			kind: "skill",
			title: "Skill",
			skillName: "research",
			skillArgs: "topic=agents",
			status: "running",
		};

		expect(mapAgentToolEntryToCompactDisplay(entry)).toEqual({
			id: "tool-skill",
			kind: "skill",
			title: "Running skill",
			subtitle: "/research topic=agents",
			filePath: undefined,
			status: "running",
		});
	});
});
