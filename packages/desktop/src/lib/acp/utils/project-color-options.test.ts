import { describe, expect, it } from "bun:test";

import { COLOR_NAMES, Colors, TAG_COLORS } from "./colors.js";
import { PROJECT_COLOR_OPTIONS } from "./project-color-options.js";

describe("project color options", () => {
	it("exposes the expanded project palette in shared tag order", () => {
		expect(PROJECT_COLOR_OPTIONS.map((option) => option.name)).toEqual([
			COLOR_NAMES.RED,
			COLOR_NAMES.ORANGE,
			COLOR_NAMES.AMBER,
			COLOR_NAMES.YELLOW,
			COLOR_NAMES.LIME,
			COLOR_NAMES.GREEN,
			COLOR_NAMES.TEAL,
			COLOR_NAMES.CYAN,
			COLOR_NAMES.BLUE,
			COLOR_NAMES.INDIGO,
			COLOR_NAMES.PURPLE,
			COLOR_NAMES.PINK,
		]);

		expect(PROJECT_COLOR_OPTIONS.map((option) => option.hex)).toEqual(TAG_COLORS);
		expect(PROJECT_COLOR_OPTIONS.map((option) => option.hex)).toEqual([
			Colors[COLOR_NAMES.RED],
			Colors[COLOR_NAMES.ORANGE],
			Colors[COLOR_NAMES.AMBER],
			Colors[COLOR_NAMES.YELLOW],
			Colors[COLOR_NAMES.LIME],
			Colors[COLOR_NAMES.GREEN],
			Colors[COLOR_NAMES.TEAL],
			Colors[COLOR_NAMES.CYAN],
			Colors[COLOR_NAMES.BLUE],
			Colors[COLOR_NAMES.INDIGO],
			Colors[COLOR_NAMES.PURPLE],
			Colors[COLOR_NAMES.PINK],
		]);
	});
});
