import { describe, expect, it } from "bun:test";

import {
	applyPanZoomStateUpdate,
	getPanZoomLevel,
	getPanZoomTransform,
	MERMAID_CANVAS_DEFAULT_PAN_ZOOM_STATE,
	resetMermaidPanZoomState,
	zoomMermaidPanZoomIn,
	zoomMermaidPanZoomOut,
} from "./mermaid-pan-zoom-state.js";

describe("mermaid-pan-zoom-state", () => {
	it("applies partial updates while keeping unchanged values", () => {
		const next = applyPanZoomStateUpdate(
			{ scale: 2, translateX: 12, translateY: -4 },
			{ translateY: 20 }
		);

		expect(next).toEqual({ scale: 2, translateX: 12, translateY: 20 });
	});

	it("keeps zero values from updates", () => {
		const next = applyPanZoomStateUpdate(
			{ scale: 2, translateX: 12, translateY: -4 },
			{ scale: 0, translateX: 0, translateY: 0 }
		);

		expect(next).toEqual({ scale: 0, translateX: 0, translateY: 0 });
	});

	it("builds the css transform from pan and zoom state", () => {
		expect(getPanZoomTransform({ scale: 1.5, translateX: 10, translateY: -8 })).toBe(
			"translate(10px, -8px) scale(1.5)"
		);
	});

	it("builds the rounded zoom level", () => {
		expect(getPanZoomLevel(1)).toBe(100);
		expect(getPanZoomLevel(1.254)).toBe(125);
	});

	it("keeps the shared reset state explicit", () => {
		expect(MERMAID_CANVAS_DEFAULT_PAN_ZOOM_STATE).toEqual({
			scale: 1,
			translateX: 0,
			translateY: 0,
		});
	});

	it("zooms in and clamps at the inline max scale", () => {
		expect(zoomMermaidPanZoomIn({ scale: 2, translateX: 4, translateY: 5 })).toEqual({
			scale: 2.5,
			translateX: 4,
			translateY: 5,
		});
		expect(zoomMermaidPanZoomIn({ scale: 5, translateX: 4, translateY: 5 }).scale).toBe(5);
	});

	it("zooms out and clamps at the inline min scale", () => {
		expect(zoomMermaidPanZoomOut({ scale: 2, translateX: 4, translateY: 5 })).toEqual({
			scale: 1.6,
			translateX: 4,
			translateY: 5,
		});
		expect(zoomMermaidPanZoomOut({ scale: 0.2, translateX: 4, translateY: 5 }).scale).toBe(0.2);
	});

	it("returns a fresh reset state", () => {
		const reset = resetMermaidPanZoomState();
		reset.scale = 2;

		expect(MERMAID_CANVAS_DEFAULT_PAN_ZOOM_STATE.scale).toBe(1);
	});
});
