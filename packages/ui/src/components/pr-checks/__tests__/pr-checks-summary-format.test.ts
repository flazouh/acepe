import { describe, expect, it } from "vitest";

import {
	buildPrChecksSummarySegments,
	formatPrChecksSummaryAriaLabel,
} from "../pr-checks-summary-format.js";

describe("buildPrChecksSummarySegments", () => {
	it("labels a homogeneous failure set without repeating the total", () => {
		const segments = buildPrChecksSummarySegments({
			failure: 7,
			inProgress: 0,
			neutral: 0,
			success: 0,
		});

		expect(segments).toEqual([{ kind: "failure", count: 7, label: "7 failed" }]);
	});

	it("labels mixed outcomes separately", () => {
		const segments = buildPrChecksSummarySegments({
			failure: 2,
			inProgress: 0,
			neutral: 0,
			success: 5,
		});

		expect(segments).toEqual([
			{ kind: "failure", count: 2, label: "2 failed" },
			{ kind: "success", count: 5, label: "5 passed" },
		]);
	});
});

describe("formatPrChecksSummaryAriaLabel", () => {
	it("reads naturally when every check failed", () => {
		expect(
			formatPrChecksSummaryAriaLabel(
				{ failure: 7, inProgress: 0, neutral: 0, success: 0 },
				7
			)
		).toBe("7 checks failed");
	});

	it("uses an of-total phrase for mixed failures", () => {
		expect(
			formatPrChecksSummaryAriaLabel(
				{ failure: 2, inProgress: 0, neutral: 0, success: 5 },
				7
			)
		).toBe("2 of 7 failed, 5 passed");
	});
});
