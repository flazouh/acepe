import { describe, expect, it } from "vitest";

import { roundedIconData } from "../rounded-icon-data.generated.js";
import { resolveRoundedIconGlyph } from "../resolve-rounded-icon-glyph.js";

describe("shared Linear icon wiring", () => {
	it("keeps Acepe chevron-up geometry until the shared Linear export is retraced", () => {
		const glyph = resolveRoundedIconGlyph("chevron-up");
		expect(glyph.inner).toBe(roundedIconData["chevron-up"].inner);
	});

	it("keeps Acepe archive geometry until the shared Linear export is retraced", () => {
		const glyph = resolveRoundedIconGlyph("archive");
		expect(glyph.inner).toBe(roundedIconData.archive.inner);
	});

	it("keeps Acepe play geometry for play and play-outline", () => {
		const play = resolveRoundedIconGlyph("play");
		const playOutline = resolveRoundedIconGlyph("play-outline");

		expect(play.inner).toBe(roundedIconData.play.inner);
		expect(playOutline.inner).toBe(roundedIconData["play-outline"].inner);
	});
});
