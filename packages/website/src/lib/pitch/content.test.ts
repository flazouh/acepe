import { describe, expect, it } from "vitest";

import { pitchSections } from "./content.js";

function countWords(value: string): number {
	return value
		.trim()
		.split(/\s+/)
		.filter((token) => token.length > 0).length;
}

describe("pitch content", () => {
	it("uses the investor-first section order", () => {
		expect(pitchSections.map((section) => section.id)).toEqual([
			"title",
			"problem",
			"before-after",
			"solution",
			"traction",
			"product",
			"market-why-now",
			"competition",
			"business-model",
			"ask",
		]);
	});

	it("keeps slide copy lean", () => {
		for (const section of pitchSections) {
			expect(section.body.length).toBeLessThanOrEqual(2);
			const totalWords =
				countWords(section.headline) +
				countWords(section.summary) +
				section.body.reduce((sum, bullet) => sum + countWords(bullet), 0);

			expect(totalWords).toBeLessThanOrEqual(35);
		}
	});
});
