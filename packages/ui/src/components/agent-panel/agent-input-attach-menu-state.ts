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
	readonly tokenType: "command" | "skill";
}

export interface AttachMenuSearchInput {
	readonly query: string;
	readonly modes: readonly AttachMenuModeItem[];
	readonly commands: readonly AttachMenuCommandItem[];
}

export interface AttachMenuSearchResult {
	readonly query: string;
	readonly modes: readonly AttachMenuModeItem[];
	readonly commands: readonly AttachMenuCommandItem[];
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

export function filterAttachMenuItems(input: AttachMenuSearchInput): AttachMenuSearchResult {
	const query = normalizeSearchQuery(input.query);
	return {
		query,
		modes: input.modes.filter((mode) => matchesSearch(mode.label, mode.description, query)),
		commands: input.commands.filter((command) =>
			matchesSearch(command.label, command.description, query)
		),
	};
}
