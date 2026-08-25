import { PROJECT_COLORS } from "@acepe/contracts";
import { Colors, resolveProjectColor } from "@acepe/ui/colors";
import { describe, expect, it } from "vitest";

// The canonical palette lives in @acepe/contracts and the hex values live in
// @acepe/ui. Nothing forces the two lists to agree, so this seam test does.
describe("project color palette", () => {
	it("resolves every canonical color name to a hex value", () => {
		for (const color of PROJECT_COLORS) {
			expect(Object.keys(Colors)).toContain(color);
			expect(resolveProjectColor(color)).toBe(Colors[color]);
		}
	});

	it("names the same colors the theme knows about", () => {
		expect([...PROJECT_COLORS].sort()).toEqual(Object.keys(Colors).sort());
	});
});
