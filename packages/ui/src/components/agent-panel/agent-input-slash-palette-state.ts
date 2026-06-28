import type { AgentInputSlashCommandTokenType } from "./agent-input-slash-command-dropdown-state.js";
import type { ModeIconKind } from "./agent-input-mode-selector-state.js";
import type { ProviderBrand } from "../provider-mark/index.js";

export const SLASH_PALETTE_SECTION_PREVIEW_COUNT = 3;

export type SlashPaletteSectionId = "models" | "modes" | "skills" | "commands" | "mcp";

export type SlashPaletteItemKind = "model" | "mode" | "skill" | "command" | "mcp";

export interface SlashPaletteItem {
	readonly id: string;
	readonly kind: SlashPaletteItemKind;
	readonly label: string;
	readonly description?: string | null;
	readonly tokenType?: AgentInputSlashCommandTokenType;
	readonly modeIconKind?: ModeIconKind;
	readonly providerBrand?: ProviderBrand | null;
	readonly providerLabel?: string | null;
	readonly modelId?: string;
	readonly modeId?: string;
	readonly commandName?: string;
	readonly insertText?: string;
	readonly selected?: boolean;
}

export interface SlashPaletteSection {
	readonly id: SlashPaletteSectionId;
	readonly label: string;
	readonly items: readonly SlashPaletteItem[];
}

export interface SlashPaletteVisibleSection {
	readonly id: SlashPaletteSectionId;
	readonly label: string;
	readonly items: readonly SlashPaletteItem[];
	readonly hiddenCount: number;
}

export interface SlashPaletteFlatEntry {
	readonly item: SlashPaletteItem;
	readonly flatIndex: number;
	readonly sectionId: SlashPaletteSectionId;
}

function normalizeSearchQuery(query: string): string {
	return query.trim().toLowerCase();
}

function matchesPaletteItem(item: SlashPaletteItem, query: string): boolean {
	if (query.length === 0) {
		return true;
	}
	const haystack = `${item.label} ${item.description ?? ""} ${item.commandName ?? ""}`.toLowerCase();
	return haystack.includes(query);
}

export function slashPaletteHasContent(sections: readonly SlashPaletteSection[]): boolean {
	for (const section of sections) {
		if (section.items.length > 0) {
			return true;
		}
	}
	return false;
}

export function getSlashPaletteVisibleSections(input: {
	readonly sections: readonly SlashPaletteSection[];
	readonly query: string;
	readonly expandedSectionIds: ReadonlySet<SlashPaletteSectionId>;
}): SlashPaletteVisibleSection[] {
	const query = normalizeSearchQuery(input.query);
	const isSearching = query.length > 0;
	const visibleSections: SlashPaletteVisibleSection[] = [];

	for (const section of input.sections) {
		const filteredItems = section.items.filter((item) => matchesPaletteItem(item, query));
		if (filteredItems.length === 0) {
			continue;
		}

		if (isSearching || input.expandedSectionIds.has(section.id)) {
			visibleSections.push({
				id: section.id,
				label: section.label,
				items: filteredItems,
				hiddenCount: 0,
			});
			continue;
		}

		const previewItems = filteredItems.slice(0, SLASH_PALETTE_SECTION_PREVIEW_COUNT);
		const hiddenCount = Math.max(0, filteredItems.length - previewItems.length);
		visibleSections.push({
			id: section.id,
			label: section.label,
			items: previewItems,
			hiddenCount,
		});
	}

	return visibleSections;
}

export function flattenSlashPaletteItems(
	sections: readonly SlashPaletteVisibleSection[]
): SlashPaletteFlatEntry[] {
	const entries: SlashPaletteFlatEntry[] = [];
	let flatIndex = 0;
	for (const section of sections) {
		for (const item of section.items) {
			entries.push({
				item,
				flatIndex,
				sectionId: section.id,
			});
			flatIndex += 1;
		}
	}
	return entries;
}

export function getSlashPaletteEmptyState(input: {
	readonly sectionCount: number;
	readonly visibleItemCount: number;
	readonly query: string;
}): "none" | "no-content" | "no-results" | "start-typing" {
	if (input.visibleItemCount > 0) {
		return "none";
	}
	if (input.sectionCount === 0) {
		return "no-content";
	}
	if (input.query.trim().length > 0) {
		return "no-results";
	}
	return "start-typing";
}

export function getEffectiveSlashPaletteIndex(input: {
	readonly selectedIndex: number;
	readonly itemCount: number;
}): number {
	if (input.itemCount === 0) {
		return 0;
	}
	return Math.max(0, Math.min(input.selectedIndex, input.itemCount - 1));
}

export function getNextSlashPaletteIndex(input: {
	readonly currentIndex: number;
	readonly itemCount: number;
	readonly direction: "down" | "up";
}): number {
	if (input.itemCount === 0) {
		return 0;
	}
	if (input.direction === "down") {
		return (input.currentIndex + 1) % input.itemCount;
	}
	return input.currentIndex <= 0 ? input.itemCount - 1 : input.currentIndex - 1;
}
