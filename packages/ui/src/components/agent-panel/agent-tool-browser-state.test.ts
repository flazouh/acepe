import { describe, expect, it } from "bun:test";

import {
	buildBrowserToolDetailsPreview,
	buildBrowserToolScriptPreview,
	countBrowserToolLines,
	hasBrowserToolDetails,
	isBrowserToolScriptCollapsible,
	normalizeBrowserToolScript,
} from "./agent-tool-browser-state.js";

describe("agent tool browser state", () => {
	it("normalizes script text and detects details", () => {
		expect(normalizeBrowserToolScript("  await page.click()\n ")).toBe("await page.click()");
		expect(normalizeBrowserToolScript(null)).toBe("");
		expect(hasBrowserToolDetails(" result ")).toBe(true);
		expect(hasBrowserToolDetails("   ")).toBe(false);
	});

	it("counts script lines", () => {
		expect(countBrowserToolLines("one")).toBe(1);
		expect(countBrowserToolLines("one\ntwo\nthree")).toBe(3);
	});

	it("marks long scripts collapsible by characters or lines", () => {
		expect(
			isBrowserToolScriptCollapsible({
				scriptText: "short",
				characterLimit: 10,
				lineLimit: 3,
			})
		).toBe(false);
		expect(
			isBrowserToolScriptCollapsible({
				scriptText: "long script",
				characterLimit: 5,
				lineLimit: 3,
			})
		).toBe(true);
		expect(
			isBrowserToolScriptCollapsible({
				scriptText: "1\n2\n3\n4",
				characterLimit: 100,
				lineLimit: 3,
			})
		).toBe(true);
	});

	it("builds script previews from the first lines", () => {
		expect(buildBrowserToolScriptPreview({ scriptText: "a\nb\nc\nd", lineLimit: 3 })).toBe(
			"a\nb\nc\n..."
		);
		expect(buildBrowserToolScriptPreview({ scriptText: "  a\nb  ", lineLimit: 3 })).toBe("a\nb");
		expect(buildBrowserToolScriptPreview({ scriptText: "   " })).toBe("");
	});

	it("compacts details text and truncates long previews", () => {
		expect(buildBrowserToolDetailsPreview({ detailsText: " first\n\n second " })).toBe(
			"first second"
		);
		expect(
			buildBrowserToolDetailsPreview({
				detailsText: "abcdefghijklmnopqrstuvwxyz",
				characterLimit: 10,
			})
		).toBe("abcdefghij...");
		expect(buildBrowserToolDetailsPreview({ detailsText: "   " })).toBeNull();
	});
});
