import { describe, expect, it } from "bun:test";

import { BUILT_IN_MCP_TOOLS } from "./mcp-section.logic.js";

describe("BUILT_IN_MCP_TOOLS", () => {
	it("documents the computer-use MCP command exposed to Claude Code", () => {
		expect(BUILT_IN_MCP_TOOLS).toEqual([
			{
				id: "acepe-computer",
				name: "Acepe computer",
				command: "mcp__acepe_computer__act",
				statusLabel: "Claude Code",
				description: "Computer-use MCP tool exposed to Claude Code.",
				limitation:
					"Native macOS Accessibility actions and Screen Recording screenshot refs are wired.",
			},
		]);
	});
});
