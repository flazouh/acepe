import { describe, expect, test } from "bun:test";
import {
	getConfigOptionCurrentValue,
	getConfigOptionCurrentValueLabel,
	getConfigOptionIconKind,
	getConfigOptionIconWeight,
	getConfigOptionNextBooleanValue,
	getConfigOptionViewState,
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
		).toBe("regular");
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
