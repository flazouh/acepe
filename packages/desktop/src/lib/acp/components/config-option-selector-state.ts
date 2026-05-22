import type { ConfigOptionData } from "../../services/converted-session-types.js";

export type ConfigOptionKind = "reasoning" | "fast" | "general";

export interface ConfigOptionSelectorState {
	readonly currentValue: string | null;
	readonly isBoolean: boolean;
	readonly isBooleanEnabled: boolean;
	readonly kind: ConfigOptionKind;
	readonly currentValueLabel: string;
}

function includesNormalizedFragment(value: string, fragment: string): boolean {
	return value.toLowerCase().includes(fragment);
}

export function getConfigOptionCurrentValue(configOption: ConfigOptionData): string | null {
	return configOption.currentValue != null ? String(configOption.currentValue) : null;
}

export function isBooleanConfigOption(configOption: ConfigOptionData): boolean {
	if (configOption.type === "boolean") {
		return true;
	}

	if (typeof configOption.currentValue === "boolean") {
		return true;
	}

	if (typeof configOption.currentValue !== "string") {
		return false;
	}

	const normalizedValue = configOption.currentValue.toLowerCase();
	return normalizedValue === "true" || normalizedValue === "false";
}

export function isBooleanConfigOptionEnabled(currentValue: string | null): boolean {
	if (currentValue === null) {
		return false;
	}

	const normalizedValue = currentValue.toLowerCase();
	return normalizedValue === "true" || normalizedValue === "on" || normalizedValue === "enabled";
}

export function getConfigOptionKind(configOption: ConfigOptionData): ConfigOptionKind {
	if (
		includesNormalizedFragment(configOption.category, "thought") ||
		includesNormalizedFragment(configOption.category, "reason") ||
		includesNormalizedFragment(configOption.id, "thought") ||
		includesNormalizedFragment(configOption.id, "reason") ||
		includesNormalizedFragment(configOption.name, "reason")
	) {
		return "reasoning";
	}

	if (
		includesNormalizedFragment(configOption.category, "fast") ||
		includesNormalizedFragment(configOption.category, "tier") ||
		includesNormalizedFragment(configOption.id, "fast") ||
		includesNormalizedFragment(configOption.id, "tier") ||
		includesNormalizedFragment(configOption.name, "fast") ||
		includesNormalizedFragment(configOption.name, "tier")
	) {
		return "fast";
	}

	return "general";
}

export function getConfigOptionCurrentValueLabel(input: {
	readonly configOption: ConfigOptionData;
	readonly currentValue: string | null;
	readonly isBoolean: boolean;
	readonly isBooleanEnabled: boolean;
}): string {
	const options = input.configOption.options;
	if (options && input.currentValue !== null) {
		return options.find((option) => String(option.value) === input.currentValue)?.name ?? input.currentValue;
	}

	if (input.isBoolean) {
		return input.isBooleanEnabled ? "On" : "Off";
	}

	if (input.currentValue !== null) {
		return input.currentValue;
	}

	return input.configOption.name;
}

export function getNextBooleanConfigOptionValue(isBooleanEnabled: boolean): string {
	return isBooleanEnabled ? "false" : "true";
}

export function buildConfigOptionSelectorState(
	configOption: ConfigOptionData
): ConfigOptionSelectorState {
	const currentValue = getConfigOptionCurrentValue(configOption);
	const isBoolean = isBooleanConfigOption(configOption);
	const isBooleanEnabled = isBoolean && isBooleanConfigOptionEnabled(currentValue);
	const kind = getConfigOptionKind(configOption);
	const currentValueLabel = getConfigOptionCurrentValueLabel({
		configOption,
		currentValue,
		isBoolean,
		isBooleanEnabled,
	});

	return {
		currentValue,
		isBoolean,
		isBooleanEnabled,
		kind,
		currentValueLabel,
	};
}
