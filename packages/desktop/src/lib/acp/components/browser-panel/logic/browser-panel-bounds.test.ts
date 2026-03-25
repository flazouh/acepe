import { describe, expect, it } from "bun:test";

import { resolveBrowserPanelBounds } from "./browser-panel-bounds.js";

describe("resolveBrowserPanelBounds", () => {
	it("multiplies CSS-pixel rect by zoom to get native logical bounds", async () => {
		const bounds = await resolveBrowserPanelBounds(
			{ x: 740, y: 63, width: 497, height: 759 },
			{
				getWindowInnerPosition: async () => ({ x: 412, y: 96 }),
				getWebviewPosition: async () => ({ x: 412, y: 96 }),
				getScaleFactor: async () => 1,
				getZoomLevel: () => 0.8,
			}
		);

		expect(bounds.x).toBeCloseTo(740 * 0.8, 5);
		expect(bounds.y).toBeCloseTo(63 * 0.8, 5);
		expect(bounds.width).toBeCloseTo(497 * 0.8, 5);
		expect(bounds.height).toBeCloseTo(759 * 0.8, 5);
	});

	it("passes through at zoom 1.0 (no scaling)", async () => {
		const bounds = await resolveBrowserPanelBounds(
			{ x: 964, y: 138, width: 620, height: 1000 },
			{
				getWindowInnerPosition: async () => ({ x: 100, y: 80 }),
				getWebviewPosition: async () => ({ x: 124, y: 116 }),
				getScaleFactor: async () => 2,
				getZoomLevel: () => 1,
			}
		);

		expect(bounds).toEqual({
			x: 964,
			y: 138,
			width: 620,
			height: 1000,
		});
	});

	it("scales up at zoom 1.4", async () => {
		const bounds = await resolveBrowserPanelBounds(
			{ x: 200, y: 50, width: 600, height: 800 },
			{
				getWindowInnerPosition: async () => ({ x: 0, y: 0 }),
				getWebviewPosition: async () => ({ x: 0, y: 0 }),
				getScaleFactor: async () => 1,
				getZoomLevel: () => 1.4,
			}
		);

		expect(bounds.x).toBeCloseTo(200 * 1.4, 5);
		expect(bounds.y).toBeCloseTo(50 * 1.4, 5);
		expect(bounds.width).toBeCloseTo(600 * 1.4, 5);
		expect(bounds.height).toBeCloseTo(800 * 1.4, 5);
	});
});
