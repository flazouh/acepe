import type { ModelsForDisplay } from "$lib/services/acp-provider-metadata.js";

export interface ResolveSelectorsLoadingInput {
	readonly hasSession: boolean;
	readonly isSessionConnecting: boolean;
	readonly hasSelectedAgent: boolean;
	readonly visibleModesCount: number;
	readonly availableModelsCount: number;
	readonly modelsDisplay: ModelsForDisplay | null;
	readonly isCacheLoaded: boolean;
	readonly isPreconnectionLoading: boolean;
}

export function hasUsableModelsDisplay(
	modelsDisplay: ModelsForDisplay | null | undefined
): boolean {
	return modelsDisplay?.groups.some((group) => group.models.length > 0) ?? false;
}

export function hasToolbarCapabilityData(input: {
	readonly visibleModesCount: number;
	readonly availableModelsCount: number;
	readonly modelsDisplay: ModelsForDisplay | null;
}): boolean {
	return (
		input.visibleModesCount > 0 ||
		input.availableModelsCount > 0 ||
		hasUsableModelsDisplay(input.modelsDisplay)
	);
}

export function resolveSelectorsLoading(input: ResolveSelectorsLoadingInput): boolean {
	const hasToolbarData = hasToolbarCapabilityData({
		visibleModesCount: input.visibleModesCount,
		availableModelsCount: input.availableModelsCount,
		modelsDisplay: input.modelsDisplay,
	});

	if (input.hasSession && input.isSessionConnecting && !hasToolbarData) {
		return true;
	}

	if (!input.hasSession && input.hasSelectedAgent && !hasToolbarData && !input.isCacheLoaded) {
		return true;
	}

	if (
		!input.hasSession &&
		input.hasSelectedAgent &&
		!hasToolbarData &&
		input.isPreconnectionLoading
	) {
		return true;
	}

	return false;
}
