import type { ConfigOptionData } from "../../../../services/converted-session-types.js";

export function applyProvisionalConfigOptionOverrides(
	configOptions: readonly ConfigOptionData[],
	provisionalValues: Readonly<Record<string, string>>
): ConfigOptionData[] {
	const overrideKeys = Object.keys(provisionalValues);
	if (overrideKeys.length === 0) {
		return configOptions.map((option) => ({
			id: option.id,
			name: option.name,
			category: option.category,
			type: option.type,
			description: option.description,
			currentValue: option.currentValue,
			options: option.options,
			presentation: option.presentation,
		}));
	}

	return configOptions.map((option) => {
		const overrideValue = provisionalValues[option.id];
		if (overrideValue === undefined) {
			return {
				id: option.id,
				name: option.name,
				category: option.category,
				type: option.type,
				description: option.description,
				currentValue: option.currentValue,
				options: option.options,
				presentation: option.presentation,
			};
		}

		return {
			id: option.id,
			name: option.name,
			category: option.category,
			type: option.type,
			description: option.description,
			currentValue: overrideValue,
			options: option.options,
			presentation: option.presentation,
		};
	});
}

export function listProvisionalConfigEntriesToApply(input: {
	provisionalValues: Readonly<Record<string, string>>;
	liveConfigOptions: readonly ConfigOptionData[] | null | undefined;
}): Array<{ configId: string; value: string }> {
	const entries: Array<{ configId: string; value: string }> = [];

	for (const [configId, value] of Object.entries(input.provisionalValues)) {
		const liveOption = input.liveConfigOptions?.find((option) => option.id === configId);
		const liveValue = liveOption?.currentValue;
		const liveString = liveValue === null || liveValue === undefined ? null : String(liveValue);
		if (liveString !== value) {
			entries.push({ configId, value });
		}
	}

	return entries;
}
