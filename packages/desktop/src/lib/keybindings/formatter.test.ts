import * as Result from "effect/Result";
import { describe, expect, it } from "vitest";

import { KeybindingRegistry } from "./bindings/registry.svelte.js";
import { formatKeyString, formatKeyStringToArray, parseKeyString } from "./utils/formatter.js";

describe("keybinding formatter", () => {
	it("treats space-separated keys as a single unsupported key string", () => {
		expect(parseKeyString("g c")).toEqual({ modifiers: [], key: "g c" });
		expect(formatKeyString("g c")).toBe("g c");
		expect(formatKeyStringToArray("g c")).toEqual(["g c"]);
	});

	it("formats the voice hold key as Option on Mac and Alt elsewhere", () => {
		const tokens = formatKeyStringToArray("AltRight");
		expect(tokens).toHaveLength(1);
		expect(tokens[0] === "⌥" || tokens[0] === "Alt").toBe(true);
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

		expect(Result.isFailure(result)).toBe(true);
	});
});
