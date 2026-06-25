import { Colors } from "../../lib/colors.js";
import type { AgentInputConfigOption } from "./agent-input-config-option-types.js";

export type ConfigOptionIconKind = "reasoning" | "fast" | "default";
export type ConfigOptionIconWeight = "fill" | "bold";

export interface ConfigOptionViewState {
	currentValue: string | null;
	isBooleanConfigOption: boolean;
	isBooleanEnabled: boolean;
	iconKind: ConfigOptionIconKind;
	currentValueLabel: string;
	reasoningBarSegmentCount: number;
	reasoningBarFilledSegmentCount: number;
	reasoningBarPercent: number;
	iconColor: string;
	iconWeight: ConfigOptionIconWeight;
	iconClass: string;
	iconStyle: string;
	buttonTitle: string;
	tooltipTitle: string;
	tooltipCurrentValueLabel: string | null;
	tooltipDescription: string;
}

const REASONING_EFFORT_TOOLTIP =
	"Click to step up reasoning depth. Higher levels spend more time planning and checking — better for complex work, but slower. Lower levels answer faster with less depth.";

const FAST_MODE_TOOLTIP =
	"Uses Codex's fast service tier when available. Turn on for lower latency on quick iterations; leave off for default throughput on harder tasks.";

function getReasoningEffortRank(value: string): number {
	const normalized = value.toLowerCase();
	if (normalized === "minimal") return 1;
	if (normalized === "low") return 2;
	if (normalized === "medium") return 3;
	if (normalized === "high") return 4;
	if (normalized === "xhigh") return 5;
	return 0;
}

export function getReasoningEffortBarSegments(input: {
	configOption: AgentInputConfigOption;
	currentValue: string | null;
}): { segmentCount: number; filledSegmentCount: number } {
	const options = input.configOption.options ?? [];
	const rankedOptions = options
		.map((option) => ({
			value: String(option.value),
			rank: getReasoningEffortRank(String(option.value)),
		}))
		.filter((option) => option.rank > 0)
		.sort((left, right) => left.rank - right.rank);
	const segmentCount = rankedOptions.length;
	if (segmentCount === 0) {
		return { segmentCount: 0, filledSegmentCount: 0 };
	}

	if (input.currentValue == null) {
		return { segmentCount, filledSegmentCount: 0 };
	}

	const currentRank = getReasoningEffortRank(input.currentValue);
	if (currentRank <= 0) {
		return { segmentCount, filledSegmentCount: 0 };
	}

	const filledSegmentCount = rankedOptions.filter((option) => option.rank <= currentRank).length;
	return { segmentCount, filledSegmentCount };
}

export function getReasoningEffortBarPercent(input: {
	configOption: AgentInputConfigOption;
	currentValue: string | null;
}): number {
	const { segmentCount, filledSegmentCount } = getReasoningEffortBarSegments(input);
	if (segmentCount === 0 || filledSegmentCount <= 0) {
		return 0;
	}

	return (filledSegmentCount / segmentCount) * 100;
}

export function getReasoningEffortRankedValues(
	configOption: AgentInputConfigOption
): readonly string[] {
	const options = configOption.options ?? [];
	return options
		.map((option) => ({
			value: String(option.value),
			rank: getReasoningEffortRank(String(option.value)),
		}))
		.filter((option) => option.rank > 0)
		.sort((left, right) => left.rank - right.rank)
		.map((option) => option.value);
}

export function getReasoningEffortNextValue(input: {
	configOption: AgentInputConfigOption;
	currentValue: string | null;
}): string | null {
	const rankedValues = getReasoningEffortRankedValues(input.configOption);
	if (rankedValues.length === 0) {
		return null;
	}

	const currentIndex =
		input.currentValue != null ? rankedValues.indexOf(input.currentValue) : -1;
	if (currentIndex < 0 || currentIndex >= rankedValues.length - 1) {
		return rankedValues[0] ?? null;
	}

	return rankedValues[currentIndex + 1] ?? rankedValues[0] ?? null;
}

export function getConfigOptionTooltipBody(configOption: AgentInputConfigOption): string {
	const providerDescription = configOption.description?.trim();
	if (providerDescription && providerDescription.length > 0) {
		return providerDescription;
	}

	if (isReasoningConfigOption(configOption)) {
		return REASONING_EFFORT_TOOLTIP;
	}

	if (isFastConfigOption(configOption)) {
		return FAST_MODE_TOOLTIP;
	}

	return "";
}

export function getConfigOptionTooltipDescription(input: {
	configOption: AgentInputConfigOption;
	currentValueLabel: string;
}): string {
	return getConfigOptionTooltipBody(input.configOption);
}

export function getConfigOptionTooltipCurrentValueLabel(input: {
	configOption: AgentInputConfigOption;
	currentValueLabel: string;
}): string | null {
	if (!isReasoningConfigOption(input.configOption)) {
		return null;
	}

	if (input.currentValueLabel.length === 0) {
		return null;
	}

	return input.currentValueLabel;
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
	return "bold";
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

export function getConfigOptionFastTriggerClass(input: {
	disabled: boolean;
	isEnabled: boolean;
}): string {
	void input.isEnabled;
	if (input.disabled) {
		return "opacity-50";
	}
	return "";
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
	const useMuted = iconKind === "fast" && iconWeight === "bold";
	const tooltipTitle = configOption.name;
	const tooltipDescription = getConfigOptionTooltipDescription({
		configOption,
		currentValueLabel,
	});
	const tooltipCurrentValueLabel = getConfigOptionTooltipCurrentValueLabel({
		configOption,
		currentValueLabel,
	});
	const reasoningBarSegments = isReasoningConfigOption(configOption)
		? getReasoningEffortBarSegments({ configOption, currentValue })
		: { segmentCount: 0, filledSegmentCount: 0 };
	const reasoningBarSegmentCount = reasoningBarSegments.segmentCount;
	const reasoningBarFilledSegmentCount = reasoningBarSegments.filledSegmentCount;
	const reasoningBarPercent = isReasoningConfigOption(configOption)
		? getReasoningEffortBarPercent({ configOption, currentValue })
		: 0;

	return {
		currentValue,
		isBooleanConfigOption: isBooleanOption,
		isBooleanEnabled,
		iconKind,
		currentValueLabel,
		reasoningBarSegmentCount,
		reasoningBarFilledSegmentCount,
		reasoningBarPercent,
		iconColor,
		iconWeight,
		iconClass: useMuted ? "text-muted-foreground" : "",
		iconStyle: useMuted ? "" : `color: ${iconColor}`,
		buttonTitle: `${configOption.name}: ${currentValueLabel}`,
		tooltipTitle,
		tooltipCurrentValueLabel,
		tooltipDescription,
	};
}
