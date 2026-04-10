import type { AvailableCommand } from "$lib/acp/types/available-command.js";

export type SlashCommandSource = {
	source: "live" | "preconnection" | "none";
	commands: AvailableCommand[];
	tokenType: "command" | "skill";
};

export function shouldShowSlashCommandDropdown(input: {
	isTriggerActive: boolean;
	source: SlashCommandSource;
	capabilitiesAgentId: string | null;
}): boolean {
	if (!input.isTriggerActive) {
		return false;
	}

	return input.source.source !== "none" && input.capabilitiesAgentId !== null;
}

export function resolveSlashCommandSource(input: {
	liveCommands: ReadonlyArray<AvailableCommand>;
	hasConnectedSession: boolean;
	selectedAgentId: string | null;
	preconnectionCommands: ReadonlyArray<AvailableCommand>;
}): SlashCommandSource {
	if (input.hasConnectedSession) {
		if (input.liveCommands.length > 0) {
			return {
				source: "live",
				commands: Array.from(input.liveCommands),
				tokenType: "command",
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
