import type { AgentInputSlashCommandTokenType } from "./agent-input-slash-command-dropdown-state.js";
import { COLOR_NAMES, Colors } from "../../lib/colors.js";

export function getSlashCommandIconColor(tokenType: AgentInputSlashCommandTokenType): string {
	if (tokenType === "skill") {
		return Colors[COLOR_NAMES.PURPLE];
	}
	if (tokenType === "mcp") {
		return Colors[COLOR_NAMES.CYAN];
	}
	return Colors[COLOR_NAMES.AMBER];
}

export function getSlashCommandDisplayName(
	commandName: string,
	tokenType: AgentInputSlashCommandTokenType
): string {
	if (tokenType === "mcp" && commandName.startsWith("mcp:")) {
		return commandName;
	}
	return `/${commandName}`;
}
