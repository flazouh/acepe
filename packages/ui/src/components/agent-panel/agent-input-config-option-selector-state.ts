import { Colors } from "../../lib/colors.js";
import type { AgentInputConfigOption } from "./agent-input-config-option-types.js";

export type ConfigOptionIconKind = "reasoning" | "fast" | "default";
export type ConfigOptionIconWeight = "fill" | "regular";

export interface ConfigOptionViewState {
	currentValue: string | null;
	isBooleanConfigOption: boolean;
	isBooleanEnabled: boolean;
	iconKind: ConfigOptionIconKind;
	currentValueLabel: string;
	iconColor: string;
	iconWeight: ConfigOptionIconWeight;
	iconClass: string;
	iconStyle: string;
	buttonTitle: string;
}

export function isBooleanConfigOption(opt: AgentInputConfigOption): boolean {
	if (opt.type === "boolean") return true;
	if (typeof opt.currentValue === "boolean") return true;
	if (typeof opt.currentValue !== "string") return false;
	const normalized = opt.currentValue.toLowerCase();
	return normalized === "true" || normalized === "false";
}

export function isReasoningConfigOption(opt: AgentInputConfigOption): boolean {
	return opt.presentation === "compactReasoning";
}

export function isFastConfigOption(opt: AgentInputConfigOption): boolean {
	return opt.presentation === "compactSpeed";
}

export function getConfigOptionCurrentValue(
	opt: AgentInputConfigOption
): string | null {
	return opt.currentValue != null ? String(opt.currentValue) : null;
}

export function isConfigOptionBooleanEnabled(
	currentValue: string | null,
	isBooleanOption: boolean
): boolean {
	if (!isBooleanOption || currentValue == null) return false;
	const normalized = currentValue.toLowerCase();
	return normalized === "true" || normalized === "on" || normalized === "enabled";
}

export function getConfigOptionCurrentValueLabel(input: {
	configOption: AgentInputConfigOption;
	currentValue: string | null;
	isBooleanConfigOption: boolean;
	isBooleanEnabled: boolean;
}): string {
	const options = input.configOption.options;
	if (options && input.currentValue != null) {
		return (
			options.find((opt) => String(opt.value) === input.currentValue)?.name ??
			input.currentValue
		);
	}
	if (input.isBooleanConfigOption) return input.isBooleanEnabled ? "On" : "Off";
	if (input.currentValue != null) return input.currentValue;
	return input.configOption.name;
}

export function getConfigOptionIconKind(
	opt: AgentInputConfigOption
): ConfigOptionIconKind {
	if (isFastConfigOption(opt)) return "fast";
	if (isReasoningConfigOption(opt)) return "reasoning";
	return "default";
}

export function getConfigOptionIconColor(iconKind: ConfigOptionIconKind): string {
	if (iconKind === "fast") return Colors.yellow;
	if (iconKind === "reasoning") return Colors.purple;
	return Colors.cyan;
}

export function getConfigOptionIconWeight(input: {
	iconKind: ConfigOptionIconKind;
	isBooleanConfigOption: boolean;
	isBooleanEnabled: boolean;
	currentValue: string | null;
}): ConfigOptionIconWeight {
	if (input.iconKind !== "fast") return "fill";
	if (input.isBooleanConfigOption && input.isBooleanEnabled) return "fill";
	if (!input.isBooleanConfigOption && input.currentValue) {
		const normalized = input.currentValue.toLowerCase();
		if (
			normalized === "fast" ||
			normalized === "true" ||
			normalized === "on" ||
			normalized === "enabled"
		) {
			return "fill";
		}
	}
	return "regular";
}

export function getConfigOptionNextBooleanValue(
	isBooleanEnabled: boolean
): "true" | "false" {
	return isBooleanEnabled ? "false" : "true";
}

export function shouldEmitConfigOptionValueChange(input: {
	nextValue: string;
	currentValue: string | null;
}): boolean {
	return input.nextValue !== input.currentValue;
}

export function getConfigOptionViewState(
	configOption: AgentInputConfigOption
): ConfigOptionViewState {
	const currentValue = getConfigOptionCurrentValue(configOption);
	const isBooleanOption = isBooleanConfigOption(configOption);
	const isBooleanEnabled = isConfigOptionBooleanEnabled(
		currentValue,
		isBooleanOption
	);
	const currentValueLabel = getConfigOptionCurrentValueLabel({
		configOption,
		currentValue,
		isBooleanConfigOption: isBooleanOption,
		isBooleanEnabled,
	});
	const iconKind = getConfigOptionIconKind(configOption);
	const iconColor = getConfigOptionIconColor(iconKind);
	const iconWeight = getConfigOptionIconWeight({
		iconKind,
		isBooleanConfigOption: isBooleanOption,
		isBooleanEnabled,
		currentValue,
	});
	const useMuted = iconKind === "fast" && iconWeight === "regular";

	return {
		currentValue,
		isBooleanConfigOption: isBooleanOption,
		isBooleanEnabled,
		iconKind,
		currentValueLabel,
		iconColor,
		iconWeight,
		iconClass: useMuted ? "text-muted-foreground" : "",
		iconStyle: useMuted ? "" : `color: ${iconColor}`,
		buttonTitle: `${configOption.name}: ${currentValueLabel}`,
	};
}
