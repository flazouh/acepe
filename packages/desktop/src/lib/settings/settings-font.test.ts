import { describe, expect, it } from "bun:test";

import {
	applyFontSizeToRoot,
	CODE_FONT_SIZE,
	codeFontSizeFromSettings,
	CODE_FONT_SIZE_VAR,
	nextFontSize,
	parseSettingPx,
	UI_FONT_SIZE,
	uiFontSizeFromSettings,
} from "./settings-font.ts";

describe("parseSettingPx", () => {
	it("uses the shipping default when the setting is missing", () => {
		expect(parseSettingPx(undefined, UI_FONT_SIZE)).toBe(16);
		expect(parseSettingPx(undefined, CODE_FONT_SIZE)).toBe(13);
	});

	it("clamps to the shipping appearance bounds", () => {
		expect(parseSettingPx("11", UI_FONT_SIZE)).toBe(12);
		expect(parseSettingPx("21", UI_FONT_SIZE)).toBe(20);
		expect(parseSettingPx("9", CODE_FONT_SIZE)).toBe(10);
		expect(parseSettingPx("19", CODE_FONT_SIZE)).toBe(18);
	});
});

describe("font size from projected settings", () => {
	it("reads ui_font_size and code_font_size rows", () => {
		expect(
			uiFontSizeFromSettings([
				{ key: "ui_font_size", value: "18", sequence: 2 },
				{ key: "code_font_size", value: "15", sequence: 3 },
			]),
		).toBe(18);
		expect(
			codeFontSizeFromSettings([
				{ key: "ui_font_size", value: "18", sequence: 2 },
				{ key: "code_font_size", value: "15", sequence: 3 },
			]),
		).toBe(15);
	});
});

describe("nextFontSize", () => {
	it("steps by one and stops at the bounds", () => {
		expect(nextFontSize(16, 1, UI_FONT_SIZE)).toBe(17);
		expect(nextFontSize(20, 1, UI_FONT_SIZE)).toBe(20);
		expect(nextFontSize(12, -1, UI_FONT_SIZE)).toBe(12);
	});
});

describe("applyFontSizeToRoot", () => {
	it("sets the root font-size and the code CSS variable in px", () => {
		const properties: Record<string, string> = {};
		const root = {
			style: {
				fontSize: "",
				setProperty: (name: string, value: string) => {
					properties[name] = value;
				},
			},
		};
		applyFontSizeToRoot({
			root,
			uiFontSize: 18,
			codeFontSize: 15,
		});
		expect(root.style.fontSize).toBe("18px");
		expect(properties[CODE_FONT_SIZE_VAR]).toBe("15px");
	});
});
