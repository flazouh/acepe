import { describe, expect, it } from "vitest";

import { roundedIconData } from "../rounded-icon-data.generated.js";
import { mapRoundedIconToLinear } from "../rounded-to-linear-map.js";
import { resolveRoundedIconGlyph } from "../resolve-rounded-icon-glyph.js";

describe("arrow-up icon migration", () => {
	it("keeps Acepe arrow-up geometry until submit is mapped by control", () => {
		expect(mapRoundedIconToLinear("arrow-up")).toBeNull();

		const glyph = resolveRoundedIconGlyph("arrow-up");
		expect(glyph.inner).toBe(roundedIconData["arrow-up"].inner);
	});
});
