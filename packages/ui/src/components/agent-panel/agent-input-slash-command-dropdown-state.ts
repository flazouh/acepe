export interface AgentInputSlashCommand {
	name: string;
	description: string;
	input?: {
		hint: string;
	} | null;
}

export const MAX_SLASH_COMMAND_RESULTS = 20;

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
