import { describe, expect, it } from "bun:test";

import { resolvePaletteTabIcon } from "./palette-tabs-icon-model.js";

describe("resolvePaletteTabIcon", () => {
	it("uses Hugeicons for command palette modes", () => {
		expect(resolvePaletteTabIcon("commands")).toEqual({
			name: "terminal",
		});
		expect(resolvePaletteTabIcon("sessions")).toEqual({
			name: "chat",
		});
	});

	it("maps the files mode to the Hugeicons files icon", () => {
		expect(resolvePaletteTabIcon("files")).toEqual({
			name: "files",
		});
	});
});
