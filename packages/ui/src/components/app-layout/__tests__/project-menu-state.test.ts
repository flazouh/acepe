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
				projectIconSrc: null,
				hasColorChange: true,
				hasResetProjectIconAction: false,
				hasRemoveProjectAction: true,
			})
		).toEqual({
			selectedColorHex: "#0000ff",
			hasIcon: false,
			hasResetProjectIcon: false,
			showColorPicker: true,
			showSettingsSection: true,
			displaySectionClass: "px-2 py-1.5 border-b border-border/20",
			colorTriggerClass: "rounded-none px-2 py-1.5 text-[11px] border-b border-border/20",
		});
	});

	it("hides color picker when a custom icon is present and can show reset action", () => {
		expect(
			buildProjectHeaderOverflowMenuState({
				currentColor: "red",
				colorOptions,
				projectIconSrc: "icon.png",
				hasColorChange: true,
				hasResetProjectIconAction: true,
				hasRemoveProjectAction: false,
			})
		).toMatchObject({
			hasIcon: true,
			hasResetProjectIcon: true,
			showColorPicker: false,
			showSettingsSection: true,
		});
	});

	it("hides settings section when no actions are available", () => {
		expect(
			buildProjectHeaderOverflowMenuState({
				currentColor: undefined,
				colorOptions,
				projectIconSrc: null,
				hasColorChange: false,
				hasResetProjectIconAction: false,
				hasRemoveProjectAction: false,
			})
		).toMatchObject({
			showSettingsSection: false,
			displaySectionClass: "px-2 py-1.5",
			colorTriggerClass: "rounded-none px-2 py-1.5 text-[11px]",
		});
	});
});
