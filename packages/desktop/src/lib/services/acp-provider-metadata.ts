import type { ModelsForDisplay, ProviderMetadataProjection } from "./acp-types.js";

export type { ModelsForDisplay, ProviderMetadataProjection } from "./acp-types.js";

export function getProviderMetadataFromModelsDisplay(
	modelsDisplay: ModelsForDisplay | null | undefined
): ProviderMetadataProjection | null {
	return modelsDisplay?.presentation?.provider ?? null;
}
