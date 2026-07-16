import { describe, expect, it } from "vitest";

import {
	getInitialTheme,
	getInitialThemePreference,
	getToggledTheme,
	resolveEffectiveTheme,
} from "./theme";

describe("theme helpers", () => {
	it("defaults preference to system when no stored preference exists", () => {
		expect(getInitialThemePreference(null)).toBe("system");
	});

	it("uses a valid stored preference", () => {
		expect(getInitialThemePreference("light")).toBe("light");
		expect(getInitialThemePreference("dark")).toBe("dark");
		expect(getInitialThemePreference("system")).toBe("system");
	});

	it("falls back to system for an invalid stored preference", () => {
		expect(getInitialThemePreference("sepia")).toBe("system");
	});

	it("resolves system preference from the media query", () => {
		expect(resolveEffectiveTheme("system", { matches: true })).toBe("dark");
		expect(resolveEffectiveTheme("system", { matches: false })).toBe("light");
	});

	it("resolves explicit preferences without the media query", () => {
		expect(resolveEffectiveTheme("light", { matches: true })).toBe("light");
		expect(resolveEffectiveTheme("dark", { matches: false })).toBe("dark");
	});

	it("defaults unresolved system appearance to dark without a media query", () => {
		expect(getInitialTheme(null)).toBe("dark");
		expect(resolveEffectiveTheme("system", null)).toBe("dark");
	});

	it("toggles between dark and light", () => {
		expect(getToggledTheme("dark")).toBe("light");
		expect(getToggledTheme("light")).toBe("dark");
	});
});
