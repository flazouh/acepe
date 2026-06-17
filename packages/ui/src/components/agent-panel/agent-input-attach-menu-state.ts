import type { AgentInputSlashCommandTokenType } from "./agent-input-slash-command-dropdown-state.js";
import type { ModeIconKind } from "./agent-input-mode-selector-state.js";

export interface AttachMenuModeItem {
	readonly id: string;
	readonly label: string;
	readonly description?: string | null;
	readonly iconKind: ModeIconKind;
	readonly selected: boolean;
	readonly disabled?: boolean;
}

export interface AttachMenuCommandItem {
	readonly id: string;
	readonly label: string;
	readonly description?: string | null;
	readonly tokenType: AgentInputSlashCommandTokenType;
	readonly insertText?: string;
}

export interface AttachMenuCommandSection {
	readonly id: "skills" | "commands";
	readonly label: string;
	readonly items: readonly AttachMenuCommandItem[];
}

export type AttachMenuMcpConnectionStatus =
	| "connected"
	| "failed"
	| "needs-auth"
	| "pending"
	| "disabled"
	| "unknown";

export interface AttachMenuMcpServerGroup {
	readonly id: string;
	readonly name: string;
	readonly status: AttachMenuMcpConnectionStatus;
	readonly error: string | null;
	readonly slashItems: readonly AttachMenuCommandItem[];
	readonly toolItems: readonly AttachMenuCommandItem[];
}

export interface AttachMenuSearchInput {
	readonly query: string;
	readonly modes: readonly AttachMenuModeItem[];
	readonly commandSections: readonly AttachMenuCommandSection[];
	readonly mcpServerGroups: readonly AttachMenuMcpServerGroup[];
}

export interface AttachMenuSearchResult {
	readonly query: string;
	readonly modes: readonly AttachMenuModeItem[];
	readonly commandSections: readonly AttachMenuCommandSection[];
	readonly mcpServerGroups: readonly AttachMenuMcpServerGroup[];
}

function normalizeSearchQuery(query: string): string {
	return query.trim().toLowerCase();
}

function matchesSearch(label: string, description: string | null | undefined, query: string): boolean {
	if (query.length === 0) {
		return true;
	}
	const haystack = `${label} ${description ?? ""}`.toLowerCase();
	return haystack.includes(query);
}

function filterCommandItems(
	items: readonly AttachMenuCommandItem[],
	query: string
): AttachMenuCommandItem[] {
	return items.filter((item) => matchesSearch(item.label, item.description, query));
}

export function filterAttachMenuItems(input: AttachMenuSearchInput): AttachMenuSearchResult {
	const query = normalizeSearchQuery(input.query);
	const commandSections: AttachMenuCommandSection[] = [];
	for (const section of input.commandSections) {
		const items = filterCommandItems(section.items, query);
		if (items.length > 0) {
			commandSections.push({
				id: section.id,
				label: section.label,
				items,
			});
		}
	}

	const mcpServerGroups: AttachMenuMcpServerGroup[] = [];
	for (const group of input.mcpServerGroups) {
		const serverMatches = matchesSearch(group.name, group.error, query);
		const slashItems = filterCommandItems(group.slashItems, query);
		const toolItems = filterCommandItems(group.toolItems, query);
		if (serverMatches || slashItems.length > 0 || toolItems.length > 0) {
			mcpServerGroups.push({
				id: group.id,
				name: group.name,
				status: group.status,
				error: group.error,
				slashItems: serverMatches ? group.slashItems : slashItems,
				toolItems: serverMatches ? group.toolItems : toolItems,
			});
		}
	}

	return {
		query,
		modes: input.modes.filter((mode) => matchesSearch(mode.label, mode.description, query)),
		commandSections,
		mcpServerGroups,
	};
}
