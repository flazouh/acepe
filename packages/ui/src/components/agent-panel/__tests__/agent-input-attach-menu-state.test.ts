import { describe, expect, it } from "vitest";

import { filterAttachMenuItems } from "../agent-input-attach-menu-state.js";

describe("filterAttachMenuItems", () => {
	it("filters modes and command sections by search query", () => {
		const result = filterAttachMenuItems({
			query: "plan",
			modes: [
				{
					id: "plan",
					label: "Plan",
					description: "Read-only planning",
					iconKind: "plan",
					selected: true,
				},
				{
					id: "agent",
					label: "Agent",
					description: "Execute changes",
					iconKind: "agent",
					selected: false,
				},
			],
			commandSections: [
				{
					id: "skills",
					label: "Skills",
					items: [
						{
							id: "ce-plan",
							label: "ce-plan",
							description: "Create a plan",
							tokenType: "skill",
						},
					],
				},
			],
			mcpServerGroups: [],
		});

		expect(result.modes).toHaveLength(1);
		expect(result.modes[0]?.id).toBe("plan");
		expect(result.commandSections).toHaveLength(1);
		expect(result.commandSections[0]?.items).toHaveLength(1);
	});

	it("filters MCP servers by server name and tool labels", () => {
		const result = filterAttachMenuItems({
			query: "search",
			modes: [],
			commandSections: [],
			mcpServerGroups: [
				{
					id: "github",
					name: "github",
					status: "connected",
					error: null,
					slashItems: [],
					toolItems: [
						{
							id: "tool-1",
							label: "search_issues",
							description: "Search GitHub issues",
							tokenType: "mcp",
							insertText: "@[command:/mcp:github/search_issues]",
						},
					],
				},
				{
					id: "linear",
					name: "linear",
					status: "connected",
					error: null,
					slashItems: [],
					toolItems: [
						{
							id: "tool-2",
							label: "create_issue",
							description: "Create issue",
							tokenType: "mcp",
						},
					],
				},
			],
		});

		expect(result.mcpServerGroups).toHaveLength(1);
		expect(result.mcpServerGroups[0]?.id).toBe("github");
		expect(result.mcpServerGroups[0]?.toolItems).toHaveLength(1);
	});
});
