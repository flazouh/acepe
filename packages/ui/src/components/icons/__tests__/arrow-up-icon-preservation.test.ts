import { describe, expect, it } from "vitest";

import { roundedIconData } from "../rounded-icon-data.generated.js";
import { mapRoundedIconToLinear } from "../rounded-to-linear-map.js";
import { resolveRoundedIconGlyph } from "../resolve-rounded-icon-glyph.js";

describe("arrow-up icon preservation", () => {
	it("keeps the Acepe up arrow instead of the broken Linear glyph", () => {
		expect(mapRoundedIconToLinear("arrow-up")).toBeNull();

		const glyph = resolveRoundedIconGlyph("arrow-up");
		expect(glyph.inner).toBe(roundedIconData["arrow-up"].inner);
		expect(glyph.inner).toContain("9.52998 2.86263");
	});
});
