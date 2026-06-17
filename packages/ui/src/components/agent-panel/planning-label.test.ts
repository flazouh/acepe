import { describe, expect, it } from "bun:test";

import {
	getPlanningPlaceholderLabel,
	PLANNING_PLACEHOLDER_LABEL,
} from "./planning-label.js";

describe("getPlanningPlaceholderLabel", () => {
	it("returns the static planning label when no duration is present", () => {
		expect(getPlanningPlaceholderLabel()).toBe(PLANNING_PLACEHOLDER_LABEL);
	});

	it("ignores elapsed duration for multi-second planning states", () => {
		expect(getPlanningPlaceholderLabel(4_000)).toBe(PLANNING_PLACEHOLDER_LABEL);
	});

	it("ignores zero and sub-second durations", () => {
		expect(getPlanningPlaceholderLabel(0)).toBe(PLANNING_PLACEHOLDER_LABEL);
		expect(getPlanningPlaceholderLabel(250)).toBe(PLANNING_PLACEHOLDER_LABEL);
	});
});
