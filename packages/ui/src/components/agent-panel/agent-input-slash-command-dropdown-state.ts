export interface AgentInputSlashCommand {
	name: string;
	description: string;
	input?: {
		hint: string;
	} | null;
}

export type AgentInputSlashCommandWorkspaceMarkdownResult =
	| {
			readonly status: "ready";
			readonly markdown: string;
	  }
	| {
			readonly status: "error";
			readonly message: string;
	  };

export const MAX_SLASH_COMMAND_RESULTS = 20;
export type AgentInputSlashCommandTokenType = "command" | "skill";

export function getFilteredSlashCommands(
	commands: ReadonlyArray<AgentInputSlashCommand>,
	query: string
): ReadonlyArray<AgentInputSlashCommand> {
	if (!query || !query.trim()) {
		return commands.slice(0, MAX_SLASH_COMMAND_RESULTS);
	}

	const lowerQuery = query.toLowerCase().trim();
	return commands
		.filter((command) => command.name.toLowerCase().includes(lowerQuery))
		.slice(0, MAX_SLASH_COMMAND_RESULTS);
}

export function getEffectiveSlashCommandIndex(input: {
	selectedIndex: number;
	commandCount: number;
}): number {
	if (input.commandCount === 0) return 0;
	return Math.max(0, Math.min(input.selectedIndex, input.commandCount - 1));
}

export function getNextSlashCommandIndex(input: {
	currentIndex: number;
	commandCount: number;
	direction: "down" | "up";
}): number {
	if (input.commandCount === 0) return 0;
	if (input.direction === "down") {
		return (input.currentIndex + 1) % input.commandCount;
	}
	return input.currentIndex <= 0 ? input.commandCount - 1 : input.currentIndex - 1;
}

export function getSlashCommandEmptyState(input: {
	commandCount: number;
	filteredCount: number;
	query: string;
}): "none" | "no-commands" | "no-results" | "start-typing" {
	if (input.filteredCount > 0) return "none";
	if (input.commandCount === 0) return "no-commands";
	if (input.query.length > 0) return "no-results";
	return "start-typing";
}

export function getSlashCommandKindLabel(tokenType: AgentInputSlashCommandTokenType): string {
	if (tokenType === "skill") {
		return "Skill";
	}
	return "Command";
}

export function getSlashCommandDescriptionCharCount(command: AgentInputSlashCommand): number {
	return command.description.trim().length;
}

export function getSlashCommandMetaLabel(input: {
	command: AgentInputSlashCommand;
	tokenType: AgentInputSlashCommandTokenType;
}): string {
	const kindLabel = getSlashCommandKindLabel(input.tokenType);
	const descriptionCharCount = getSlashCommandDescriptionCharCount(input.command);
	const hint = input.command.input?.hint.trim();
	if (hint && hint.length > 0) {
		return `${kindLabel} - ${descriptionCharCount} chars - ${hint}`;
	}
	return `${kindLabel} - ${descriptionCharCount} chars`;
}

function markdownTableValue(value: string): string {
	return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function getSlashCommandWorkspaceMarkdown(input: {
	command: AgentInputSlashCommand;
	tokenType: AgentInputSlashCommandTokenType;
}): string {
	const kindLabel = getSlashCommandKindLabel(input.tokenType);
	const description = input.command.description.trim();
	const hint = input.command.input?.hint.trim();
	const commandName = markdownTableValue(input.command.name);
	const heading = input.tokenType === "skill" ? "Skill details" : "Command details";
	const nameLabel = input.tokenType === "skill" ? "Skill name" : "Command name";
	const detailRows = [
		`| Type | ${kindLabel} |`,
		"| Name | `/" + commandName + "` |",
		`| Description chars | ${getSlashCommandDescriptionCharCount(input.command)} |`,
	];
	const hintRows = hint && hint.length > 0 ? [`| Input hint | ${markdownTableValue(hint)} |`] : [];

	return [
		`# ${heading}`,
		"",
		`**${nameLabel}:** \`${input.command.name}\``,
		"",
		`**Description:** ${description.length > 0 ? description : "_No description available._"}`,
		"",
		"| Field | Value |",
		"| --- | --- |",
		...detailRows,
		...hintRows,
		"",
		"## Description",
		"",
		description.length > 0 ? description : "_No description available._",
	].join("\n");
}
