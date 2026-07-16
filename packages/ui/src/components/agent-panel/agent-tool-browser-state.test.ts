import { describe, expect, it } from "bun:test";

import {
	buildBrowserToolDetailsPreview,
	buildBrowserToolScriptPreview,
	countBrowserToolLines,
	getBrowserScriptLines,
	hasBrowserToolDetails,
	isBrowserToolScriptCollapsible,
	normalizeBrowserToolScript,
	resolveBrowserScriptBody,
	resolveBrowserScriptHtml,
	shouldUseBrowserScriptHtml,
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

	it("splits scripts into body lines and recovers code from a misplaced subtitle", () => {
		expect(getBrowserScriptLines("a\nb\n")).toEqual(["a", "b"]);
		expect(getBrowserScriptLines("  ")).toEqual([]);
		expect(
			resolveBrowserScriptBody({
				scriptText: null,
				subtitle: "(() => document.body)",
			})
		).toBe("(() => document.body)");
		expect(
			resolveBrowserScriptBody({
				scriptText: "explicit()",
				subtitle: "(() => document.body)",
			})
		).toBe("explicit()");
		expect(
			resolveBrowserScriptBody({
				scriptText: null,
				subtitle: "click button",
			})
		).toBe("");
	});

	it("resolves script html via highlight callback once ready", () => {
		let ready = false;
		const highlightScript = (code: string): string | null => {
			if (!ready) return null;
			return `<span style="color: var(--shiki-light)">${code}</span>`;
		};

		expect(
			resolveBrowserScriptHtml({
				scriptText: "(() => 1)",
				highlightScript,
			})
		).toBeNull();

		ready = true;
		const html = resolveBrowserScriptHtml({
			scriptText: "(() => 1)",
			highlightScript,
		});
		expect(html).toContain("--shiki-light");
		expect(shouldUseBrowserScriptHtml(html)).toBe(true);
		expect(shouldUseBrowserScriptHtml(null)).toBe(false);
	});

	it("prefers precomputed scriptHtml and skips capped highlight results", () => {
		expect(
			resolveBrowserScriptHtml({
				scriptText: "(() => 1)",
				scriptHtml: "<span>baked</span>",
				highlightScript: () => "<span>live</span>",
			})
		).toBe("<span>baked</span>");
		expect(
			resolveBrowserScriptHtml({
				scriptText: "huge",
				highlightScript: () => null,
			})
		).toBeNull();
	});
});
