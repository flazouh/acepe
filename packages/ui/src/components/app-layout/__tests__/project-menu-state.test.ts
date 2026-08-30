import { describe, expect, it } from "bun:test";

import {
	buildProjectHeaderOverflowMenuState,
	getSelectedProjectColorHex,
} from "../project-menu-state.js";

const colorOptions = [
	{ name: "red", hex: "#ff0000", label: "Red" },
	{ name: "blue", hex: "#0000ff", label: "Blue" },
] as const;

describe("project menu state", () => {
	it("selects a project color by name, hex, or fallback", () => {
		expect(getSelectedProjectColorHex({ currentColor: "blue", colorOptions })).toBe("#0000ff");
		expect(getSelectedProjectColorHex({ currentColor: "#ff0000", colorOptions })).toBe("#ff0000");
		expect(getSelectedProjectColorHex({ currentColor: undefined, colorOptions })).toBe("#ff0000");
	});

	it("builds overflow menu state for project color settings", () => {
		expect(
			buildProjectHeaderOverflowMenuState({
				currentColor: "blue",
				colorOptions,
				hasColorChange: true,
			})
		).toEqual({
			selectedColorHex: "#0000ff",
			showColorPicker: true,
		});
	});

	// An icon used to hide the color picker. No project can have one now, so
	// only the color action itself decides.
	it("hides the color picker only when there is no color action", () => {
		expect(
			buildProjectHeaderOverflowMenuState({
				currentColor: undefined,
				colorOptions,
				hasColorChange: false,
			})
		).toMatchObject({
			showColorPicker: false,
		});
	});
});
