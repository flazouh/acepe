export interface BrowserPanelBoundsDependencies {
	getWindowInnerPosition: () => Promise<{ x: number; y: number }>;
	getWebviewPosition: () => Promise<{ x: number; y: number }>;
	getScaleFactor: () => Promise<number>;
	getZoomLevel: () => number;
}

export interface BrowserPanelViewportRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface BrowserPanelNativeBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Converts a CSS-pixel viewport rect into native logical-pixel bounds
 * for a Tauri child webview.
 *
 * When the main webview has a zoom level applied (via `webview.setZoom()`),
 * `getBoundingClientRect()` returns CSS pixels which are smaller than the
 * actual logical window coordinates. Multiplying by the zoom level converts
 * CSS pixels → logical window pixels so the native child webview aligns
 * with the DOM slot at every zoom level.
 */
export async function resolveBrowserPanelBounds(
	rect: BrowserPanelViewportRect,
	dependencies: BrowserPanelBoundsDependencies
): Promise<BrowserPanelNativeBounds> {
	const zoom = dependencies.getZoomLevel();

	return {
		x: rect.x * zoom,
		y: rect.y * zoom,
		width: rect.width * zoom,
		height: rect.height * zoom,
	};
}
