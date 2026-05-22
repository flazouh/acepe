import { describe, expect, it } from "vitest";

import type { ConfigOptionData } from "../../services/converted-session-types.js";
import {
	buildConfigOptionSelectorState,
	getConfigOptionKind,
	getNextBooleanConfigOptionValue,
	isBooleanConfigOption,
} from "./config-option-selector-state.js";

function createConfigOption(overrides: Partial<ConfigOptionData> = {}): ConfigOptionData {
	return {
		id: "service_tier",
		name: "Fast Mode",
		category: "service_tier",
		type: "select",
		currentValue: "standard",
		options: [
			{ name: "Standard", value: "standard" },
			{ name: "Fast", value: "fast" },
		],
		...overrides,
	};
}

describe("config option selector state", () => {
	it("detects boolean options from type, boolean values, and boolean-like strings", () => {
		expect(isBooleanConfigOption(createConfigOption({ type: "boolean" }))).toBe(true);
		expect(isBooleanConfigOption(createConfigOption({ currentValue: true }))).toBe(true);
		expect(isBooleanConfigOption(createConfigOption({ currentValue: "false" }))).toBe(true);
		expect(isBooleanConfigOption(createConfigOption({ currentValue: "standard" }))).toBe(false);
	});

	it("detects reasoning, fast, and general option kinds", () => {
		expect(
			getConfigOptionKind(
				createConfigOption({
					id: "thought_level",
					name: "Reasoning",
					category: "thought_level",
				})
			)
		).toBe("reasoning");
		expect(getConfigOptionKind(createConfigOption())).toBe("fast");
		expect(
			getConfigOptionKind(
				createConfigOption({
					id: "approval",
					name: "Approval",
					category: "safety",
				})
			)
		).toBe("general");
	});

	it("builds select display state with option labels", () => {
		expect(buildConfigOptionSelectorState(createConfigOption())).toEqual({
			currentValue: "standard",
			isBoolean: false,
			isBooleanEnabled: false,
			kind: "fast",
			currentValueLabel: "Standard",
		});
	});

	it("builds boolean display state", () => {
		expect(
			buildConfigOptionSelectorState(
				createConfigOption({
					id: "autonomous",
					name: "Autonomous",
					category: "general",
					type: "boolean",
					currentValue: "enabled",
					options: undefined,
				})
			)
		).toEqual({
			currentValue: "enabled",
			isBoolean: true,
			isBooleanEnabled: true,
			kind: "general",
			currentValueLabel: "On",
		});
	});

	it("falls back to the current value or option name for labels", () => {
		expect(
			buildConfigOptionSelectorState(
				createConfigOption({
					currentValue: "custom",
					options: undefined,
				})
			).currentValueLabel
		).toBe("custom");
		expect(
			buildConfigOptionSelectorState(
				createConfigOption({
					currentValue: null,
					options: undefined,
				})
			).currentValueLabel
		).toBe("Fast Mode");
	});

	it("returns the next boolean value for toggles", () => {
		expect(getNextBooleanConfigOptionValue(true)).toBe("false");
		expect(getNextBooleanConfigOptionValue(false)).toBe("true");
	});
});
