import { describe, expect, it } from "vitest";

import {
	clampFullscreenAuxPanelWidth,
	type FullscreenAuxPanelRef,
	resolveFullscreenAuxPanel,
} from "./fullscreen-layout.js";

describe("resolveFullscreenAuxPanel", () => {
	it("returns the explicitly selected auxiliary panel when it exists", () => {
		const selected: FullscreenAuxPanelRef = { kind: "terminal", id: "term-1" };

		const result = resolveFullscreenAuxPanel({
			selectedAuxPanel: selected,
			filePanels: [{ id: "file-1", width: 500 }],
			reviewPanels: [],
			terminalPanels: [{ id: "term-1", width: 520 }],
			gitPanels: [{ id: "git-1", width: 400 }],
			browserPanels: [],
		});

		expect(result).toEqual({
			kind: "terminal",
			panel: { id: "term-1", width: 520 },
		});
	});

	it("falls back to first available panel when selected panel no longer exists", () => {
		const result = resolveFullscreenAuxPanel({
			selectedAuxPanel: { kind: "file", id: "missing" },
			filePanels: [],
			reviewPanels: [{ id: "review-1", width: 600 }],
			terminalPanels: [{ id: "term-1", width: 500 }],
			gitPanels: [],
			browserPanels: [],
		});

		expect(result).toEqual({
			kind: "review",
			panel: { id: "review-1", width: 600 },
		});
	});

	it("returns null when there are no auxiliary panels", () => {
		const result = resolveFullscreenAuxPanel({
			selectedAuxPanel: null,
			filePanels: [],
			reviewPanels: [],
			terminalPanels: [],
			gitPanels: [],
			browserPanels: [],
		});

		expect(result).toBeNull();
	});
});

describe("clampFullscreenAuxPanelWidth", () => {
	it("clamps width to the fullscreen min and max bounds", () => {
		expect(clampFullscreenAuxPanelWidth(200)).toBe(320);
		expect(clampFullscreenAuxPanelWidth(480)).toBe(480);
		expect(clampFullscreenAuxPanelWidth(900)).toBe(640);
	});
});
