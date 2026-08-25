import { defaultProjectColor, PROJECT_COLORS } from "@acepe/contracts";
import { PROJECT_COLOR_OPTIONS } from "@acepe/ui/app-layout";
import { Colors, resolveProjectColor } from "@acepe/ui/colors";
import { describe, expect, it } from "vitest";

import { generateFallbackProjectColor } from "./project-utils.js";

// The canonical palette lives in @acepe/contracts and the hex values live in
// @acepe/ui. Nothing forces the two lists to agree, so this seam test does.
describe("project color palette", () => {
	it("resolves every canonical color name to a hex value", () => {
		for (const color of PROJECT_COLORS) {
			expect(resolveProjectColor(color)).toBe(Colors[color]);
		}
	});

	// Order, not just membership: both the projection default and the path
	// fallback index the palette by position, so a reordered list would recolor
	// every project that nobody picked a color for.
	it("lists the same colors in the same order as the picker", () => {
		expect([...PROJECT_COLORS]).toEqual(PROJECT_COLOR_OPTIONS.map((option) => option.name));
	});

	it("agrees with the path fallback the session surfaces still use", () => {
		const roots = ["/repo/acepe", "/worktrees/acepe", "/tmp/a", "/Users/alex/Documents/acepe"];
		for (const root of roots) {
			expect(resolveProjectColor(defaultProjectColor(root))).toBe(
				generateFallbackProjectColor(root)
			);
		}
	});
});
