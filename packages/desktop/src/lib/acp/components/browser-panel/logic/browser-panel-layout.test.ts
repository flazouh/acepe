import { describe, expect, it } from "bun:test";

import {
	getBrowserPanelWidthStyle,
	shouldShowBrowserPanelResizeEdge,
} from "./browser-panel-layout.js";

describe("browser panel layout", () => {
	it("uses fixed width when the panel owns its size", () => {
		expect(
			getBrowserPanelWidthStyle({
				width: 420,
				isFullscreenEmbedded: false,
				isFillContainer: false,
			})
		).toBe("width: 420px;");
	});

	it("fills the container for fullscreen or fill-container modes", () => {
		expect(
			getBrowserPanelWidthStyle({
				width: 420,
				isFullscreenEmbedded: true,
				isFillContainer: false,
			})
		).toBe("width: 100%; height: 100%;");
		expect(
			getBrowserPanelWidthStyle({
				width: 420,
				isFullscreenEmbedded: false,
				isFillContainer: true,
			})
		).toBe("width: 100%; height: 100%;");
	});

	it("hides the resize edge only for fullscreen embedded panels", () => {
		expect(shouldShowBrowserPanelResizeEdge({ isFullscreenEmbedded: true })).toBe(false);
		expect(shouldShowBrowserPanelResizeEdge({ isFullscreenEmbedded: false })).toBe(true);
		expect(shouldShowBrowserPanelResizeEdge({})).toBe(true);
	});
});
