import { describe, expect, it } from "bun:test";

import { resolveTerminalTheme } from "../terminal-theme.js";

describe("resolveTerminalTheme", () => {
	it("uses app palette CSS variables for core panel colors", () => {
		const cssValues = new Map<string, string>([
			["--background", "#121212"],
			["--card", "#1b1a18"],
			["--foreground", "#f8f5ee"],
			["--card-foreground", "#f8f5ee"],
			["--muted", "#1b1a18"],
			["--accent", "#2c2b29"],
			["--accent-foreground", "#f8f5ee"],
			["--muted-foreground", "#a5a39d"],
			["--border", "#292928"],
		]);

		const theme = resolveTerminalTheme("dark", (name) => cssValues.get(name) ?? null);

		expect(theme.background).toBe("#1b1a18");
		expect(theme.foreground).toBe("#f8f5ee");
		expect(theme.cursor).toBe("#f8f5ee");
		expect(theme.cursorAccent).toBe("#1b1a18");
		expect(theme.selectionBackground).toBe("#2c2b29");
		expect(theme.selectionForeground).toBe("#f8f5ee");
		expect(theme.black).toBe("#292928");
		expect(theme.white).toBe("#a5a39d");
		expect(theme.brightBlack).toBe("#a5a39d");
		expect(theme.brightWhite).toBe("#f8f5ee");
	});

	it("falls back to mode defaults when css variables are missing", () => {
		const theme = resolveTerminalTheme("light", () => null);

		expect(theme.background).toBe("#ffffff");
		expect(theme.foreground).toBe("#0a0907");
		expect(theme.selectionBackground).toBe("#f0eeeb");
		expect(theme.black).toBe("#dfdeda");
		expect(theme.brightWhite).toBe("#0a0907");
	});
});
