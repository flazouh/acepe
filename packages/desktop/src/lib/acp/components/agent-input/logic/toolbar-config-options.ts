import type { ModelsForDisplay } from "../../../../services/acp-types.js";
import type { ConfigOptionData } from "../../../../services/converted-session-types.js";
import type { Model } from "../../../application/dto/model.js";

import { supportsReasoningEffortPicker } from "../../model-selector-logic.js";

function isReasoningConfigOption(configOption: ConfigOptionData): boolean {
	return configOption.presentation === "compactReasoning";
}

function isBooleanLikeValue(value: ConfigOptionData["currentValue"]): boolean {
	if (typeof value === "boolean") {
		return true;
	}

	if (typeof value !== "string") {
		return false;
	}

	const normalizedValue = value.toLowerCase();
	return normalizedValue === "true" || normalizedValue === "false";
}

function isInteractiveConfigOption(configOption: ConfigOptionData): boolean {
	if (configOption.type === "boolean") {
		return true;
	}

	if (isBooleanLikeValue(configOption.currentValue)) {
		return true;
	}

	return Array.isArray(configOption.options) && configOption.options.length > 0;
}

function isCompactToolbarOption(configOption: ConfigOptionData): boolean {
	return (
		configOption.presentation === "compactReasoning" || configOption.presentation === "compactSpeed"
	);
}

export function getToolbarConfigOptions(
	configOptions: readonly ConfigOptionData[] | null | undefined,
	availableModels?: readonly Model[] | null | undefined,
	modelsDisplay?: ModelsForDisplay | null | undefined
): ConfigOptionData[] {
	if (!configOptions || configOptions.length === 0) {
		return [];
	}

	const shouldHideReasoningOption = availableModels
		? supportsReasoningEffortPicker(availableModels, modelsDisplay)
		: false;
	const toolbarConfigOptions: ConfigOptionData[] = [];

	for (const configOption of configOptions) {
		if (shouldHideReasoningOption && isReasoningConfigOption(configOption)) {
			continue;
		}

		if (!isInteractiveConfigOption(configOption)) {
			continue;
		}

		if (!isCompactToolbarOption(configOption)) {
			continue;
		}

		toolbarConfigOptions.push(configOption);
	}

	return toolbarConfigOptions;
}
