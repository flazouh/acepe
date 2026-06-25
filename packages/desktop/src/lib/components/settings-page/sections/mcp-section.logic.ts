export interface BuiltInMcpToolSettingsEntry {
	readonly id: string;
	readonly name: string;
	readonly command: string;
	readonly statusLabel: string;
	readonly description: string;
	readonly limitation: string;
}

export const BUILT_IN_MCP_TOOLS: readonly BuiltInMcpToolSettingsEntry[] = [
	{
		id: "acepe-computer",
		name: "Acepe computer",
		command: "mcp__acepe_computer__act",
		statusLabel: "Claude Code",
		description: "Computer-use MCP tool exposed to Claude Code.",
		limitation:
			"Native macOS Accessibility actions and Screen Recording screenshot refs are wired.",
	},
];
