import { describe, expect, test } from "vitest";

import {
	applyUiThemeToDocument,
	DEFAULT_UI_THEME,
	UI_THEME_ATTRIBUTE,
} from "./themes.js";

describe("applying a ui theme family", () => {
	test("writes the attribute the stylesheet keys off", () => {
		const element = document.createElement("div");

		expect(applyUiThemeToDocument("cursor", element)).toBe("cursor");
		expect(element.getAttribute(UI_THEME_ATTRIBUTE)).toBe("cursor");
	});

	test("leaves the element themed even when the id is unknown", () => {
		const element = document.createElement("div");

		expect(applyUiThemeToDocument("nope", element)).toBe(DEFAULT_UI_THEME);
		expect(element.getAttribute(UI_THEME_ATTRIBUTE)).toBe(DEFAULT_UI_THEME);
	});
});
