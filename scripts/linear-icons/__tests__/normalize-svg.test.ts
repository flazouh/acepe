import { describe, expect, test } from "bun:test";

import { extractIconsFromCacheEntry } from "../extract-svg-sources.js";
import {
	normalizeLinearSvg,
	normalizePathData,
	normalizeRawIcon,
} from "../normalize-svg.js";

describe("normalize-svg", () => {
	test("preserves SVG path shorthand separators when normalizing decimals", () => {
		const rawPath =
			"m10.663 1.686-.23 1.15c-.033.164-.05.246-.087.314a.5.5 0 0 1-.196.196";

		expect(normalizePathData(rawPath)).toBe(
			"m 10.663 1.686 -0.23 1.15 c -0.033 0.164 -0.05 0.246 -0.087 0.314 a 0.5 0.5 0 0 1 -0.196 0.196",
		);
		expect(normalizePathData(rawPath)).not.toContain("0.0330.164");
		expect(normalizePathData(rawPath)).not.toContain("0.50.5");
	});

	test("normalizes sprite icons with implicit command-number boundaries", () => {
		const symbolMarkup =
			'<symbol id="Anchor" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M8.75 4.855a2 2 0 1 0-1.5 0V6.05a.5.5 0 0 1-.5.5H6a.75.75 0 0 0 0 1.5h1.05c.11 0 .2.09.2.2v3.97a.19.19 0 0 1-.24.188" clip-rule="evenodd"/></symbol>';
		const icons = extractIconsFromCacheEntry("Root.BBtwZL7v.js", symbolMarkup);
		const anchor = icons.find((icon) => icon.originalName === "Anchor");
		expect(anchor).toBeDefined();
		if (!anchor) {
			return;
		}

		const svg = normalizeLinearSvg(normalizeRawIcon(anchor));
		expect(svg).toContain('a 0.5 0.5');
		expect(svg).not.toContain("0.50.5");
		expect(svg).not.toContain("0.750.75");
	});

	test("renders stroke-only paths without forcing fill", () => {
		const icon = normalizeRawIcon({
			originalName: "StrokeOnly",
			sourceChunk: "Fixture",
			sourceType: "symbol-sprite",
			viewBox: "0 0 16 16",
			shapes: [
				{
					tag: "path",
					attributes: {
						d: "M2 2h12",
						"stroke-width": "1.5",
						"stroke-linecap": "round",
					},
				},
			],
		});

		const svg = normalizeLinearSvg(icon);
		expect(svg).toContain('stroke="currentColor"');
		expect(svg).toContain('fill="none"');
		expect(svg).not.toContain('fill="currentColor"');
	});
});
