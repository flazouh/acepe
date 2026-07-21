import type {
	AttachMenuCommandItem,
	AttachMenuCommandSection,
	AttachMenuMcpServerGroup,
	AttachMenuModeItem,
} from "@acepe/ui/agent-panel";

import type { ComposerMcpCatalog } from "$lib/services/acp-types.js";
import type { AvailableCommand } from "../../../types/available-command.js";
import type { AvailableMode } from "../../../types/available-mode.js";
import { isSlashSkillCommand } from "./slash-command-source.js";

export type AttachMenuCommandTokenType = "command" | "skill" | "mcp";

interface BuildAttachMenuModesInput {
	readonly modes: readonly AvailableMode[];
	readonly currentModeId: string | null;
}

interface BuildAttachMenuCommandSectionsInput {
	readonly commands: readonly AvailableCommand[];
	readonly preconnectionCommands: readonly AvailableCommand[];
}

export function buildAttachMenuModes(
	input: BuildAttachMenuModesInput
): readonly AttachMenuModeItem[] {
	const items: AttachMenuModeItem[] = [];
	for (const mode of input.modes) {
		items.push({
			id: mode.id,
			label: mode.name,
			description: mode.description ?? null,
			iconKind: mode.iconKind ?? "unknown",
			selected: mode.id === input.currentModeId,
			disabled: false,
		});
	}
	return items;
}

export function isMcpSlashCommand(commandName: string): boolean {
	return commandName.startsWith("mcp:");
}

export function classifyAttachMenuCommand(input: {
	readonly command: AvailableCommand;
	readonly preconnectionCommands: readonly AvailableCommand[];
}): AttachMenuCommandTokenType {
	if (isMcpSlashCommand(input.command.name)) {
		return "mcp";
	}
	if (
		isSlashSkillCommand({
			command: input.command,
			preconnectionCommands: input.preconnectionCommands,
		})
	) {
		return "skill";
	}
	return "command";
}

export function buildAttachMenuCommandSections(
	input: BuildAttachMenuCommandSectionsInput
): readonly AttachMenuCommandSection[] {
	const skills: AttachMenuCommandItem[] = [];
	const commands: AttachMenuCommandItem[] = [];

	for (const command of input.commands) {
		if (isMcpSlashCommand(command.name)) {
			continue;
		}
		const tokenType = classifyAttachMenuCommand({
			command,
			preconnectionCommands: input.preconnectionCommands,
		});
		const item: AttachMenuCommandItem = {
			id: command.name,
			label: command.name,
			description: command.description,
			tokenType,
		};
		if (tokenType === "skill") {
			skills.push(item);
		} else {
			commands.push(item);
		}
	}

	const sections: AttachMenuCommandSection[] = [];
	if (skills.length > 0) {
		sections.push({ id: "skills", label: "Skills", items: skills });
	}
	if (commands.length > 0) {
		sections.push({ id: "commands", label: "Commands", items: commands });
	}
	return sections;
}

export function buildAttachMenuMcpServerGroups(
	catalog: ComposerMcpCatalog | null
): readonly AttachMenuMcpServerGroup[] {
	if (!catalog || catalog.servers.length === 0) {
		return [];
	}

	const groups: AttachMenuMcpServerGroup[] = [];
	for (const server of catalog.servers) {
		const slashItems: AttachMenuCommandItem[] = [];
		for (const command of server.slashCommands) {
			slashItems.push({
				id: command.name,
				label: command.name,
				description: command.description,
				tokenType: "mcp",
				insertText: `@[command:/${command.name}]`,
			});
		}

		const toolItems: AttachMenuCommandItem[] = [];
		for (const tool of server.tools) {
			toolItems.push({
				id: tool.id,
				label: tool.name,
				description: tool.description,
				tokenType: "mcp",
				insertText: tool.insertText,
			});
		}

		groups.push({
			id: server.id,
			name: server.name,
			status: server.status,
			error: server.error,
			slashItems,
			toolItems,
		});
	}
	return groups;
}

export function resolveAttachMenuInsertText(input: {
	readonly command: AvailableCommand;
	readonly tokenType: AttachMenuCommandTokenType;
}): string {
	if (input.tokenType === "skill") {
		return `@[skill:/${input.command.name}]`;
	}
	return `@[command:/${input.command.name}]`;
}

export function resolveAttachMenuItemInsertText(item: AttachMenuCommandItem): string {
	if (item.insertText) {
		return item.insertText;
	}
	if (item.tokenType === "skill") {
		return `@[skill:/${item.label}]`;
	}
	return `@[command:/${item.label}]`;
}

export function resolveDefaultModeId(modes: readonly AvailableMode[]): string | null {
	if (modes.length === 0) {
		return null;
	}
	return modes[0].id;
}

export function shouldShowActiveModeChip(
	modes: readonly AvailableMode[],
	currentModeId: string | null
): boolean {
	if (modes.length <= 1) return false;
	if (currentModeId === null) return false;
	const defaultId = resolveDefaultModeId(modes);
	return currentModeId !== defaultId;
}
