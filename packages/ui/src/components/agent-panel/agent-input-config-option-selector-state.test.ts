import { describe, expect, test } from "bun:test";
import { Colors } from "../../lib/colors.js";
import {
	getConfigOptionCurrentValue,
	getConfigOptionCurrentValueLabel,
	getConfigOptionIconKind,
	getConfigOptionIconWeight,
	getConfigOptionNextBooleanValue,
	getConfigOptionResolvedTriggerSize,
	getConfigOptionTooltipBody,
	getConfigOptionTooltipCurrentValueLabel,
	getConfigOptionTooltipDescription,
	getConfigOptionViewState,
	getReasoningEffortBarPercent,
	getReasoningEffortBarSegments,
	getReasoningEffortIconColor,
	getReasoningEffortNextValue,
	getReasoningVariantIconColor,
	isBooleanConfigOption,
	isConfigOptionBooleanEnabled,
	shouldEmitConfigOptionValueChange,
} from "./agent-input-config-option-selector-state.js";
import type { AgentInputConfigOption } from "./agent-input-config-option-types.js";

function makeOption(
	overrides: Partial<AgentInputConfigOption> = {}
): AgentInputConfigOption {
	return {
		id: "fast-mode",
		name: "Fast mode",
		category: "runtime",
		type: "string",
		currentValue: "false",
		presentation: "compactSpeed",
		...overrides,
	};
}

describe("agent input config option selector state", () => {
	test("detects boolean config options from type, boolean value, or string value", () => {
		expect(isBooleanConfigOption(makeOption({ type: "boolean" }))).toBe(true);
		expect(isBooleanConfigOption(makeOption({ currentValue: true }))).toBe(true);
		expect(isBooleanConfigOption(makeOption({ currentValue: "false" }))).toBe(true);
		expect(isBooleanConfigOption(makeOption({ currentValue: "medium" }))).toBe(false);
	});

	test("normalizes current value and boolean enabled state", () => {
		expect(getConfigOptionCurrentValue(makeOption({ currentValue: true }))).toBe("true");
		expect(getConfigOptionCurrentValue(makeOption({ currentValue: null }))).toBeNull();
		expect(isConfigOptionBooleanEnabled("true", true)).toBe(true);
		expect(isConfigOptionBooleanEnabled("on", true)).toBe(true);
		expect(isConfigOptionBooleanEnabled("enabled", true)).toBe(true);
		expect(isConfigOptionBooleanEnabled("false", true)).toBe(false);
		expect(isConfigOptionBooleanEnabled("true", false)).toBe(false);
	});

	test("builds current value label from options, booleans, current value, or name", () => {
		const option = makeOption({
			currentValue: "high",
			options: [{ value: "high", name: "High" }],
		});

		expect(
			getConfigOptionCurrentValueLabel({
				configOption: option,
				currentValue: "high",
				isBooleanConfigOption: false,
				isBooleanEnabled: false,
			})
		).toBe("High");
		expect(
			getConfigOptionCurrentValueLabel({
				configOption: makeOption({ options: undefined }),
				currentValue: "custom",
				isBooleanConfigOption: false,
				isBooleanEnabled: false,
			})
		).toBe("custom");
		expect(
			getConfigOptionCurrentValueLabel({
				configOption: makeOption({ options: undefined }),
				currentValue: null,
				isBooleanConfigOption: true,
				isBooleanEnabled: true,
			})
		).toBe("On");
		expect(
			getConfigOptionCurrentValueLabel({
				configOption: makeOption({ name: "Reasoning", options: undefined }),
				currentValue: null,
				isBooleanConfigOption: false,
				isBooleanEnabled: false,
			})
		).toBe("Reasoning");
	});

	test("chooses icon kind and weight", () => {
		expect(
			getConfigOptionIconKind(makeOption({ presentation: "compactReasoning" }))
		).toBe("reasoning");
		expect(getConfigOptionIconKind(makeOption({ presentation: "compactSpeed" }))).toBe(
			"fast"
		);
		expect(getConfigOptionIconKind(makeOption({ presentation: "advanced" }))).toBe(
			"default"
		);
		expect(
			getConfigOptionIconWeight({
				iconKind: "fast",
				isBooleanConfigOption: true,
				isBooleanEnabled: false,
				currentValue: "false",
			})
		).toBe("bold");
		expect(
			getConfigOptionIconWeight({
				iconKind: "fast",
				isBooleanConfigOption: true,
				isBooleanEnabled: true,
				currentValue: "true",
			})
		).toBe("fill");
		expect(
			getConfigOptionIconWeight({
				iconKind: "reasoning",
				isBooleanConfigOption: false,
				isBooleanEnabled: false,
				currentValue: null,
			})
		).toBe("fill");
	});

	test("resolves composer trigger size for reasoning and other compact options", () => {
		expect(
			getConfigOptionResolvedTriggerSize(
				makeOption({ presentation: "compactReasoning", id: "reasoning" })
			)
		).toBe("composerChipIcon");
		expect(getConfigOptionResolvedTriggerSize(makeOption({ presentation: "compactSpeed" }))).toBe(
			"composerChipLabel"
		);
	});

	test("builds full view state", () => {
		const state = getConfigOptionViewState(
			makeOption({
				currentValue: "true",
				type: "boolean",
			})
		);

		expect(state.currentValue).toBe("true");
		expect(state.isBooleanConfigOption).toBe(true);
		expect(state.isBooleanEnabled).toBe(true);
		expect(state.iconKind).toBe("fast");
		expect(state.iconWeight).toBe("fill");
		expect(state.currentValueLabel).toBe("On");
		expect(state.buttonTitle).toBe("Fast mode: On");
		expect(state.tooltipTitle).toBe("Fast mode");
		expect(state.tooltipDescription).toContain("Uses Codex's fast service tier");
		expect(state.tooltipDescription).not.toContain("Currently:");
		expect(state.reasoningBarSegmentCount).toBe(0);
		expect(state.reasoningBarFilledSegmentCount).toBe(0);
		expect(state.reasoningBarPercent).toBe(0);
	});

	test("uses provider description when available and builds reasoning tooltip copy", () => {
		expect(
			getConfigOptionTooltipBody(
				makeOption({
					presentation: "compactReasoning",
					description: "Provider-specific reasoning help.",
				})
			)
		).toBe("Provider-specific reasoning help.");

		expect(
			getConfigOptionTooltipDescription({
				configOption: makeOption({
					presentation: "compactReasoning",
					name: "Reasoning Effort",
					currentValue: "high",
					options: [{ value: "high", name: "High" }],
				}),
				currentValueLabel: "High",
			})
		).toContain("Click to step up reasoning depth");
		expect(
			getConfigOptionTooltipCurrentValueLabel({
				configOption: makeOption({
					presentation: "compactReasoning",
					name: "Reasoning Effort",
					currentValue: "high",
					options: [{ value: "high", name: "High" }],
				}),
				currentValueLabel: "High",
			})
		).toBe("High");
		expect(
			getConfigOptionViewState(
				makeOption({
					presentation: "compactReasoning",
					name: "Reasoning Effort",
					currentValue: "high",
					options: [{ value: "high", name: "High" }],
				})
			).tooltipCurrentValueLabel
		).toBe("High");
	});

	test("maps reasoning effort to segmented bar fill", () => {
		const reasoningOption = makeOption({
			presentation: "compactReasoning",
			currentValue: "medium",
			options: [
				{ value: "xhigh", name: "Extra High" },
				{ value: "high", name: "High" },
				{ value: "medium", name: "Medium" },
				{ value: "low", name: "Low" },
				{ value: "minimal", name: "Minimal" },
			],
		});

		expect(
			getReasoningEffortBarSegments({
				configOption: reasoningOption,
				currentValue: null,
			})
		).toEqual({ segmentCount: 5, filledSegmentCount: 0 });
		expect(
			getReasoningEffortBarSegments({
				configOption: reasoningOption,
				currentValue: "minimal",
			})
		).toEqual({ segmentCount: 5, filledSegmentCount: 1 });
		expect(
			getReasoningEffortBarSegments({
				configOption: reasoningOption,
				currentValue: "medium",
			})
		).toEqual({ segmentCount: 5, filledSegmentCount: 3 });
		expect(
			getReasoningEffortBarSegments({
				configOption: reasoningOption,
				currentValue: "xhigh",
			})
		).toEqual({ segmentCount: 5, filledSegmentCount: 5 });
		expect(
			getReasoningEffortBarPercent({
				configOption: reasoningOption,
				currentValue: "medium",
			})
		).toBe(60);

		const state = getConfigOptionViewState(reasoningOption);
		expect(state.reasoningBarSegmentCount).toBe(5);
		expect(state.reasoningBarFilledSegmentCount).toBe(3);
		expect(state.reasoningBarPercent).toBe(60);
		expect(state.iconColor).toBe(
			getReasoningEffortIconColor({
				segmentCount: 5,
				filledSegmentCount: 3,
				currentValue: "medium",
			})
		);
		expect(state.iconStyle).toBe(`color: ${state.iconColor}`);
	});

	test("maps reasoning effort icon color from low green to max red", () => {
		expect(getReasoningEffortIconColor({ segmentCount: 5, filledSegmentCount: 0 })).toBe(
			"var(--muted-foreground)"
		);
		expect(getReasoningEffortIconColor({ segmentCount: 5, filledSegmentCount: 1 })).toBe(
			"var(--success)"
		);
		expect(getReasoningEffortIconColor({ segmentCount: 5, filledSegmentCount: 5 })).toBe(
			"var(--destructive)"
		);
		expect(
			getReasoningEffortIconColor({
				segmentCount: 6,
				filledSegmentCount: 6,
				currentValue: "max",
			})
		).toBe(Colors.purple);
	});

	test("maps reasoning variant icon color by selected variant index", () => {
		const variants = [
			{ id: "low", name: "Low" },
			{ id: "medium", name: "Medium" },
			{ id: "high", name: "High" },
		];

		expect(
			getReasoningVariantIconColor({
				variants,
				selectedVariantId: null,
			})
		).toBe("var(--muted-foreground)");
		expect(
			getReasoningVariantIconColor({
				variants,
				selectedVariantId: "low",
			})
		).toBe("var(--success)");
		expect(
			getReasoningVariantIconColor({
				variants,
				selectedVariantId: "high",
			})
		).toBe("var(--destructive)");
		expect(
			getReasoningVariantIconColor({
				variants: [{ id: "max", name: "Max" }],
				selectedVariantId: "max",
			})
		).toBe(Colors.purple);
	});

	test("cycles reasoning effort forward and wraps at maximum", () => {
		const reasoningOption = makeOption({
			presentation: "compactReasoning",
			currentValue: "medium",
			options: [
				{ value: "xhigh", name: "Extra High" },
				{ value: "high", name: "High" },
				{ value: "medium", name: "Medium" },
				{ value: "low", name: "Low" },
				{ value: "minimal", name: "Minimal" },
			],
		});

		expect(
			getReasoningEffortNextValue({
				configOption: reasoningOption,
				currentValue: "medium",
			})
		).toBe("high");
		expect(
			getReasoningEffortNextValue({
				configOption: reasoningOption,
				currentValue: "xhigh",
			})
		).toBe("minimal");
	});

	test("computes toggle and value-change decisions", () => {
		expect(getConfigOptionNextBooleanValue(true)).toBe("false");
		expect(getConfigOptionNextBooleanValue(false)).toBe("true");
		expect(
			shouldEmitConfigOptionValueChange({
				nextValue: "true",
				currentValue: "false",
			})
		).toBe(true);
		expect(
			shouldEmitConfigOptionValueChange({
				nextValue: "true",
				currentValue: "true",
			})
		).toBe(false);
	});
});
