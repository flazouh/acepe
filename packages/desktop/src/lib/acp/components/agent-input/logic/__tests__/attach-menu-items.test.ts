import { describe, expect, it } from "vitest";

import {
	buildAttachMenuCommandSections,
	buildAttachMenuMcpServerGroups,
	buildAttachMenuModes,
	resolveAttachMenuItemInsertText,
	resolveDefaultModeId,
	shouldShowActiveModeChip,
} from "../attach-menu-items.js";
import { resolveComposerPlaceholder } from "../composer-placeholder.js";
import type { ComposerMcpCatalog } from "$lib/services/acp-types.js";

describe("buildAttachMenuModes", () => {
	it("maps available modes to attach menu items with selection state", () => {
		const items = buildAttachMenuModes({
			modes: [
				{ id: "plan", name: "Plan", description: "Read-only planning", iconKind: "plan" },
				{ id: "agent", name: "Agent", description: "Execute changes", iconKind: "agent" },
			],
			currentModeId: "agent",
		});

		expect(items).toHaveLength(2);
		expect(items[0]).toEqual({
			id: "plan",
			label: "Plan",
			description: "Read-only planning",
			iconKind: "plan",
			selected: false,
			disabled: false,
		});
		expect(items[1]?.selected).toBe(true);
	});
});

describe("buildAttachMenuCommandSections", () => {
	it("groups skills and non-mcp commands into separate sections", () => {
		const sections = buildAttachMenuCommandSections({
			commands: [
				{ name: "ce-plan", description: "Create a plan" },
				{ name: "mcp:github", description: "GitHub MCP" },
				{ name: "review", description: "Run review" },
			],
			preconnectionCommands: [{ name: "ce-plan", description: "Create a plan" }],
		});

		expect(sections).toHaveLength(2);
		expect(sections[0]).toEqual({
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
		});
		expect(sections[1]?.id).toBe("commands");
		expect(sections[1]?.items).toEqual([
			{
				id: "review",
				label: "review",
				description: "Run review",
				tokenType: "command",
			},
		]);
	});
});

describe("buildAttachMenuMcpServerGroups", () => {
	it("maps catalog servers to attach menu MCP groups with insert text", () => {
		const catalog: ComposerMcpCatalog = {
			source: "mixed",
			servers: [
				{
					id: "github",
					name: "github",
					status: "connected",
					error: null,
					slashCommands: [{ name: "mcp:github", description: "GitHub server" }],
					tools: [
						{
							id: "github-search",
							name: "search_issues",
							description: "Search issues",
							insertText: "@[command:/mcp:github/search_issues]",
						},
					],
				},
			],
		};

		expect(buildAttachMenuMcpServerGroups(catalog)).toEqual([
			{
				id: "github",
				name: "github",
				status: "connected",
				error: null,
				slashItems: [
					{
						id: "mcp:github",
						label: "mcp:github",
						description: "GitHub server",
						tokenType: "mcp",
						insertText: "@[command:/mcp:github]",
					},
				],
				toolItems: [
					{
						id: "github-search",
						label: "search_issues",
						description: "Search issues",
						tokenType: "mcp",
						insertText: "@[command:/mcp:github/search_issues]",
					},
				],
			},
		]);
	});

	it("returns empty array when catalog is null or has no servers", () => {
		expect(buildAttachMenuMcpServerGroups(null)).toEqual([]);
		expect(buildAttachMenuMcpServerGroups({ source: "preconnectionConfig", servers: [] })).toEqual(
			[]
		);
	});
});

describe("resolveAttachMenuItemInsertText", () => {
	it("uses explicit insert text when provided", () => {
		expect(
			resolveAttachMenuItemInsertText({
				id: "tool-1",
				label: "search",
				tokenType: "mcp",
				insertText: "@[command:/mcp:github/search]",
			})
		).toBe("@[command:/mcp:github/search]");
	});

	it("builds skill and command tokens from label when insert text is absent", () => {
		expect(
			resolveAttachMenuItemInsertText({
				id: "ce-plan",
				label: "ce-plan",
				tokenType: "skill",
			})
		).toBe("@[skill:/ce-plan]");
		expect(
			resolveAttachMenuItemInsertText({
				id: "review",
				label: "review",
				tokenType: "command",
			})
		).toBe("@[command:/review]");
	});
});

describe("resolveDefaultModeId", () => {
	it("returns the first mode when modes exist", () => {
		expect(
			resolveDefaultModeId([
				{ id: "plan", name: "Plan" },
				{ id: "agent", name: "Agent" },
			])
		).toBe("plan");
	});

	it("returns null when no modes exist", () => {
		expect(resolveDefaultModeId([])).toBeNull();
	});
});

describe("shouldShowActiveModeChip", () => {
	const modes = [
		{ id: "agent", name: "Agent" },
		{ id: "plan", name: "Plan" },
	];

	it("hides the chip when only one mode exists", () => {
		expect(shouldShowActiveModeChip([{ id: "agent", name: "Agent" }], "agent")).toBe(false);
	});

	it("hides the chip when the current mode is the default (first) mode", () => {
		expect(shouldShowActiveModeChip(modes, "agent")).toBe(false);
	});

	it("shows the chip when the current mode is a non-default mode", () => {
		expect(shouldShowActiveModeChip(modes, "plan")).toBe(true);
	});

	it("hides the chip when currentModeId is null and default is first mode", () => {
		expect(shouldShowActiveModeChip(modes, null)).toBe(false);
	});
});

describe("resolveComposerPlaceholder", () => {
	it("prompts for a follow-up once a session is active", () => {
		expect(resolveComposerPlaceholder({ hasSession: true })).toBe("Send follow-up");
	});

	it("shows the typing hint when there is no session yet", () => {
		expect(resolveComposerPlaceholder({ hasSession: false })).toBe(
			"Plan, @ for context, / for commands"
		);
	});

	it("honors a custom fallback when there is no session", () => {
		expect(resolveComposerPlaceholder({ hasSession: false, fallback: "Ask anything" })).toBe(
			"Ask anything"
		);
	});
});
