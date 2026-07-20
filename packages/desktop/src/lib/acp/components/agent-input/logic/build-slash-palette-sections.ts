import type { ProviderBrand } from "@acepe/ui";
import type { SlashPaletteItem, SlashPaletteSection } from "@acepe/ui/agent-panel";
import type { ProviderMetadataProjection } from "$lib/services/acp-provider-metadata.js";
import type { ComposerMcpCatalog, ModelsForDisplay } from "$lib/services/acp-types.js";
import type { Model } from "../../../application/dto/model.js";
import type { AvailableCommand } from "../../../types/available-command.js";
import type { AvailableMode } from "../../../types/available-mode.js";
import type { ModelId } from "../../../types/model-id.js";
import {
	getModelSelectorItemId,
	getModelSelectorItemLabel,
	getModelSelectorProviderBrand,
} from "../../model-selector-state.js";
import {
	buildAttachMenuCommandSections,
	buildAttachMenuMcpServerGroups,
	buildAttachMenuModes,
	classifyAttachMenuCommand,
} from "./attach-menu-items.js";

interface BuildSlashPaletteSectionsInput {
	readonly modes: readonly AvailableMode[];
	readonly currentModeId: string | null;
	readonly availableModels: readonly Model[];
	readonly modelsDisplay?: ModelsForDisplay | null;
	readonly currentModelId: ModelId | null;
	readonly agentId: string | null;
	readonly providerMetadata?: ProviderMetadataProjection | null;
	readonly commands: readonly AvailableCommand[];
	readonly preconnectionCommands: readonly AvailableCommand[];
	readonly mcpCatalog: ComposerMcpCatalog | null;
}

function buildModelPaletteItems(input: {
	readonly availableModels: readonly Model[];
	readonly modelsDisplay?: ModelsForDisplay | null;
	readonly currentModelId: ModelId | null;
	readonly agentId: string | null;
	readonly providerBrand: ProviderBrand | null;
	readonly providerLabel: string | null;
}): SlashPaletteItem[] {
	if (input.availableModels.length === 0 && !input.modelsDisplay?.groups?.length) {
		return [];
	}

	const items: SlashPaletteItem[] = [];
	const seenIds = new Set<string>();

	if (input.modelsDisplay?.groups) {
		for (const group of input.modelsDisplay.groups) {
			for (const model of group.models) {
				if (seenIds.has(model.modelId)) {
					continue;
				}
				seenIds.add(model.modelId);
				items.push({
					id: `model:${model.modelId}`,
					kind: "model",
					label: model.displayName,
					description: group.label ?? null,
					modelId: model.modelId,
					providerBrand: input.providerBrand,
					providerLabel: input.providerLabel ?? group.label ?? null,
					selected: model.modelId === input.currentModelId,
				});
			}
		}
	}

	for (const model of input.availableModels) {
		const modelId = getModelSelectorItemId(model);
		if (seenIds.has(modelId)) {
			continue;
		}
		seenIds.add(modelId);
		items.push({
			id: `model:${modelId}`,
			kind: "model",
			label: getModelSelectorItemLabel({
				model,
				agentId: input.agentId,
				modelsDisplay: input.modelsDisplay,
			}),
			description: model.description ?? null,
			modelId,
			providerBrand: input.providerBrand,
			providerLabel: input.providerLabel ?? model.name,
			selected: modelId === input.currentModelId,
		});
	}

	return items;
}

function buildMcpPaletteItems(
	groups: ReturnType<typeof buildAttachMenuMcpServerGroups>
): SlashPaletteItem[] {
	const items: SlashPaletteItem[] = [];
	for (const group of groups) {
		for (const slashItem of group.slashItems) {
			items.push({
				id: slashItem.id,
				kind: "mcp",
				label: slashItem.label,
				description: slashItem.description ?? group.name,
				tokenType: "mcp",
				commandName: slashItem.label,
				insertText: slashItem.insertText,
			});
		}
	}
	return items;
}

export function buildSlashPaletteSections(
	input: BuildSlashPaletteSectionsInput
): readonly SlashPaletteSection[] {
	const sections: SlashPaletteSection[] = [];
	const providerBrand = getModelSelectorProviderBrand(input.providerMetadata?.providerBrand);
	const providerLabel = input.providerMetadata?.displayName ?? null;

	const modelItems = buildModelPaletteItems({
		availableModels: input.availableModels,
		modelsDisplay: input.modelsDisplay,
		currentModelId: input.currentModelId,
		agentId: input.agentId,
		providerBrand,
		providerLabel,
	});
	if (modelItems.length > 0) {
		sections.push({
			id: "models",
			label: "Models",
			items: modelItems,
		});
	}

	const modeItems = buildAttachMenuModes({
		modes: input.modes,
		currentModeId: input.currentModeId,
	}).map(
		(mode): SlashPaletteItem => ({
			id: `mode:${mode.id}`,
			kind: "mode",
			label: mode.label,
			description: mode.description ?? null,
			modeIconKind: mode.iconKind,
			modeId: mode.id,
			selected: mode.selected,
		})
	);
	if (modeItems.length > 0) {
		sections.push({
			id: "modes",
			label: "Modes",
			items: modeItems,
		});
	}

	const commandSections = buildAttachMenuCommandSections({
		commands: input.commands,
		preconnectionCommands: input.preconnectionCommands,
	});
	for (const section of commandSections) {
		const items = section.items.map(
			(item): SlashPaletteItem => ({
				id: `${section.id}:${item.id}`,
				kind: item.tokenType === "skill" ? "skill" : "command",
				label: item.label,
				description: item.description ?? null,
				tokenType: item.tokenType,
				commandName: item.label,
				insertText: item.insertText,
			})
		);
		if (items.length > 0) {
			sections.push({
				id: section.id,
				label: section.label,
				items,
			});
		}
	}

	const mcpGroups = buildAttachMenuMcpServerGroups(input.mcpCatalog);
	const mcpItems = buildMcpPaletteItems(mcpGroups);
	if (mcpItems.length > 0) {
		sections.push({
			id: "mcp",
			label: "MCP",
			items: mcpItems,
		});
	}

	return sections;
}

export function resolveSlashPaletteItemInsertText(item: SlashPaletteItem): string | null {
	if (item.insertText) {
		return item.insertText;
	}
	if (item.kind === "skill" && item.commandName) {
		return `@[skill:/${item.commandName}]`;
	}
	if ((item.kind === "command" || item.kind === "mcp") && item.commandName) {
		return `@[command:/${item.commandName}]`;
	}
	return null;
}

export function classifySlashPaletteCommand(input: {
	readonly command: AvailableCommand;
	readonly preconnectionCommands: readonly AvailableCommand[];
}): "skill" | "command" | "mcp" {
	const tokenType = classifyAttachMenuCommand(input);
	if (tokenType === "mcp") {
		return "mcp";
	}
	if (tokenType === "skill") {
		return "skill";
	}
	return "command";
}
