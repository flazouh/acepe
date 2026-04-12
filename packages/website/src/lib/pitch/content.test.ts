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
			"workflow-failures",
			"solution",
			"product",
			"market-why-now",
			"traction",
			"business-model",
			"team",
			"ask",
		]);
	});

	it("keeps section content bounded and non-empty", () => {
		for (const section of pitchSections) {
			expect(section.body.length).toBeLessThanOrEqual(2);
			expect(countWords(section.headline)).toBeGreaterThan(0);
			expect(countWords(section.summary)).toBeGreaterThan(0);
			for (const paragraph of section.body) {
				expect(countWords(paragraph)).toBeGreaterThan(0);
			}
		}
	});
});
