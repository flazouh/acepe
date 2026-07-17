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
	readonly resolvableModelId: string | null;
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

export function hasResolvableToolbarSelection(input: {
	readonly resolvableModelId: string | null;
	readonly isCacheLoaded: boolean;
	readonly availableModelsCount: number;
	readonly visibleModesCount: number;
	readonly modelsDisplay: ModelsForDisplay | null;
}): boolean {
	if (input.resolvableModelId) {
		return true;
	}

	if (input.isCacheLoaded && input.availableModelsCount > 0) {
		return true;
	}

	return hasToolbarCapabilityData({
		visibleModesCount: input.visibleModesCount,
		availableModelsCount: input.availableModelsCount,
		modelsDisplay: input.modelsDisplay,
	});
}

export function resolveSelectorsLoading(input: ResolveSelectorsLoadingInput): boolean {
	const hasResolvableSelection = hasResolvableToolbarSelection({
		resolvableModelId: input.resolvableModelId,
		isCacheLoaded: input.isCacheLoaded,
		availableModelsCount: input.availableModelsCount,
		visibleModesCount: input.visibleModesCount,
		modelsDisplay: input.modelsDisplay,
	});

	if (
		input.hasSession &&
		input.isSessionConnecting &&
		!hasResolvableSelection &&
		!input.isCacheLoaded
	) {
		return true;
	}

	if (!input.hasSession && input.hasSelectedAgent && !hasResolvableSelection && !input.isCacheLoaded) {
		return true;
	}

	if (
		!input.hasSession &&
		input.hasSelectedAgent &&
		!hasResolvableSelection &&
		input.isPreconnectionLoading
	) {
		return true;
	}

	return false;
}
