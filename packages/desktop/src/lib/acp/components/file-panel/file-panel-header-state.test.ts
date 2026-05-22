import { describe, expect, it } from "bun:test";

import {
	getFilePanelDisplayModeItems,
	getFilePanelDisplayModeLabel,
	getFilePanelEditorModeItems,
	getFilePanelEffectiveProjectColor,
	getFilePanelFullPath,
} from "./file-panel-header-state.js";

describe("file-panel-header-state", () => {
	it("builds absolute full paths without changing absolute file paths", () => {
		expect(getFilePanelFullPath({ filePath: "/tmp/file.ts", projectPath: "/repo" })).toBe(
			"/tmp/file.ts"
		);
		expect(getFilePanelFullPath({ filePath: "src/file.ts", projectPath: "/repo" })).toBe(
			"/repo/src/file.ts"
		);
	});

	it("labels display modes for the header", () => {
		expect(getFilePanelDisplayModeLabel("raw")).toBe("Source");
		expect(getFilePanelDisplayModeLabel("rendered")).toBe("Preview");
		expect(getFilePanelDisplayModeLabel("structured")).toBe("Tree");
		expect(getFilePanelDisplayModeLabel("table")).toBe("Table");
	});

	it("builds display mode items", () => {
		expect(getFilePanelDisplayModeItems(["raw", "rendered", "table"])).toEqual([
			{ id: "raw", label: "Source" },
			{ id: "rendered", label: "Preview" },
			{ id: "table", label: "Table" },
		]);
	});

	it("builds editor mode items", () => {
		expect(getFilePanelEditorModeItems(["write", "read"])).toEqual([
			{ id: "write", label: "Write" },
			{ id: "read", label: "Read" },
		]);
	});

	it("normalizes missing project color", () => {
		expect(getFilePanelEffectiveProjectColor(undefined)).toBe("");
		expect(getFilePanelEffectiveProjectColor("#fff")).toBe("#fff");
	});
});
