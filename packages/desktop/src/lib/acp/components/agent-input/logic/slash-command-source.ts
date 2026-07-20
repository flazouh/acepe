import type { AvailableCommand } from "$lib/acp/types/available-command.js";

export type SlashCommandSource = {
	source: "live" | "preconnection" | "none";
	commands: AvailableCommand[];
	tokenType: "command" | "skill";
};

export function isSlashSkillCommand(input: {
	command: AvailableCommand;
	preconnectionCommands: ReadonlyArray<AvailableCommand>;
}): boolean {
	const preconnectionSkillNames = new Set(
		input.preconnectionCommands.map((command) => command.name)
	);
	if (preconnectionSkillNames.has(input.command.name)) {
		return true;
	}

	const description = input.command.description.toLowerCase();
	return description.includes("skill") || input.command.name.includes("_");
}

function resolveLiveSlashTokenType(input: {
	liveCommands: ReadonlyArray<AvailableCommand>;
	preconnectionCommands: ReadonlyArray<AvailableCommand>;
}): "command" | "skill" {
	if (
		input.liveCommands.length > 0 &&
		input.liveCommands.every((command) =>
			isSlashSkillCommand({
				command,
				preconnectionCommands: input.preconnectionCommands,
			})
		)
	) {
		return "skill";
	}

	return "command";
}

export function shouldShowSlashCommandDropdown(input: {
	isTriggerActive: boolean;
	source: SlashCommandSource;
	capabilitiesAgentId: string | null;
	hasPaletteContent?: boolean;
}): boolean {
	if (!input.isTriggerActive) {
		return false;
	}

	if (input.hasPaletteContent === true) {
		return input.capabilitiesAgentId !== null;
	}

	return input.source.source !== "none";
}

export function resolveSlashCommandSource(input: {
	liveCommands: ReadonlyArray<AvailableCommand>;
	hasSession: boolean;
	hasConnectedSession: boolean;
	selectedAgentId: string | null;
	preconnectionCommands: ReadonlyArray<AvailableCommand>;
}): SlashCommandSource {
	if (input.hasSession) {
		if (input.liveCommands.length > 0) {
			return {
				source: "live",
				commands: Array.from(input.liveCommands),
				tokenType: resolveLiveSlashTokenType({
					liveCommands: input.liveCommands,
					preconnectionCommands: input.preconnectionCommands,
				}),
			};
		}

		return {
			source: "none",
			commands: [],
			tokenType: "command",
		};
	}

	if (input.selectedAgentId && input.preconnectionCommands.length > 0) {
		return {
			source: "preconnection",
			commands: Array.from(input.preconnectionCommands),
			tokenType: "skill",
		};
	}

	return {
		source: "none",
		commands: [],
		tokenType: "command",
	};
}
