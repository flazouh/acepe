import { describe, expect, it } from "vitest";

import { linearIconData } from "../linear-icon-catalog.js";
import { mapRoundedIconToLinear } from "../rounded-to-linear-map.js";
import { roundedIconData } from "../rounded-icon-data.generated.js";
import { resolveRoundedIconGlyph } from "../resolve-rounded-icon-glyph.js";

describe("resolve-rounded-icon-glyph", () => {
	it("renders Linear inventory glyphs for mapped rounded icon names", () => {
		const glyph = resolveRoundedIconGlyph("close");

		expect(glyph.viewBox).toBe(linearIconData.close.viewBox);
		expect(glyph.inner).toBe(linearIconData.close.inner);
	});

	it("keeps Acepe rounded SVG fallbacks for acepe-only icons", () => {
		const glyph = resolveRoundedIconGlyph("copy");

		expect(glyph.viewBox).toBe(roundedIconData.copy.viewBox);
		expect(glyph.inner).toBe(roundedIconData.copy.inner);
	});

	it("renders alias-specific Linear glyphs", () => {
		const glyph = resolveRoundedIconGlyph("bell");

		expect(glyph.viewBox).toBe(linearIconData.alarm.viewBox);
		expect(glyph.inner).toBe(linearIconData.alarm.inner);
	});

	it("maps pull request states to Linear status variants", () => {
		const merged = resolveRoundedIconGlyph("pull-request-merged");
		const expectedLinear = mapRoundedIconToLinear("pull-request-merged");

		expect(merged.viewBox).toBe(linearIconData[expectedLinear].viewBox);
		expect(merged.inner).toBe(linearIconData[expectedLinear].inner);
	});
});
