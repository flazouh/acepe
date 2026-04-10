import type { ConfigOptionData } from "../../../../services/converted-session-types.js";
import type { Model } from "../../../application/dto/model.js";

import { supportsReasoningEffortPicker } from "../../model-selector-logic.js";

const EXCLUDED_TOOLBAR_CONFIG_OPTION_CATEGORIES = new Set(["mode", "model"]);

function includesNormalizedFragment(value: string, fragment: string): boolean {
	return value.toLowerCase().includes(fragment);
}

function isReasoningConfigOption(configOption: ConfigOptionData): boolean {
	return (
		includesNormalizedFragment(configOption.category, "thought") ||
		includesNormalizedFragment(configOption.category, "reason") ||
		includesNormalizedFragment(configOption.id, "thought") ||
		includesNormalizedFragment(configOption.id, "reason") ||
		includesNormalizedFragment(configOption.name, "reason")
	);
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

export function getToolbarConfigOptions(
	configOptions: readonly ConfigOptionData[] | null | undefined,
	availableModels?: readonly Model[] | null | undefined
): ConfigOptionData[] {
	if (!configOptions || configOptions.length === 0) {
		return [];
	}

	const shouldHideReasoningOption = availableModels
		? supportsReasoningEffortPicker(availableModels)
		: false;
	const toolbarConfigOptions: ConfigOptionData[] = [];

	for (const configOption of configOptions) {
		const normalizedCategory = configOption.category.toLowerCase();
		if (EXCLUDED_TOOLBAR_CONFIG_OPTION_CATEGORIES.has(normalizedCategory)) {
			continue;
		}

		if (shouldHideReasoningOption && isReasoningConfigOption(configOption)) {
			continue;
		}

		if (!isInteractiveConfigOption(configOption)) {
			continue;
		}

		toolbarConfigOptions.push(configOption);
	}

	return toolbarConfigOptions;
}
