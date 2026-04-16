export interface AgentInputModelSelectorItem {
	id: string;
	name: string;
	providerSource: string;
	description?: string;
	searchText?: string;
	isFavorite?: boolean;
	isPlanDefault?: boolean;
	isBuildDefault?: boolean;
}

export interface AgentInputModelSelectorGroup {
	label: string;
	items: readonly AgentInputModelSelectorItem[];
}

export interface AgentInputModelSelectorVariant {
	id: string;
	name: string;
}

export interface AgentInputModelSelectorReasoningGroup {
	baseModelId: string;
	baseModelName: string;
	providerSource: string;
	preferredVariantId?: string | null;
	isPlanDefault?: boolean;
	isBuildDefault?: boolean;
	variants: readonly AgentInputModelSelectorVariant[];
}
