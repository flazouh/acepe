import { describe, expect, it } from "vitest";

import { roundedIconData } from "../rounded-icon-data.generated.js";
import { resolveRoundedIconGlyph } from "../resolve-rounded-icon-glyph.js";

describe("unconfirmed Linear icon preservation", () => {
	it("keeps Acepe chevron-up geometry", () => {
		const glyph = resolveRoundedIconGlyph("chevron-up");
		expect(glyph.inner).toBe(roundedIconData["chevron-up"].inner);
	});

	it("keeps Acepe archive geometry", () => {
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
