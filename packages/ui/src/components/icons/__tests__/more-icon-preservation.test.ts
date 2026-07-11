import { describe, expect, it } from "vitest";

import { roundedIconData } from "../rounded-icon-data.generated.js";
import { mapRoundedIconToLinear } from "../rounded-to-linear-map.js";
import { resolveRoundedIconGlyph } from "../resolve-rounded-icon-glyph.js";

describe("more icon preservation", () => {
	it("keeps the vertical ellipsis on the Acepe rounded SVG", () => {
		expect(mapRoundedIconToLinear("more")).toBeNull();

		const glyph = resolveRoundedIconGlyph("more");
		expect(glyph.inner).toBe(roundedIconData.more.inner);
	});

	it("keeps the three alias on the same Acepe more glyph", () => {
		const glyph = resolveRoundedIconGlyph("three");
		expect(glyph.inner).toBe(roundedIconData.more.inner);
	});
});
