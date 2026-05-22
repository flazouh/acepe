import { describe, expect, it } from "bun:test";
import {
	getTerminalPanelCombinedError,
	getTerminalPanelWidthStyle,
	shouldShowTerminalPanelResizeEdge,
} from "./terminal-panel-state.js";

describe("terminal panel state", () => {
	it("builds width style for fullscreen and fixed-width panels", () => {
		expect(getTerminalPanelWidthStyle({ width: 320, isFullscreenEmbedded: true })).toBe(
			"min-width: 0;"
		);
		expect(getTerminalPanelWidthStyle({ width: 320, isFullscreenEmbedded: false })).toBe(
			"min-width: 320px; width: 320px; max-width: 320px;"
		);
	});

	it("combines shell and pty errors with shell taking priority", () => {
		expect(getTerminalPanelCombinedError({ shellError: null, ptyError: null })).toBeNull();
		expect(getTerminalPanelCombinedError({ shellError: "missing", ptyError: "pty" })).toBe(
			"Failed to load shell: missing"
		);
		expect(getTerminalPanelCombinedError({ shellError: null, ptyError: "pty" })).toBe(
			"Failed to start terminal: pty"
		);
	});

	it("shows resize edge only for fixed-width panels", () => {
		expect(shouldShowTerminalPanelResizeEdge(true)).toBe(false);
		expect(shouldShowTerminalPanelResizeEdge(false)).toBe(true);
	});
});
