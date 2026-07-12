import { describe, expect, it } from "vitest";

import { roundedIconData } from "../rounded-icon-data.generated.js";
import { resolveRoundedIconGlyph } from "../resolve-rounded-icon-glyph.js";

describe("resolve-rounded-icon-glyph", () => {
	it("keeps original Acepe geometry for formerly mapped rounded icon names", () => {
		const glyph = resolveRoundedIconGlyph("close");

		expect(glyph.viewBox).toBe(roundedIconData.close.viewBox);
		expect(glyph.inner).toBe(roundedIconData.close.inner);
	});

	it("keeps the original Acepe copy icon until Copy ID is retraced by control", () => {
		const glyph = resolveRoundedIconGlyph("copy");

		expect(glyph.viewBox).toBe(roundedIconData.copy.viewBox);
		expect(glyph.inner).toBe(roundedIconData.copy.inner);
	});

	it("renders alias-specific Acepe fallback glyphs", () => {
		const glyph = resolveRoundedIconGlyph("bell");

		expect(glyph.viewBox).toBe(roundedIconData.automations.viewBox);
		expect(glyph.inner).toBe(roundedIconData.automations.inner);
	});

	it("keeps Acepe geometry for unobserved candidates", () => {
		const glyph = resolveRoundedIconGlyph("info");

		expect(glyph.viewBox).toBe(roundedIconData.info.viewBox);
		expect(glyph.inner).toBe(roundedIconData.info.inner);
	});

	it("keeps pull request states on Acepe geometry until Linear status variants are retraced", () => {
		const merged = resolveRoundedIconGlyph("pull-request-merged");

		expect(merged.viewBox).toBe(roundedIconData["pull-request-merged"].viewBox);
		expect(merged.inner).toBe(roundedIconData["pull-request-merged"].inner);
	});
});
