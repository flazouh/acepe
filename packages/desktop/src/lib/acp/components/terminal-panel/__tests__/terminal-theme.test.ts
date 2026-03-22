import { describe, expect, it } from "bun:test";

import { resolveTerminalTheme } from "../terminal-theme.js";

describe("resolveTerminalTheme", () => {
	it("uses app palette CSS variables for core panel colors", () => {
		const cssValues = new Map<string, string>([
			["--background", "#101010"],
			["--card", "#121212"],
			["--foreground", "#eeeeee"],
			["--card-foreground", "#f5f5f5"],
			["--muted", "#222222"],
			["--accent", "#2a2a2a"],
			["--accent-foreground", "#fafafa"],
			["--muted-foreground", "#bbbbbb"],
			["--border", "#333333"],
		]);

		const theme = resolveTerminalTheme("dark", (name) => cssValues.get(name) ?? null);

		expect(theme.background).toBe("#121212");
		expect(theme.foreground).toBe("#f5f5f5");
		expect(theme.cursor).toBe("#f5f5f5");
		expect(theme.cursorAccent).toBe("#121212");
		expect(theme.selectionBackground).toBe("#2a2a2a");
		expect(theme.selectionForeground).toBe("#fafafa");
		expect(theme.black).toBe("#333333");
		expect(theme.white).toBe("#bbbbbb");
		expect(theme.brightBlack).toBe("#bbbbbb");
		expect(theme.brightWhite).toBe("#f5f5f5");
	});

	it("falls back to mode defaults when css variables are missing", () => {
		const theme = resolveTerminalTheme("light", () => null);

		expect(theme.background).toBe("#FAFAF8");
		expect(theme.foreground).toBe("#0A0A09");
		expect(theme.selectionBackground).toBe("#E8E3D8");
		expect(theme.black).toBe("#5C4A3D");
		expect(theme.brightWhite).toBe("#0A0A09");
	});
});
