import { describe, expect, it } from "bun:test";
import {
	FILE_PANEL_EDITOR_MODES,
	getDisplayOptionsKey,
	getFileNameFromPath,
	getFilePanelWidthStyle,
	shouldResetFilePanelDisplayMode,
	shouldShowRawEditorModeControls,
} from "./file-panel-state.js";
import type { FilePanelDisplayOptions } from "./format/types.js";

describe("file panel state", () => {
	it("extracts the file name from a path", () => {
		expect(getFileNameFromPath("/repo/src/app.ts")).toBe("app.ts");
		expect(getFileNameFromPath("README.md")).toBe("README.md");
	});

	it("builds fixed width style outside fullscreen embedded mode", () => {
		expect(getFilePanelWidthStyle({ width: 420, isFullscreenEmbedded: false })).toBe(
			"min-width: 420px; width: 420px; max-width: 420px;"
		);
	});

	it("builds flexible width style inside fullscreen embedded mode", () => {
		expect(getFilePanelWidthStyle({ width: 420, isFullscreenEmbedded: true })).toBe(
			"min-width: 0; width: 100%; max-width: 100%;"
		);
	});

	it("builds a display options key from path and available modes", () => {
		const options: FilePanelDisplayOptions = {
			formatKind: "markdown",
			availableModes: ["rendered", "raw"],
			defaultMode: "rendered",
		};

		expect(getDisplayOptionsKey("/repo/README.md", options)).toBe(
			"/repo/README.md:rendered:rendered,raw"
		);
	});

	it("resets display mode only when the display options key changes", () => {
		expect(shouldResetFilePanelDisplayMode({ nextKey: "a", lastKey: "b" })).toBe(true);
		expect(shouldResetFilePanelDisplayMode({ nextKey: "a", lastKey: "a" })).toBe(false);
	});

	it("shows raw editor controls only for writable raw mode", () => {
		expect(
			shouldShowRawEditorModeControls({
				displayMode: "raw",
				useReadOnlyPierreView: false,
			})
		).toBe(true);
		expect(
			shouldShowRawEditorModeControls({
				displayMode: "rendered",
				useReadOnlyPierreView: false,
			})
		).toBe(false);
		expect(
			shouldShowRawEditorModeControls({
				displayMode: "raw",
				useReadOnlyPierreView: true,
			})
		).toBe(false);
	});

	it("keeps the editor modes in display order", () => {
		expect(FILE_PANEL_EDITOR_MODES).toEqual(["write", "read"]);
	});
});
