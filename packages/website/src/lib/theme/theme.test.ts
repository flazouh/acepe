import { describe, expect, it } from "vitest";

import { getInitialTheme, getToggledTheme } from "./theme";

describe("theme helpers", () => {
	it("always returns dark", () => {
		expect(getInitialTheme(null)).toBe("dark");
		expect(getInitialTheme("light")).toBe("dark");
		expect(getInitialTheme("system")).toBe("dark");
	});

	it("toggle always returns dark", () => {
		expect(getToggledTheme("dark")).toBe("dark");
	});
});
