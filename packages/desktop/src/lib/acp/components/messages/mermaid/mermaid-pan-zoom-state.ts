import type { PanZoomState } from "./use-pan-zoom.js";

export const MERMAID_CANVAS_DEFAULT_PAN_ZOOM_STATE: PanZoomState = {
	scale: 1,
	translateX: 0,
	translateY: 0,
};

export function applyPanZoomStateUpdate(
	current: PanZoomState,
	updates: Partial<PanZoomState>
): PanZoomState {
	return {
		scale: updates.scale ?? current.scale,
		translateX: updates.translateX ?? current.translateX,
		translateY: updates.translateY ?? current.translateY,
	};
}

export function getPanZoomTransform(state: PanZoomState): string {
	return `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`;
}

export function getPanZoomLevel(scale: number): number {
	return Math.round(scale * 100);
}
