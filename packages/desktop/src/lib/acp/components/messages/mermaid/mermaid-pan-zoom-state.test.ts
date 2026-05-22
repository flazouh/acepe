import { describe, expect, it } from "bun:test";

import {
	applyPanZoomStateUpdate,
	getPanZoomLevel,
	getPanZoomTransform,
	MERMAID_CANVAS_DEFAULT_PAN_ZOOM_STATE,
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
});
