import type { Model } from "../../../application/dto/model.js";

export function getValidPrGenerationModelId(
	modelId: string | null | undefined,
	models: readonly Model[],
): string | undefined {
	if (!modelId) return undefined;
	const match = models.find((model) => model.id === modelId);
	return match ? modelId : undefined;
}

export function buildPrGenerationPrefsForAgentSelection(
	agentId: string | undefined,
	modelId: string | undefined,
	customPrompt: string | undefined,
	models: readonly Model[],
): {
	agentId?: string;
	modelId?: string;
	customPrompt?: string;
} {
	const prefs: {
		agentId?: string;
		modelId?: string;
		customPrompt?: string;
	} = {};
	const validModelId = getValidPrGenerationModelId(modelId, models);

	if (agentId) prefs.agentId = agentId;
	if (validModelId) prefs.modelId = validModelId;
	if (customPrompt) prefs.customPrompt = customPrompt;

	return prefs;
}

export function buildPrGenerationRequestConfig(
	agentId: string | undefined,
	modelId: string | undefined,
	customPrompt: string | undefined,
	models: readonly Model[],
): {
	agentId?: string;
	modelId?: string;
	customPrompt?: string;
} | undefined {
	const config = buildPrGenerationPrefsForAgentSelection(
		agentId,
		modelId,
		customPrompt,
		models,
	);

	if (!config.agentId && !config.modelId && !config.customPrompt) {
		return undefined;
	}

	return config;
}