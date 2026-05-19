import type { ProviderBrand } from "../provider-mark/index.js";

export interface AgentInputModelSelectorItem {
	id: string;
	name: string;
	providerBrand?: ProviderBrand | null;
	providerLabel?: string;
	description?: string;
	searchText?: string;
	isFavorite?: boolean;
	isPlanDefault?: boolean;
	isBuildDefault?: boolean;
	hideProviderMark?: boolean;
}

export interface AgentInputModelSelectorGroup {
	label: string;
	providerBrand?: ProviderBrand | null;
	providerLabel?: string;
	items: readonly AgentInputModelSelectorItem[];
}

export interface AgentInputModelSelectorVariant {
	id: string;
	name: string;
}

export interface AgentInputModelSelectorReasoningGroup {
	baseModelId: string;
	baseModelName: string;
	providerBrand?: ProviderBrand | null;
	providerLabel?: string;
	preferredVariantId?: string | null;
	isPlanDefault?: boolean;
	isBuildDefault?: boolean;
	variants: readonly AgentInputModelSelectorVariant[];
}
