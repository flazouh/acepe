import { describe, expect, it } from "vitest";

import { KeybindingRegistry } from "./bindings/registry.svelte.js";
import { formatKeyString, formatKeyStringToArray, parseKeyString } from "./utils/formatter.js";

describe("keybinding formatter", () => {
	it("treats space-separated keys as a single unsupported key string", () => {
		expect(parseKeyString("g c")).toEqual({ modifiers: [], key: "g c" });
		expect(formatKeyString("g c")).toBe("g c");
		expect(formatKeyStringToArray("g c")).toEqual(["g c"]);
	});

	it("formats physical punctuation key codes using their visible glyphs", () => {
		expect(formatKeyStringToArray("$mod+Period").at(-1)).toBe(".");
		expect(formatKeyString("$mod+Period").endsWith(".")).toBe(true);
	});
});

describe("keybinding registry", () => {
	it("rejects legacy sequence-style keybindings", () => {
		const registry = new KeybindingRegistry();

		const result = registry.register({
			key: "g c",
			command: "test.command",
			source: "user",
		});

		expect(result.isErr()).toBe(true);
	});
});
