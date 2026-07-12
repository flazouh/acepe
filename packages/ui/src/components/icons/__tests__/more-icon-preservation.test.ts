import { describe, expect, it } from "vitest";

import { roundedIconData } from "../rounded-icon-data.generated.js";
import { mapRoundedIconToLinear } from "../rounded-to-linear-map.js";
import { resolveRoundedIconGlyph } from "../resolve-rounded-icon-glyph.js";

describe("more icon migration", () => {
	it("keeps Acepe more geometry until the control is retraced", () => {
		expect(mapRoundedIconToLinear("more")).toBeNull();

		const glyph = resolveRoundedIconGlyph("more");
		expect(glyph.inner).toBe(roundedIconData.more.inner);
	});

	it("keeps the three alias on the Acepe more geometry", () => {
		const glyph = resolveRoundedIconGlyph("three");
		expect(glyph.inner).toBe(roundedIconData.more.inner);
	});
});
