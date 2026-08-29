import { describe, expect, test } from "vitest";

import {
	DEFAULT_UI_THEME,
	isUiThemeId,
	resolveUiThemeId,
	uiThemeFamilies,
} from "./themes.js";

/**
 * That each family has a stylesheet behind it is checked by
 * scripts/check-theme-families.ts, because happy-dom does not resolve custom
 * properties from stylesheets and this package forbids reading source in tests.
 */
describe("ui theme families", () => {
	test("ids are unique, so a picker cannot show the same family twice", () => {
		const ids = uiThemeFamilies.map((family) => family.id);

		expect(new Set(ids).size).toBe(ids.length);
	});

	test("the default is a real family", () => {
		expect(isUiThemeId(DEFAULT_UI_THEME)).toBe(true);
	});

	test("an unknown id falls back to the default instead of leaving the app unstyled", () => {
		expect(resolveUiThemeId("nope")).toBe(DEFAULT_UI_THEME);
		expect(resolveUiThemeId(null)).toBe(DEFAULT_UI_THEME);
		expect(resolveUiThemeId(undefined)).toBe(DEFAULT_UI_THEME);
		expect(isUiThemeId("nope")).toBe(false);
	});
});
