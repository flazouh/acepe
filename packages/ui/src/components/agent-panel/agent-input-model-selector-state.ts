import type {
	AgentInputModelSelectorGroup,
	AgentInputModelSelectorItem,
	AgentInputModelSelectorReasoningGroup,
} from "./agent-input-model-selector-types.js";

export const MODEL_SEARCH_THRESHOLD = 12;

export function countSelectableModels(input: {
	readonly usesVariantSelector: boolean;
	readonly modelGroups: readonly AgentInputModelSelectorGroup[];
	readonly reasoningGroups: readonly AgentInputModelSelectorReasoningGroup[];
}): number {
	if (input.usesVariantSelector) {
		return input.reasoningGroups.reduce((count, group) => count + group.variants.length, 0);
	}
	return input.modelGroups.reduce((count, group) => count + group.items.length, 0);
}

export function shouldShowModelSearch(input: {
	readonly usesVariantSelector: boolean;
	readonly totalModelCount: number;
	readonly threshold?: number;
}): boolean {
	return (
		!input.usesVariantSelector &&
		input.totalModelCount > (input.threshold ?? MODEL_SEARCH_THRESHOLD)
	);
}

export function findSelectedReasoningGroup(input: {
	readonly reasoningGroups: readonly AgentInputModelSelectorReasoningGroup[];
	readonly selectedReasoningBaseId: string | null;
}): AgentInputModelSelectorReasoningGroup | null {
	return (
		input.reasoningGroups.find(
			(group) => group.baseModelId === input.selectedReasoningBaseId
		) ??
		input.reasoningGroups[0] ??
		null
	);
}

export function getModelSearchText(item: AgentInputModelSelectorItem): string {
	return `${item.name} ${item.id} ${item.description ?? ""} ${item.providerLabel ?? ""} ${item.searchText ?? ""}`.toLowerCase();
}

export function filterModelGroups(input: {
	readonly modelGroups: readonly AgentInputModelSelectorGroup[];
	readonly searchQuery: string;
}): readonly AgentInputModelSelectorGroup[] {
	const query = input.searchQuery.toLowerCase().trim();
	if (!query) {
		return input.modelGroups;
	}

	return input.modelGroups
		.map((group) => ({
			label: group.label,
			providerBrand: group.providerBrand ?? null,
			providerLabel: group.providerLabel,
			items: group.items.filter((item) => getModelSearchText(item).includes(query)),
		}))
		.filter((group) => group.items.length > 0);
}

export function shouldShowModelGroups(
	groups: readonly AgentInputModelSelectorGroup[]
): boolean {
	return groups.some((group) => group.label) || groups.length > 1;
}
