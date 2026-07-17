import type { ProviderBrand } from "../provider-mark/index.js";
import type { UpstreamProviderBrand } from "../../lib/upstream-provider-brand.js";

export interface AgentInputModelSelectorItem {
	id: string;
	name: string;
	providerBrand?: ProviderBrand | null;
	providerLabel?: string;
	description?: string;
	searchText?: string;
	isFavorite?: boolean;
	isDefault?: boolean;
	hideProviderMark?: boolean;
}

export interface AgentInputModelSelectorGroup {
	label: string;
	providerId?: string;
	upstreamProviderBrand?: UpstreamProviderBrand | null;
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
	variants: readonly AgentInputModelSelectorVariant[];
}
