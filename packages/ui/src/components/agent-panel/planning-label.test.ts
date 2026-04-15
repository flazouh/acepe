import { describe, expect, it } from "bun:test";

import { getPlanningPlaceholderLabel } from "./planning-label.js";

describe("getPlanningPlaceholderLabel", () => {
	it("returns the static planning label when no duration is present", () => {
		expect(getPlanningPlaceholderLabel()).toBe("Planning next moves…");
	});

	it("ignores elapsed duration for multi-second planning states", () => {
		expect(getPlanningPlaceholderLabel(4_000)).toBe("Planning next moves…");
	});

	it("ignores zero and sub-second durations", () => {
		expect(getPlanningPlaceholderLabel(0)).toBe("Planning next moves…");
		expect(getPlanningPlaceholderLabel(250)).toBe("Planning next moves…");
	});
});
