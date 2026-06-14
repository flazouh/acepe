import type {
	AttachMenuCommandItem,
	AttachMenuModeItem,
} from "@acepe/ui/agent-panel";

import type { AvailableCommand } from "../../../types/available-command.js";
import type { AvailableMode } from "../../../types/available-mode.js";

interface BuildAttachMenuModesInput {
	readonly modes: readonly AvailableMode[];
	readonly currentModeId: string | null;
}

interface BuildAttachMenuCommandsInput {
	readonly commands: readonly AvailableCommand[];
	readonly tokenType: "command" | "skill";
}

export function buildAttachMenuModes(input: BuildAttachMenuModesInput): readonly AttachMenuModeItem[] {
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

export function buildAttachMenuCommands(
	input: BuildAttachMenuCommandsInput
): readonly AttachMenuCommandItem[] {
	const items: AttachMenuCommandItem[] = [];
	for (const command of input.commands) {
		items.push({
			id: command.name,
			label: command.name,
			description: command.description,
			tokenType: input.tokenType,
		});
	}
	return items;
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
