import { describe, expect, it } from "vitest";

import { linearIconData } from "../linear-icon-catalog.js";
import { roundedIconData } from "../rounded-icon-data.generated.js";
import { mapRoundedIconToLinear } from "../rounded-to-linear-map.js";
import { resolveRoundedIconGlyph } from "../resolve-rounded-icon-glyph.js";

describe("resolve-rounded-icon-glyph", () => {
	it("renders Linear inventory glyphs for mapped rounded icon names", () => {
		const glyph = resolveRoundedIconGlyph("close");

		expect(glyph.viewBox).toBe(linearIconData.close.viewBox);
		expect(glyph.inner).toBe(linearIconData.close.inner);
	});

	it("renders the Linear copy icon for copy actions", () => {
		const glyph = resolveRoundedIconGlyph("copy");

		expect(glyph.viewBox).toBe(linearIconData.copy.viewBox);
		expect(glyph.inner).toBe(linearIconData.copy.inner);
	});

	it("renders alias-specific Linear glyphs", () => {
		const glyph = resolveRoundedIconGlyph("bell");

		expect(glyph.viewBox).toBe(roundedIconData.automations.viewBox);
		expect(glyph.inner).toBe(roundedIconData.automations.inner);
	});

	it("keeps Acepe geometry for unobserved decorative-only candidates", () => {
		const glyph = resolveRoundedIconGlyph("info");

		expect(glyph.viewBox).toBe(roundedIconData.info.viewBox);
		expect(glyph.inner).toBe(roundedIconData.info.inner);
	});

	it("maps pull request states to Linear status variants", () => {
		const merged = resolveRoundedIconGlyph("pull-request-merged");
		const expectedLinear = mapRoundedIconToLinear("pull-request-merged");

		expect(expectedLinear).not.toBeNull();
		if (expectedLinear) {
			expect(merged.viewBox).toBe(linearIconData[expectedLinear].viewBox);
			expect(merged.inner).toBe(linearIconData[expectedLinear].inner);
		}
	});
});
