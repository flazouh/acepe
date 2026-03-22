import { describe, expect, it } from "bun:test";

import { getRawEditorConfig, type RawEditorMode } from "./file-panel-raw-editor-mode";

describe("file-panel raw editor mode", () => {
	it("uses readonly editor for read mode", () => {
		expect(getRawEditorConfig("read")).toEqual({
			useCodeMirror: true,
			readonly: true,
		});
	});

	it("uses writable editor for write mode", () => {
		expect(getRawEditorConfig("write")).toEqual({
			useCodeMirror: true,
			readonly: false,
		});
	});

	it("supports all editor modes explicitly", () => {
		const modes: RawEditorMode[] = ["read", "write"];
		expect(modes.map((mode) => getRawEditorConfig(mode).readonly)).toEqual([true, false]);
	});
});
