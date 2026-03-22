import { describe, expect, it } from "bun:test";
import type { Extension } from "@codemirror/state";

type CursorThemeModule = typeof import("./cursor-theme.js") & {
	cursorLight?: Extension;
	getCursorThemeExtension?: (theme: "dark" | "light") => Extension;
};

describe("cursor-theme", () => {
	it("exports a light theme extension", async () => {
		const module = (await import("./cursor-theme.js")) as CursorThemeModule;

		expect(module.cursorLight).toBeDefined();
	});

	it("returns dark and light extensions from getCursorThemeExtension", async () => {
		const module = (await import("./cursor-theme.js")) as CursorThemeModule;

		expect(module.getCursorThemeExtension).toBeDefined();

		if (module.getCursorThemeExtension && module.cursorLight) {
			expect(module.getCursorThemeExtension("dark")).toBe(module.cursorDark);
			expect(module.getCursorThemeExtension("light")).toBe(module.cursorLight);
		}
	});
});
